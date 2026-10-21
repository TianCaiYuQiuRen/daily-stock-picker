# -*- coding: utf-8 -*-
"""K 线训练数据：真实历史行情、周期聚合、双盲切片、形态测验。

数据优先级：
  日/周/月线  → 通达信本地 vipdoc/lday（完整历史），没有则用腾讯前复权
  5/15/30/60分钟 → 腾讯分钟线（本地 minline 为空时）
"""
from __future__ import annotations

import json
import os
import random
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime

from core import config, patterns, quotes
from core.tdx_local import TdxStore, is_a_share

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE_URLS = ("https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn")

PERIODS = {
    "1m": {"label": "1分钟", "short": "1分", "kind": "intraday", "tencent": "m1", "minutes": 1},
    "5m": {"label": "5分钟", "short": "5分", "kind": "intraday", "tencent": "m5", "minutes": 5},
    "15m": {"label": "15分钟", "short": "15分", "kind": "intraday", "tencent": "m15", "minutes": 15},
    "30m": {"label": "30分钟", "short": "30分", "kind": "intraday", "tencent": "m30", "minutes": 30},
    "60m": {"label": "60分钟", "short": "60分", "kind": "intraday", "tencent": "m60", "minutes": 60},
    "day": {"label": "日线", "short": "日线", "kind": "day", "tencent": "day", "minutes": 0},
    "week": {"label": "周线", "short": "周线", "kind": "week", "tencent": "week", "minutes": 0},
    "month": {"label": "月线", "short": "月线", "kind": "month", "tencent": "month", "minutes": 0},
}
PERIOD_ORDER = ["1m", "5m", "15m", "30m", "60m", "day", "week", "month"]

_LOCK = threading.RLock()
_CACHE = OrderedDict()          # key -> (ts, bars)
_SESSIONS = OrderedDict()       # id -> session
_QUIZZES = OrderedDict()        # id -> quiz
_RECENT = []
_TDX = {}
_FALLBACK = [
    ("sh", "600519"), ("sz", "000001"), ("sh", "601318"), ("sz", "300750"),
    ("sh", "600036"), ("sz", "000858"), ("sh", "601899"), ("sz", "002594"),
    ("sh", "688981"), ("sz", "300059"), ("sh", "600900"), ("sz", "000333"),
]
# 月线需要 200 根以上，优先从上市时间足够长的老股票里抽，避免新股只有几十根月K。
_MONTH_POOL = _FALLBACK + [
    ("sh", "600000"), ("sh", "600030"), ("sh", "600048"), ("sh", "600050"),
    ("sh", "600104"), ("sh", "600276"), ("sh", "600309"), ("sh", "600585"),
    ("sh", "600690"), ("sh", "600887"), ("sh", "601088"), ("sh", "601166"),
    ("sh", "601288"), ("sh", "601328"), ("sh", "601398"), ("sh", "601601"),
    ("sh", "601628"), ("sh", "601668"), ("sh", "601857"), ("sh", "601988"),
    ("sz", "000002"), ("sz", "000063"), ("sz", "000100"), ("sz", "000157"),
    ("sz", "000338"), ("sz", "000568"), ("sz", "000625"), ("sz", "000651"),
    ("sz", "000725"), ("sz", "000776"), ("sz", "000783"), ("sz", "000895"),
    ("sz", "002001"), ("sz", "002024"), ("sz", "002142"), ("sz", "002304"),
]


