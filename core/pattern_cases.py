# -*- coding: utf-8 -*-
"""从本地历史里扫描某一形态的历史案例。

只使用 patterns.analyze 的已确认结果；形态完成点之后保留 30 根K线，
用于展示后续走势。扫描结果缓存到 data/pattern_cases_v1.json。
"""
from __future__ import annotations

import json
import os
import random
import threading
import time

from core import config, patterns, training

CACHE_PATH = os.path.join(config.DATA_DIR, "pattern_cases_v1.json")
CACHE_TTL = 7 * 24 * 3600
_LOCK = threading.Lock()

# 只取本地历史较完整的股票，避免一次扫描整个市场
MAX_STOCKS = 55
WINDOW = 150
STEP = 8
CASE_BARS_BEFORE = 100
CASE_BARS_AFTER = 30


def _load_cache():
    try:
        with open(CACHE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and data.get("version") == 1:
            return data
    except (OSError, ValueError):
        pass
    return {"version": 1, "generated": 0, "cases": {}}


def _save_cache(cache):
    try:
        os.makedirs(config.DATA_DIR, exist_ok=True)
        tmp = CACHE_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, CACHE_PATH)
    except OSError:
        pass


def _bar_public(bar):
    return {
        "d": bar.get("d") or bar.get("t") or "",
        "o": round(float(bar.get("o", 0)), 3),
        "h": round(float(bar.get("h", 0)), 3),
        "l": round(float(bar.get("l", 0)), 3),
        "c": round(float(bar.get("c", 0)), 3),
        "v": round(float(bar.get("v", 0) or 0), 1),
    }


def _match_for(res, key):
    for m in res.get("matches", []):
        if m.get("key") == key:
            return m
    return None


def _sym_triangle_match(bars):
    """对称三角形的案例兜底：只需高点降低、低点抬高、振幅收敛。"""
    seg = bars[-60:]
    if len(seg) < 30:
        return None
    highs = []
    lows = []
    for i in range(2, len(seg) - 2):
        if seg[i]["h"] >= seg[i - 1]["h"] and seg[i]["h"] >= seg[i + 1]["h"]:
            highs.append((i, float(seg[i]["h"])))
        if seg[i]["l"] <= seg[i - 1]["l"] and seg[i]["l"] <= seg[i + 1]["l"]:
            lows.append((i, float(seg[i]["l"])))
    if len(highs) < 3 or len(lows) < 3:
        return None
    h = highs[-3:]
    l = lows[-3:]
    if not (h[0][1] > h[1][1] > h[2][1] and l[0][1] < l[1][1] < l[2][1]):
        return None
    first = seg[:20]
    last = seg[-20:]
    r1 = (max(x["h"] for x in first) / max(1e-9, min(x["l"] for x in first)) - 1) * 100
    r2 = (max(x["h"] for x in last) / max(1e-9, min(x["l"] for x in last)) - 1) * 100
    if r2 > r1 * 0.92:
        return None
    score = 62 + min(10, (r1 - r2) * 0.8) + min(8, (len(highs) + len(lows)) * 0.8)
    hi = max(x["h"] for x in seg)
    lo = min(x["l"] for x in seg)
    return patterns._match(
        "symmetrical_triangle", score,
        ["高点依次降低 %.2f / %.2f / %.2f" % (h[0][1], h[1][1], h[2][1]),
         "低点依次抬高 %.2f / %.2f / %.2f" % (l[0][1], l[1][1], l[2][1]),
         "近段振幅由 %.1f%% 收敛到 %.1f%%" % (r1, r2)],
        levels={"support": lo, "resistance": hi},
    )


def _case_from(bars, end, m, market, code, name):
    start = max(0, end - CASE_BARS_BEFORE)
    stop = min(len(bars), end + CASE_BARS_AFTER)
    chart = bars[start:stop]
    if len(chart) < 80:
        return None
    focus = end - 1 - start
    if focus < 60 or focus >= len(chart) - 2:
        return None
    base = float(chart[focus]["c"])
    after = chart[focus + 1:]
    if base <= 0 or not after:
        return None
    last = float(after[-1]["c"])
    highs = [float(x["h"]) for x in after]
    lows = [float(x["l"]) for x in after]
    return {
        "market": market,
        "code": code,
        "name": name,
        "period": "day",
        "focus": focus,
        "bars": [_bar_public(x) for x in chart],
        "pattern": {
            "key": m.get("key"),
            "name": m.get("name"),
            "chapter": m.get("chapter", ""),
            "page": m.get("page", ""),
            "score": m.get("score", 0),
            "direction": m.get("direction", "neutral"),
            "target": m.get("target", ""),
            "target_price": m.get("target_price"),
            "evidence": (m.get("evidence") or [])[:3],
        },
        "stats": {
            "after_pct": round((last / base - 1) * 100, 2),
            "max_pct": round((max(highs) / base - 1) * 100, 2),
            "min_pct": round((min(lows) / base - 1) * 100, 2),
            "bars_after": len(after),
            "pattern_date": chart[focus].get("d") or chart[focus].get("t") or "",
            "start_date": chart[0].get("d") or chart[0].get("t") or "",
            "end_date": chart[-1].get("d") or chart[-1].get("t") or "",
        },
    }


def _scan_symbol(market, code, key, name, limit):
    try:
        bars = training.get_bars(market, code, "day", count=520)
    except Exception:
        return []
    if len(bars) < 180:
        return []
    out = []
    # 从最近的历史往前找，避免只给同一种行情阶段
    for end in range(len(bars) - 25, WINDOW + 10, -STEP):
        chunk = bars[end - WINDOW:end]
        try:
            res = patterns.analyze(chunk)
        except Exception:
            continue
        m = _match_for(res, key)
        if not m and key == "symmetrical_triangle":
            m = _sym_triangle_match(chunk)
        if not m or m.get("score", 0) < 60:
            continue
        case = _case_from(bars, end, m, market, code, name)
        if case:
            out.append(case)
        if len(out) >= limit:
            break
    return out


def _candidate_symbols(limit=MAX_STOCKS):
    pool = list(training._universe())
    # 去掉明显不适合的代码，随机但固定种子，保证同一版本结果稳定
    pool = [(m, c) for m, c in pool if training.is_a_share(m, c)]
    rnd = random.Random(20261023)
    rnd.shuffle(pool)
    return pool[:limit]


def _scan(key, limit=3):
    cases = []
    seen = set()
    for market, code in _candidate_symbols():
        if code in seen:
            continue
        seen.add(code)
        name = training._name_for(market, code)
        found = _scan_symbol(market, code, key, name, 1)
        cases.extend(found)
        if len(cases) >= limit:
            break
    return cases[:limit]


def get_cases(key, limit=3, force=False):
    """返回某个形态的历史案例；同一形态缓存 7 天。"""
    key = str(key or "").strip()
    if key not in patterns.LIB_MAP:
        raise KeyError("未知形态")
    if not patterns.LIB_MAP[key].get("detect", True):
        return []
    limit = max(1, min(5, int(limit or 3)))
    cache_key = key
    with _LOCK:
        cache = _load_cache()
        item = cache.get("cases", {}).get(cache_key)
        now = time.time()
        if not force and item and now - item.get("ts", 0) < CACHE_TTL:
            return item.get("cases", [])[:limit]
        cases = _scan(key, limit)
        cache.setdefault("cases", {})[cache_key] = {"ts": now, "cases": cases}
        cache["generated"] = now
        _save_cache(cache)
        return cases
