# -*- coding: utf-8 -*-
"""手绘走势匹配：只找最近 N 个交易日内出现相似形态的 A 股。

思路：
1. 用户画出的线在浏览器端已经重采样为 30 个点；
2. 后端归一化后与每只股票最近 N 个交易日结束的 30 根收盘价做 DTW 比对；
3. 形态结束日越近、相似度越高，排名越靠前；
4. 只使用本地通达信日线，避免把整张图发给外部服务。
"""
from __future__ import annotations

import datetime as _dt
import math
import threading
import time

from core import config, quotes
from core.tdx_local import TdxStore

SHAPE_N = 30
CACHE_TTL = 6 * 3600
MAX_RESULTS = 30
MIN_SCORE = 48.0

_LOCK = threading.Lock()
_DATA = {"ts": 0.0, "latest": 0, "rows": []}


def _resample(values, n=SHAPE_N):
    vals = [float(v) for v in values if v is not None]
    if len(vals) < 2:
        return []
    if len(vals) == n:
        return vals
    out = []
    last = len(vals) - 1
    for i in range(n):
        pos = i * last / (n - 1)
        lo = int(math.floor(pos))
        hi = min(last, lo + 1)
        frac = pos - lo
        out.append(vals[lo] * (1 - frac) + vals[hi] * frac)
    return out


def _normalize(values):
    vals = [float(v) for v in values]
    if not vals:
        return None
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-9:
        return None
    return [(v - lo) / (hi - lo) for v in vals]


def _dtw(a, b, band=3):
    n = len(a)
    if len(b) != n:
        return 9.9
    inf = 1e18
    prev = [inf] * (n + 1)
    prev[0] = 0.0
    for i in range(1, n + 1):
        cur = [inf] * (n + 1)
        lo = max(1, i - band)
        hi = min(n, i + band)
        ai = a[i - 1]
        for j in range(lo, hi + 1):
            cost = abs(ai - b[j - 1])
            cur[j] = cost + min(prev[j], cur[j - 1], prev[j - 1])
        prev = cur
    return prev[n] / n


def _score(dist):
    # 30 点归一化曲线的典型距离：0.02–0.25
    return max(0.0, min(100.0, 100.0 - dist * 260.0))


def _parse_date(value):
    try:
        return _dt.datetime.strptime(str(value), "%Y%m%d")
    except (TypeError, ValueError):
        return None


def _load_rows():
    now = time.time()
    with _LOCK:
        if _DATA["rows"] and now - _DATA["ts"] < CACHE_TTL:
            return _DATA
        root = (config.get() or {}).get("tdx_root") or ""
        store = TdxStore(root) if root else None
        if not store or not store.available():
            raise RuntimeError("手绘选股需要本地通达信日线数据，请先在设置里配置通达信目录")
        latest = store.last_trade_date()
        latest_dt = _parse_date(latest)
        if not latest_dt:
            raise RuntimeError("没有读到本地最新交易日")
        rows = []
        for market, code in store.universe():
            bars = store.bars(market, code, limit=120)
            if len(bars) < SHAPE_N + 10:
                continue
            last_date = _parse_date(bars[-1][0])
            if not last_date or (latest_dt - last_date).days > 10:
                continue
            closes = [float(x[4]) for x in bars]
            if min(closes[-10:]) <= 0 or closes[-1] < 2 or closes[-1] > 1000:
                continue
            if bars[-1][6] <= 0:
                continue
            rows.append({
                "market": market,
                "code": code,
                "closes": closes,
                "dates": [x[0] for x in bars],
            })
        _DATA.update({"ts": now, "latest": latest, "rows": rows, "store": store})
        return _DATA


def _prepare_target(shape):
    vals = []
    for v in shape or []:
        try:
            x = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(x):
            vals.append(x)
    if len(vals) < 6:
        raise ValueError("请至少画出 6 个点")
    if len(vals) > 120:
        vals = vals[-120:]
    target = _normalize(_resample(vals, SHAPE_N))
    if not target:
        raise ValueError("画的线太平了，请画出有起伏的形态")
    return target