# ---------------------------------------------------------------------------
# 行情读取
# ---------------------------------------------------------------------------
def _http_json(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Referer": "https://gu.qq.com/"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def _tencent_query(url_path, timeout=12):
    last = None
    for base in BASE_URLS:
        try:
            return _http_json(base + url_path, timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            last = exc
            continue
    raise RuntimeError("历史行情获取失败：%s" % (last,))


def _cache_get(key, ttl):
    with _LOCK:
        pair = _CACHE.get(key)
        if pair and time.time() - pair[0] <= ttl:
            _CACHE.move_to_end(key)
            return [dict(x) for x in pair[1]]
    return None


def _cache_put(key, bars):
    with _LOCK:
        _CACHE[key] = (time.time(), [dict(x) for x in bars])
        _CACHE.move_to_end(key)
        while len(_CACHE) > 90:
            _CACHE.popitem(last=False)


def _parse_date(text):
    digits = re.sub(r"\D", "", str(text or ""))
    if len(digits) >= 8:
        return digits[:8]
    return ""


def _intraday_bars(symbol, period, count=640):
    per = PERIODS[period]["tencent"]
    path = "/appstock/app/kline/mkline?param=%s,%s,,%d" % (symbol, per, count)
    key = "tx:%s:%s" % (symbol, period)
    cached = _cache_get(key, 300)
    if cached:
        return cached
    j = _tencent_query(path)
    data = (j.get("data") or {}).get(symbol) or {}
    rows = data.get(per) or []
    bars = []
    for row in rows:
        try:
            t = str(row[0])
            o, c, h, l = float(row[1]), float(row[2]), float(row[3]), float(row[4])
            v = float(row[5] or 0)
        except (ValueError, IndexError, TypeError):
            continue
        if min(o, h, l, c) <= 0 or h < max(o, c) or l > min(o, c):
            continue
        if len(t) >= 12 and t[:12].isdigit():
            label = "%s-%s-%s %s:%s" % (t[0:4], t[4:6], t[6:8], t[8:10], t[10:12])
        else:
            label = t
        bars.append({"t": t, "d": label, "o": o, "h": h, "l": l, "c": c, "v": v})
    bars.sort(key=lambda x: x["t"])
    if bars:
        _cache_put(key, bars)
    return bars


def _kline_bars(symbol, period, count=640, qfq=True):
    per = PERIODS[period]["tencent"]
    if period == "day":
        path = "/appstock/app/fqkline/get?param=%s,day,,,%d,%s" % (
            symbol, count, "qfq" if qfq else "")
    else:
        path = "/appstock/app/fqkline/get?param=%s,%s,,,%d,%s" % (
            symbol, per, count, "qfq" if qfq else "")
    key = "txk:%s:%s:%s" % (symbol, period, "q" if qfq else "r")
    cached = _cache_get(key, 1800)
    if cached:
        return cached
    j = _tencent_query(path)
    data = (j.get("data") or {}).get(symbol) or {}
    if not isinstance(data, dict):
        return []
    rows = []
    names = (["qfq" + per, per] if qfq else [per])
    for name in names:
        v = data.get(name)
        if isinstance(v, list) and v:
            rows = v
            break
    bars = []
    for row in rows:
        try:
            d = _parse_date(row[0])
            o, c, h, l = float(row[1]), float(row[2]), float(row[3]), float(row[4])
            v = float(row[5] or 0)
        except (ValueError, IndexError, TypeError):
            continue
        if not d or min(o, h, l, c) <= 0 or h < max(o, c) or l > min(o, c):
            continue
        bars.append({"t": d, "d": "%s-%s-%s" % (d[:4], d[4:6], d[6:8]),
                     "o": o, "h": h, "l": l, "c": c, "v": v})
    bars.sort(key=lambda x: x["t"])
    if bars:
        _cache_put(key, bars)
    return bars


def _get_tdx(root):
    with _LOCK:
        store = _TDX.get(root)
        if store is None:
            store = TdxStore(root)
            _TDX[root] = store
        return store


def _local_daily(market, code, limit=6500):
    cfg = config.get()
    root = cfg.get("tdx_root") or ""
    if not root or not os.path.isdir(os.path.join(root, "T0002")) and not os.path.isdir(os.path.join(root, "vipdoc")):
        return []
    store = _get_tdx(root)
    if not store.available():
        return []
    raw = store.bars(market, code, limit=limit)
    out = []
    for row in raw:
        d, o, h, l, c, amount, vol = row
        if min(o, h, l, c) <= 0:
            continue
        ds = str(d)
        if len(ds) != 8:
            continue
        out.append({"t": ds, "d": "%s-%s-%s" % (ds[:4], ds[4:6], ds[6:8]),
                    "o": o, "h": h, "l": l, "c": c, "v": float(vol or 0),
                    "a": float(amount or 0)})
    return out


def _resample(daily, kind):
    """把日线聚合成周线/月线。"""
    groups = OrderedDict()
    for b in daily:
        d = b["t"]
        try:
            dt = datetime.strptime(d, "%Y%m%d")
        except ValueError:
            continue
        if kind == "week":
            iso = dt.isocalendar()
            key = "%04d-W%02d" % (iso[0], iso[1])
        else:
            key = d[:6]
        g = groups.get(key)
        if g is None:
            groups[key] = {"t": d, "d": b["d"], "o": b["o"], "h": b["h"],
                           "l": b["l"], "c": b["c"], "v": b["v"], "a": b.get("a", 0.0)}
        else:
            g["t"] = d
            g["d"] = b["d"]
            g["h"] = max(g["h"], b["h"])
            g["l"] = min(g["l"], b["l"])
            g["c"] = b["c"]
            g["v"] += b["v"]
            g["a"] += b.get("a", 0.0)
    return list(groups.values())


def get_bars(market, code, period, count=640):
    """获取指定周期历史K线，按时间升序。"""
    period = period if period in PERIODS else "day"
    symbol = ("sh" if market == "sh" else "sz" if market == "sz" else "bj") + code
    if PERIODS[period].get("kind") == "intraday":
        return _intraday_bars(symbol, period, max(640, count))
    if period == "day":
        local = _local_daily(market, code, limit=max(1000, count))
        if len(local) >= 220:
            return local[-count:]
        bars = _kline_bars(symbol, "day", max(640, count), qfq=True)
        return bars
    # 周线/月线优先用本地日线聚合，历史更长
    local = _local_daily(market, code, limit=6500)
    if len(local) >= 240:
        bars = _resample(local, period)
        if len(bars) >= 260:
            return bars[-count:]
    bars = _kline_bars(symbol, period, max(640, count), qfq=True)
    if len(bars) < 220 or min(x["c"] for x in bars[-260:]) <= 0:
        raw = _kline_bars(symbol, period, max(640, count), qfq=False)
        if len(raw) > len(bars):
            bars = raw
    return bars


# ---------------------------------------------------------------------------
# 股票池
# ---------------------------------------------------------------------------
def _universe():
    cfg = config.get()
    root = cfg.get("tdx_root") or ""
    pool = []
    if root:
        try:
            pool = _get_tdx(root).universe()
        except Exception:  # noqa: BLE001
            pool = []
    if not pool:
        try:
            from core import online
            pool = online.fetch_universe()
        except Exception:  # noqa: BLE001
            pool = []
    pool = [(m, c) for m, c in pool if is_a_share(m, c)]
    if not pool:
        pool = list(_FALLBACK)
    return pool


def _pick_symbol(period="day"):
    if period == "month":
        # 月线随机从长历史股票池里取，保证至少能截出 200 根。
        with _LOCK:
            recent = set(_RECENT[-30:])
        choices = [x for x in _MONTH_POOL if x not in recent] or _MONTH_POOL
        return random.choice(choices)
    pool = _universe()
    with _LOCK:
        recent = set(_RECENT[-45:])
    choices = [x for x in pool if x not in recent] or pool
    return random.choice(choices)


def _fresh_enough(bars, period):
    if not bars:
        return False
    if PERIODS[period].get("kind") == "intraday":
        return True
    d = bars[-1]["t"]
    try:
        last = datetime.strptime(d, "%Y%m%d")
    except ValueError:
        return True
    return (datetime.now() - last).days <= 45


def _name_for(market, code):
    try:
        q = quotes.fetch_few([(market, code)]).get(code)
        if q and q.get("name"):
            return q["name"]
    except Exception:  # noqa: BLE001
        pass
    return code


def _real_label(bar, period):
    if PERIODS[period].get("kind") == "intraday":
        return bar.get("d") or bar.get("t", "")
    if period == "month":
        return bar["t"][:6]
    if period == "week":
        return bar["d"]
    return bar["d"]


# ---------------------------------------------------------------------------
# 训练会话
# ---------------------------------------------------------------------------
def _trim():
    now = time.time()
    with _LOCK:
        for store, ttl in ((_SESSIONS, 7200), (_QUIZZES, 7200)):
            for key in list(store.keys()):
                if now - store[key].get("_ts", now) > ttl:
                    store.pop(key, None)
            while len(store) > 50:
                store.popitem(last=False)


def make_session(period="day", initial=60):
    period = period if period in PERIODS else "day"
    initial = max(20, min(120, int(initial or 60)))
    errors = []
    attempts = 35 if period == "month" else 14
    for _ in range(attempts):
        market, code = _pick_symbol(period)
        try:
            bars = get_bars(market, code, period, count=640)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            continue
        if len(bars) < 215 or not _fresh_enough(bars, period):
            continue
        if period in ("week", "month") and len(bars) < 260:
            # 周/月线给黄白线留出至少 60 根前置，避免开局 114 周期线全为空
            continue
        last = bars[-1]["c"]
        if last < 1.2 or last > 3500:
            continue
        # 随机截取 200 根，不要总是最新一段；尽量保留足够的前置K线，
        # 让黄白线（最长 114 日）在开局时就能算出来。
        if len(bars) >= 360:
            min_end = 360
        elif len(bars) >= 260:
            min_end = 260
        else:
            min_end = 200
        end = random.randint(min_end, len(bars))
        seg = bars[end - 200:end]
        leads = bars[max(0, end - 360):end - 200]
        if len(seg) < 200:
            continue
        hi = max(x["h"] for x in seg)
        lo = min(x["l"] for x in seg)
        if lo <= 0:
            continue
        excursion = (hi / lo - 1.0) * 100.0
        if excursion < 4.0 or excursion > 600.0:
            continue
        sid = secrets.token_hex(8)
        session = {
            "_ts": time.time(),
            "id": sid,
            "market": market,
            "code": code,
            "period": period,
            "period_label": PERIODS[period]["label"],
            "bars": seg,
            "lead": leads[-160:],
            "start_date": _real_label(seg[0], period),
            "end_date": _real_label(seg[-1], period),
            "initial": initial,
            "source": "通达信本地历史" if PERIODS[period].get("kind") != "intraday" else "腾讯分钟行情",
        }
        with _LOCK:
            _SESSIONS[sid] = session
            _RECENT.append((market, code))
            del _RECENT[:-80]
            while len(_SESSIONS) > 40:
                _SESSIONS.popitem(last=False)
        return _public_session(session)
    raise RuntimeError("暂时没有取到足够的历史K线，请稍后重试。" + (" " + errors[-1] if errors else ""))


def _public_bars(bars):
    return [{"o": round(b["o"], 3), "h": round(b["h"], 3),
             "l": round(b["l"], 3), "c": round(b["c"], 3),
             "v": round(b.get("v") or 0, 2)} for b in bars]


def _public_session(session):
    init = session["initial"]
    total = 200
    return {
        "ok": True,
        "id": session["id"],
        "period": session["period"],
        "period_label": session["period_label"],
        "total": total,
        "initial": init,
        "bars": _public_bars(session["bars"]),
        "lead": _public_bars(session["lead"]),
        "labels": ["第%d根" % (i + 1) for i in range(total)],
        "source": session["source"],
        "hint": "股票名称与日期已隐藏，走完 200 根后可揭晓。",
    }


def reveal_session(sid):
    with _LOCK:
        session = _SESSIONS.get(sid)
    if not session:
        raise KeyError("这局训练已过期，请重新生成一局。")
    name = _name_for(session["market"], session["code"])
    labels = [_real_label(b, session["period"]) for b in session["bars"]]
    return {
        "ok": True,
        "id": sid,
        "code": session["code"],
        "market": session["market"],
        "name": name,
        "period": session["period"],
        "period_label": session["period_label"],
        "start_date": session["start_date"],
        "end_date": session["end_date"],
        "labels": labels,
        "source": session["source"],
    }


# ---------------------------------------------------------------------------
# 形态测验
# ---------------------------------------------------------------------------
def _option_pool(correct, group):
    same = [p for p in patterns.LIBRARY if p["group"] == group and p["key"] != correct["key"]]
    others = [p for p in patterns.LIBRARY if p["key"] != correct["key"] and p not in same]
    random.shuffle(same)
    random.shuffle(others)
    pool = same[:3]
    if len(pool) < 3:
        pool += others[:3 - len(pool)]
    return pool


def make_quiz(period="day"):
    period = period if period in PERIODS else "day"
    _trim()
    errors = []
    tried = 0
    total_bars = 90
    focus_bars = 55
    for _ in range(20):
        market, code = _pick_symbol(period)
        try:
            bars = get_bars(market, code, period, count=640)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))
            continue
        if len(bars) < total_bars + 5 or not _fresh_enough(bars, period):
            continue
        for _ in range(4):
            tried += 1
            end = random.randint(total_bars, len(bars))
            seg = bars[end - total_bars:end]
            # 只对蓝框内的最后 55 根做判断，避免答案来自左侧背景走势。
            match, res = patterns.best_quiz_match(seg[-focus_bars:])
            if not match or match["score"] < 70:
                continue
            options = _option_pool(match, match["group"])
            opts = [{"key": match["key"], "name": match["name"]}]
            opts += [{"key": p["key"], "name": p["name"]} for p in options]
            random.shuffle(opts)
            qid = secrets.token_hex(8)
            quiz = {
                "_ts": time.time(),
                "id": qid,
                "market": market,
                "code": code,
                "period": period,
                "period_label": PERIODS[period]["label"],
                "bars": seg,
                "focus": focus_bars,
                "match": match,
                "analysis": res,
                "start_date": _real_label(seg[0], period),
                "end_date": _real_label(seg[-1], period),
            }
            with _LOCK:
                _QUIZZES[qid] = quiz
                while len(_QUIZZES) > 30:
                    _QUIZZES.popitem(last=False)
            return {
                "ok": True,
                "id": qid,
                "period": period,
                "period_label": PERIODS[period]["label"],
                "bars": _public_bars(seg),
                "focus": focus_bars,
                "options": opts,
                "hint": "只看蓝框内的最后 %d 根K线；左侧只作趋势背景，右侧是同一区域的放大图。" % focus_bars,
            }
        if tried > 26:
            break
    raise RuntimeError("暂时没有扫描到足够典型的形态，请再试一次。" +
                       (" " + errors[-1] if errors else ""))


def answer_quiz(qid, choice):
    with _LOCK:
        quiz = _QUIZZES.get(qid)
    if not quiz:
        raise KeyError("这道题已过期，请点击下一题。")
    answer = quiz["match"]
    correct = str(choice or "") == answer["key"]
    name = _name_for(quiz["market"], quiz["code"])
    return {
        "ok": True,
        "correct": correct,
        "choice": choice,
        "answer": answer,
        "analysis": {
            "trend": quiz["analysis"]["trend"],
            "bias": quiz["analysis"]["bias"],
            "confidence": quiz["analysis"]["confidence"],
            "levels": quiz["analysis"]["levels"],
        },
        "stock": {
            "code": quiz["code"],
            "name": name,
            "period": quiz["period_label"],
            "start_date": quiz["start_date"],
            "end_date": quiz["end_date"],
        },
    }