def _name_map(codes):
    try:
        names = quotes.fetch_few(codes)
    except Exception:
        names = {}
    return {code: (names.get(code) or {}).get("name") or code for _, code in codes}


def _result(row, target, end, days_ago, score, name, store):
    closes = row["closes"]
    dates = row["dates"]
    bars = store.bars(row["market"], row["code"], limit=120)
    if not bars:
        return None
    offset = max(0, len(bars) - len(closes))
    end_full = offset + end
    if end_full >= len(bars):
        return None
    start = max(0, end_full - 80)
    chart = bars[start:]
    if len(chart) < SHAPE_N:
        return None
    focus = end_full - start
    base = float(closes[end])
    latest = float(closes[-1])
    after_pcts = [(float(v) / base - 1) * 100 for v in closes[end + 1:] if base > 0]
    return {
        "market": row["market"],
        "code": row["code"],
        "name": name,
        "score": round(score, 1),
        "days_ago": days_ago,
        "focus": focus,
        "bars": [{
            "d": x[0], "o": x[1], "h": x[2], "l": x[3], "c": x[4], "v": x[6],
        } for x in chart],
        "pattern_date": dates[end],
        "latest_date": dates[-1],
        "latest_close": round(latest, 3),
        "latest_change": round((latest / float(closes[-2]) - 1) * 100, 2) if len(closes) > 1 and closes[-2] else 0,
        "after_pct": round((latest / base - 1) * 100, 2) if base else 0,
        "max_pct": round(max(after_pcts), 2) if after_pcts else 0,
        "min_pct": round(min(after_pcts), 2) if after_pcts else 0,
        "bars_after": len(closes) - end - 1,
        "pattern": {"name": "手绘形态", "score": round(score, 1), "target": "按画出的形态匹配"},
    }


def find_matches(shape, lookback=10, limit=20):
    """返回最近 lookback 个交易日内结束的相似形态。"""
    target = _prepare_target(shape)
    lookback = max(1, min(60, int(lookback or 10)))
    limit = max(1, min(MAX_RESULTS, int(limit or 20)))
    data = _load_rows()
    rows = data["rows"]
    hits = []
    for row in rows:
        closes = row["closes"]
        n = len(closes)
        best = None
        for days_ago in range(0, min(lookback, max(1, n - SHAPE_N))):
            end = n - 1 - days_ago
            if end + 1 < SHAPE_N:
                break
            window = closes[end - SHAPE_N + 1:end + 1]
            if max(window) <= 0 or min(window) <= 0:
                continue
            norm = _normalize(window)
            if not norm:
                continue
            # 方向明显相反的窗口先跳过，减少误配
            a_dir = target[-1] - target[0]
            b_dir = norm[-1] - norm[0]
            if a_dir * b_dir < 0 and abs(a_dir) > 0.12 and abs(b_dir) > 0.12:
                continue
            dist = _dtw(target, norm, band=3)
            score = _score(dist)
            if best is None or score > best[0]:
                best = (score, end, days_ago)
        if best and best[0] >= MIN_SCORE:
            hits.append((best[0] - best[2] * 0.45, best[0], best[1], best[2], row))
    hits.sort(key=lambda x: (x[0], x[1]), reverse=True)
    selected = hits[:max(limit * 2, limit + 10)]
    names = _name_map([(row["market"], row["code"]) for _, _, _, _, row in selected])
    out = []
    for _, score, end, days_ago, row in selected:
        name = names.get(row["code"], row["code"])
        if "ST" in str(name).upper() or "退" in str(name):
            continue
        item = _result(row, target, end, days_ago, score, name, data["store"])
        if item:
            out.append(item)
        if len(out) >= limit:
            break
    return {
        "latest_date": data["latest"],
        "scanned": len(rows),
        "lookback": lookback,
        "results": out,
    }
