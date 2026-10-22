# -*- coding: utf-8 -*-
"""K 线形态识别引擎（墨菲《期货市场技术分析》形态体系）。

按原书章节组织：
  第4章 趋势、支撑阻力、趋势线/通道、回撤、缺口
  第5章 主要反转形态
  第6章 持续形态

（1994 中文版没有日本蜡烛图章节；第12章是点数图，因此不收录蜡烛图定义。）

不依赖任何第三方库，输入标准 OHLCV 序列即可输出：
  - 趋势阶段、支撑/阻力
  - 命中的技术形态（含匹配度、证据、书中章节、失效条件、测算目标）
  - 多空综合倾向、量能确认

训练页的「当前形态提示」、形态测验、客户截图分析共用这一套规则，
保证网页上看到的结论一致。
"""
from __future__ import annotations

import math


# ---------------------------------------------------------------------------
# 形态图鉴
# ---------------------------------------------------------------------------
from core.murphy_library import MURPHY_LIBRARY as LIBRARY


LIB_MAP = {p["key"]: p for p in LIBRARY}


def library():
    return [dict(p) for p in LIBRARY]


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------
def _num(v, default=0.0):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except (TypeError, ValueError):
        return default


def normalize_bars(raw, limit=420):
    out = []
    for row in raw or []:
        if isinstance(row, dict):
            o, h, l, c = _num(row.get("o")), _num(row.get("h")), _num(row.get("l")), _num(row.get("c"))
            v = _num(row.get("v"))
            d = row.get("d") or row.get("label") or ""
        else:
            try:
                o, h, l, c, v = (_num(row[0]), _num(row[1]), _num(row[2]),
                                 _num(row[3]), _num(row[4]))
                d = row[5] if len(row) > 5 else ""
            except (IndexError, TypeError):
                continue
        if min(o, h, l, c) <= 0:
            continue
        if h < max(o, c):
            h = max(o, c)
        if l > min(o, c):
            l = min(o, c)
        out.append({"o": o, "h": h, "l": l, "c": c, "v": max(0.0, v), "d": d})
    return out[-limit:]


def _mean(values):
    values = [v for v in values if v is not None and math.isfinite(v)]
    return sum(values) / len(values) if values else 0.0


def _std(values):
    if len(values) < 2:
        return 0.0
    m = _mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / (len(values) - 1))


def _atr(bars, n=14):
    if len(bars) < 2:
        return max(0.0001, bars[-1]["h"] - bars[-1]["l"]) if bars else 0.0001
    trs = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i - 1]["c"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return max(0.0001, _mean(trs[-n:]))


def _slope(values):
    """最小二乘斜率（每根K线的变化量）。"""
    n = len(values)
    if n < 2:
        return 0.0
    xm = (n - 1) / 2.0
    ym = sum(values) / n
    den = sum((i - xm) ** 2 for i in range(n))
    if den <= 0:
        return 0.0
    return sum((i - xm) * (values[i] - ym) for i in range(n)) / den


def _line(points):
    if len(points) < 2:
        return 0.0, 0.0
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    xm = _mean(xs)
    ym = _mean(ys)
    den = sum((x - xm) ** 2 for x in xs)
    if den <= 0:
        return 0.0, ym
    k = sum((x - xm) * (y - ym) for x, y in points) / den
    return k, ym - k * xm


def _swings(bars, k=3, kind="low"):
    out = []
    field = "l" if kind == "low" else "h"
    for i in range(k, len(bars) - k):
        v = bars[i][field]
        left = [bars[j][field] for j in range(i - k, i)]
        right = [bars[j][field] for j in range(i + 1, i + k + 1)]
        if kind == "low":
            if v <= min(left) and v <= min(right) and (v < min(left) or v < min(right)):
                out.append((i, v))
        else:
            if v >= max(left) and v >= max(right) and (v > max(left) or v > max(right)):
                out.append((i, v))
    return out


def _pct(a, b):
    if not b:
        return 0.0
    return (a - b) / abs(b) * 100.0


def _clip(v, lo, hi):
    return max(lo, min(hi, v))


def _match(key, score, evidence, **extra):
    meta = LIB_MAP.get(key)
    if not meta:
        return None
    out = {
        "key": key,
        "name": meta["name"],
        "category": meta["category"],
        "direction": meta["direction"],
        "group": meta["group"],
        "desc": meta["desc"],
        "points": meta["points"],
        "entry": meta["entry"],
        "invalid": meta["invalid"],
        "chapter": meta.get("chapter", ""),
        "page": meta.get("page", ""),
        "excerpt": meta.get("excerpt", ""),
        "target": meta.get("target", ""),
        "volume": meta.get("volume", ""),
        "score": round(_clip(score, 35.0, 96.0), 1),
        "evidence": evidence,
    }
    if extra:
        out.update(extra)
    return out


# ---------------------------------------------------------------------------
# 单 K / 组合 K 线
# ---------------------------------------------------------------------------
def _double_bottom(bars, ctx):
    lows = _swings(bars, 3, "low")
    if len(lows) < 2:
        return None
    for i in range(len(lows) - 1, 0, -1):
        i2, p2 = lows[i]
        i1, p1 = lows[i - 1]
        if i2 - i1 < 8:
            continue
        if _pct(p1, bars[max(0, i1 - 20)]["c"]) > -3.0:
            # 第5章：反转形态必须事先存在下降趋势
            continue
        sim = abs(_pct(p2, p1))
        if sim > 4.2:
            continue
        if p2 < p1 * 0.965 or p2 > p1 * 1.035:
            continue
        between = bars[i1:i2 + 1]
        neck = max(x["h"] for x in between)
        depth = _pct(neck, min(p1, p2))
        if depth < 3.0:
            continue
        last = bars[-1]["c"]
        near = _pct(last, neck)
        if near < -4.0:
            continue
        score = 58 + max(0, 12 - sim * 2.5) + min(10, depth * 0.7)
        if near >= 0:
            score += 10
        elif near >= -2:
            score += 4
        ev = ["两个低点 %.2f / %.2f，相差 %.1f%%" % (p1, p2, sim),
              "中间反弹高点（颈线）%.2f，底部深度 %.1f%%" % (neck, depth),
              "现价距颈线 %+.1f%%" % near]
        return _match("double_bottom", score, ev,
                      levels={"support": min(p1, p2), "resistance": neck},
                      target_price=round(neck + (neck - min(p1, p2)), 3),
                      stage="底部构筑" if near < 0 else "颈线突破")
    return None


def _double_top(bars, ctx):
    highs = _swings(bars, 3, "high")
    if len(highs) < 2:
        return None
    for i in range(len(highs) - 1, 0, -1):
        i2, p2 = highs[i]
        i1, p1 = highs[i - 1]
        if i2 - i1 < 8:
            continue
        if _pct(p1, bars[max(0, i1 - 20)]["c"]) < 3.0:
            # 第5章：反转形态必须事先存在上升趋势
            continue
        sim = abs(_pct(p2, p1))
        if sim > 4.2:
            continue
        between = bars[i1:i2 + 1]
        neck = min(x["l"] for x in between)
        depth = _pct(max(p1, p2), neck)
        if depth < 3.0:
            continue
        last = bars[-1]["c"]
        near = _pct(last, neck)
        if near > 4.0:
            continue
        score = 58 + max(0, 12 - sim * 2.5) + min(10, depth * 0.7)
        if near <= 0:
            score += 10
        elif near <= 2:
            score += 4
        return _match("double_top", score,
                      ["两个高点 %.2f / %.2f，相差 %.1f%%" % (p1, p2, sim),
                       "中间回落低点（颈线）%.2f，顶部深度 %.1f%%" % (neck, depth),
                       "现价距颈线 %+.1f%%" % near],
                      levels={"support": neck, "resistance": max(p1, p2)},
                      target_price=round(neck - (max(p1, p2) - neck), 3),
                      stage="顶部构筑" if near > 0 else "颈线破位")
    return None


def _head_shoulders_bottom(bars, ctx):
    lows = _swings(bars, 3, "low")
    if len(lows) < 3:
        return None
    i3, p3 = lows[-1]
    i2, p2 = lows[-2]
    i1, p1 = lows[-3]
    if not (i3 - i2 >= 5 and i2 - i1 >= 5):
        return None
    if _pct(p1, bars[max(0, i1 - 20)]["c"]) > -3.0:
        return None
    if not (p2 < p1 * 0.982 and p2 < p3 * 0.982):
        return None
    if abs(_pct(p3, p1)) > 5.5:
        return None
    ln = max(x["h"] for x in bars[i1:i2 + 1])
    rn = max(x["h"] for x in bars[i2:i3 + 1])
    neck = min(ln, rn)
    depth = _pct(neck, p2)
    if depth < 4:
        return None
    last = bars[-1]["c"]
    near = _pct(last, neck)
    if near < -5:
        return None
    score = 64 + (10 if abs(_pct(p3, p1)) < 3 else 3) + min(10, depth * 0.6) + (8 if near >= 0 else 0)
    return _match("head_shoulders_bottom", score,
                  ["左肩 %.2f / 头部 %.2f / 右肩 %.2f" % (p1, p2, p3),
                   "头部低于双肩 %.1f%%" % abs(_pct(p2, max(p1, p3))),
                   "颈线 %.2f，现价 %+.1f%%" % (neck, near)],
                  levels={"support": p2, "resistance": neck},
                  target_price=round(neck + (neck - p2), 3))


def _head_shoulders_top(bars, ctx):
    highs = _swings(bars, 3, "high")
    if len(highs) < 3:
        return None
    i3, p3 = highs[-1]
    i2, p2 = highs[-2]
    i1, p1 = highs[-3]
    if not (i3 - i2 >= 5 and i2 - i1 >= 5):
        return None
    if _pct(p1, bars[max(0, i1 - 20)]["c"]) < 3.0:
        return None
    if not (p2 > p1 * 1.018 and p2 > p3 * 1.018):
        return None
    if abs(_pct(p3, p1)) > 5.5:
        return None
    ln = min(x["l"] for x in bars[i1:i2 + 1])
    rn = min(x["l"] for x in bars[i2:i3 + 1])
    neck = max(ln, rn)
    depth = _pct(p2, neck)
    if depth < 4:
        return None
    last = bars[-1]["c"]
    near = _pct(last, neck)
    if near > 5:
        return None
    score = 64 + (10 if abs(_pct(p3, p1)) < 3 else 3) + min(10, depth * 0.6) + (8 if near <= 0 else 0)
    return _match("head_shoulders_top", score,
                  ["左肩 %.2f / 头部 %.2f / 右肩 %.2f" % (p1, p2, p3),
                   "头部高于双肩 %.1f%%" % abs(_pct(p2, max(p1, p3))),
                   "颈线 %.2f，现价 %+.1f%%" % (neck, near)],
                  levels={"support": neck, "resistance": p2},
                  target_price=round(neck - (p2 - neck), 3))


def _triangle(bars, ctx):
    n = min(70, len(bars))
    seg = bars[-n:]
    highs = [(i, b["h"]) for i, b in enumerate(seg)]
    lows = [(i, b["l"]) for i, b in enumerate(seg)]
    hk, _ = _line(highs)
    lk, _ = _line(lows)
    atr = ctx["atr"]
    hs = hk / atr
    ls = lk / atr
    rng = _pct(max(x["h"] for x in seg), min(x["l"] for x in seg))
    first = seg[:max(12, n // 2)]
    last = seg[max(0, n // 2 - 4):]
    r1 = _pct(max(x["h"] for x in first), min(x["l"] for x in first))
    r2 = _pct(max(x["h"] for x in last), min(x["l"] for x in last))
    shrink = r2 < r1 * 0.82
    last_c = bars[-1]["c"]
    hi = max(x["h"] for x in seg)
    lo = min(x["l"] for x in seg)
    if abs(hs) < 0.075 and ls > 0.045 and shrink and _pct(last_c, hi) > -4.5:
        score = 60 + (10 if shrink else 0) + min(10, abs(ls) * 40) + (8 if _pct(last_c, hi) > -1.5 else 0)
        return _match("ascending_triangle", score,
                      ["高点连线斜率 %.3f ATR/根，压力位趋于水平" % hs,
                       "低点连线斜率 %.3f ATR/根，低点抬高" % ls,
                       "后段振幅由 %.1f%% 收敛至 %.1f%%" % (r1, r2)],
                      levels={"support": lo, "resistance": hi})
    if abs(ls) < 0.075 and hs < -0.045 and shrink and _pct(last_c, lo) < 4.5:
        score = 60 + min(10, abs(hs) * 40) + (8 if _pct(last_c, lo) < 1.5 else 0)
        return _match("descending_triangle", score,
                      ["低点连线斜率 %.3f ATR/根，支撑位趋于水平" % ls,
                       "高点连线斜率 %.3f ATR/根，高点降低" % hs,
                       "后段振幅由 %.1f%% 收敛至 %.1f%%" % (r1, r2)],
                      levels={"support": lo, "resistance": hi})
    if hs < -0.012 and ls > 0.012 and shrink:
        score = 58 + min(10, (abs(hs) + ls) * 35)
        if _pct(last_c, hi) > -3 or _pct(last_c, lo) < 3:
            score += 5
        return _match("symmetrical_triangle", score,
                      ["高点降低（%.3f ATR/根），低点抬高（%.3f ATR/根）" % (hs, ls),
                       "振幅由 %.1f%% 收敛至 %.1f%%，临近方向选择" % (r1, r2)],
                      levels={"support": lo, "resistance": hi})
    return None


def _flag(bars, ctx):
    n = min(55, len(bars))
    seg = bars[-n:]
    # 找最近一段 6~14 根内最快的单边行情
    best = None
    for length in range(6, min(15, len(seg) // 2 + 1)):
        for end in range(length, len(seg) - 3):
            start = end - length
            base = seg[start]["c"]
            move = _pct(seg[end]["c"], base)
            if best is None or abs(move) > abs(best[0]):
                best = (move, start, end)
    if not best:
        return None
    move, start, end = best
    after = seg[end + 1:]
    if len(after) < 3:
        return None
    if move > 8:
        hi = max(x["h"] for x in seg[start:end + 1])
        pull = _pct(hi, min(x["l"] for x in after))
        if pull > 8:
            return None
        cons = _pct(max(x["h"] for x in after), min(x["l"] for x in after))
        last = seg[-1]["c"]
        score = 64 + min(14, abs(move) * 0.35) + (8 if cons < 5 else 0)
        if _pct(last, hi) > -3:
            score += 6
        return _match("bull_flag", score,
                      ["旗杆 %d 根上涨 %.1f%%" % (end - start + 1, move),
                       "随后 %d 根最大回撤仅 %.1f%%" % (len(after), pull),
                       "整理区振幅 %.1f%%" % cons],
                      levels={"support": min(x["l"] for x in after), "resistance": hi})
    if move < -8:
        lo = min(x["l"] for x in seg[start:end + 1])
        bounce = _pct(max(x["h"] for x in after), lo)
        if bounce > 8:
            return None
        cons = _pct(max(x["h"] for x in after), min(x["l"] for x in after))
        last = seg[-1]["c"]
        score = 64 + min(14, abs(move) * 0.35) + (8 if cons < 5 else 0)
        if _pct(last, lo) < 3:
            score += 6
        return _match("bear_flag", score,
                      ["旗杆 %d 根下跌 %.1f%%" % (end - start + 1, move),
                       "随后 %d 根最大反弹仅 %.1f%%" % (len(after), bounce),
                       "整理区振幅 %.1f%%" % cons],
                      levels={"support": lo, "resistance": max(x["h"] for x in after)})
    return None


def _rectangle(bars, ctx):
    n = min(55, len(bars))
    seg = bars[-n:]
    hi = max(x["h"] for x in seg)
    lo = min(x["l"] for x in seg)
    mid = (hi + lo) / 2.0
    rng = _pct(hi, lo)
    if rng > 10.5:
        return None
    hk, _ = _line([(i, b["h"]) for i, b in enumerate(seg)])
    lk, _ = _line([(i, b["l"]) for i, b in enumerate(seg)])
    if abs(hk) / ctx["atr"] > 0.09 or abs(lk) / ctx["atr"] > 0.09:
        return None
    last = bars[-1]["c"]
    pos = (last - lo) / max(hi - lo, 1e-9)
    if pos < 0.15 or pos > 0.85:
        score = 58 + (10 if pos > 0.85 or pos < 0.15 else 0)
        return _match("rectangle", score,
                      ["近 %d 根在 %.2f ~ %.2f 之间震荡，箱体振幅 %.1f%%" % (n, lo, hi, rng),
                       "现价位于箱体 %.0f%% 位置" % (pos * 100)],
                      levels={"support": lo, "resistance": hi})
    return None


def _triple_top(bars, ctx):
    highs = _swings(bars, 3, "high")
    if len(highs) < 3:
        return None
    (i1, p1), (i2, p2), (i3, p3) = highs[-3:]
    if min(i2 - i1, i3 - i2) < 5 or len(bars) - 1 - i3 > 30:
        return None
    if _pct(p1, bars[max(0, i1 - 20)]["c"]) < 3.0:
        return None
    vals = [p1, p2, p3]
    spread = (max(vals) - min(vals)) / _mean(vals) * 100
    if spread > 4.0:
        return None
    neck = min(x["l"] for x in bars[i1:i3 + 1])
    depth = _pct(max(vals), neck)
    if depth < 3.0:
        return None
    last = bars[-1]["c"]
    near = _pct(last, neck)
    if near > 1.6:
        return None
    score = 66 + (10 if spread < 2 else 5) + min(10, depth * 0.5) + (8 if near <= 0 else 2)
    target = neck - (max(vals) - neck)
    return _match("triple_top", score,
                  ["三个高点 %.2f / %.2f / %.2f，最大相差 %.1f%%" % (p1, p2, p3, spread),
                   "颈线 %.2f，顶部高度 %.1f%%" % (neck, depth),
                   "现价距颈线 %+.1f%%" % near],
                  levels={"support": neck, "resistance": max(vals)},
                  target_price=round(target, 3))


def _triple_bottom(bars, ctx):
    lows = _swings(bars, 3, "low")
    if len(lows) < 3:
        return None
    (i1, p1), (i2, p2), (i3, p3) = lows[-3:]
    if min(i2 - i1, i3 - i2) < 5 or len(bars) - 1 - i3 > 30:
        return None
    if _pct(p1, bars[max(0, i1 - 20)]["c"]) > -3.0:
        return None
    vals = [p1, p2, p3]
    spread = (max(vals) - min(vals)) / _mean(vals) * 100
    if spread > 4.0:
        return None
    neck = max(x["h"] for x in bars[i1:i3 + 1])
    depth = _pct(neck, min(vals))
    if depth < 3.0:
        return None
    last = bars[-1]["c"]
    near = _pct(last, neck)
    if near < -1.6:
        return None
    score = 66 + (10 if spread < 2 else 5) + min(10, depth * 0.5) + (8 if near >= 0 else 2)
    target = neck + (neck - min(vals))
    return _match("triple_bottom", score,
                  ["三个低点 %.2f / %.2f / %.2f，最大相差 %.1f%%" % (p1, p2, p3, spread),
                   "颈线 %.2f，底部深度 %.1f%%" % (neck, depth),
                   "现价距颈线 %+.1f%%" % near],
                  levels={"support": min(vals), "resistance": neck},
                  target_price=round(target, 3))


def _pennant(bars, ctx):
    n = min(62, len(bars))
    if n < 30:
        return None
    seg = bars[-n:]
    best = None
    for length in range(5, 13):
        for end in range(length, len(seg) - 2):
            move = _pct(seg[end]["c"], seg[end - length]["c"])
            if best is None or abs(move) > abs(best[0]):
                best = (move, end - length, end)
    if not best:
        return None
    move, start, end = best
    after = seg[end + 1:]
    if not (3 <= len(after) <= 12) or abs(move) < 7:
        return None
    hi = max(x["h"] for x in after)
    lo = min(x["l"] for x in after)
    rng = _pct(hi, lo)
    if rng > 7.0:
        return None
    hs = _line([(i, x["h"]) for i, x in enumerate(after)])[0] / ctx["atr"]
    ls = _line([(i, x["l"]) for i, x in enumerate(after)])[0] / ctx["atr"]
    converge = (hs < 0.03 and ls > -0.03) or rng < 4.5
    if not converge:
        return None
    if move > 0:
        score = 65 + min(12, move * 0.35) + (8 if rng < 4 else 0)
        target = hi + (hi - seg[start]["c"])
        return _match("bull_pennant", score,
                      ["旗杆 %d 根上涨 %.1f%%" % (end - start + 1, move),
                       "随后 %d 根收敛整理，振幅 %.1f%%" % (len(after), rng),
                       "突破上沿后按旗杆高度测算"],
                      levels={"support": lo, "resistance": hi},
                      target_price=round(target, 3))
    if move < 0:
        score = 65 + min(12, abs(move) * 0.35) + (8 if rng < 4 else 0)
        target = lo - (seg[start]["c"] - lo)
        return _match("bear_pennant", score,
                      ["旗杆 %d 根下跌 %.1f%%" % (end - start + 1, move),
                       "随后 %d 根收敛整理，振幅 %.1f%%" % (len(after), rng),
                       "跌破下沿后按旗杆高度测算"],
                      levels={"support": lo, "resistance": hi},
                      target_price=round(target, 3))
    return None


def _wedge(bars, ctx):
    n = min(48, len(bars))
    if n < 30:
        return None
    seg = bars[-n:]
    hs = _line([(i, x["h"]) for i, x in enumerate(seg)])[0] / ctx["atr"]
    ls = _line([(i, x["l"]) for i, x in enumerate(seg)])[0] / ctx["atr"]
    hi = max(x["h"] for x in seg)
    lo = min(x["l"] for x in seg)
    width = _pct(hi, lo)
    if width > 22:
        return None
    last = bars[-1]["c"]
    if hs > 0.02 and ls > 0.02 and hs < ls * 0.82:
        score = 64 + min(12, (ls - hs) * 30) + (8 if _pct(last, lo) < 6 else 0)
        target = lo - (hi - lo) * 0.75
        return _match("rising_wedge", score,
                      ["上下轨同时向上，但高点抬升慢于低点（%.3f / %.3f ATR/根）" % (hs, ls),
                       "价格靠近收敛末端，偏向看跌"],
                      levels={"support": lo, "resistance": hi},
                      target_price=round(target, 3))
    if hs < -0.02 and ls < -0.02 and hs > ls * 0.82:
        score = 64 + min(12, (hs - ls) * 30) + (8 if _pct(last, hi) > -6 else 0)
        target = hi + (hi - lo) * 0.75
        return _match("falling_wedge", score,
                      ["上下轨同时向下，但低点下降慢于高点（%.3f / %.3f ATR/根）" % (hs, ls),
                       "价格靠近收敛末端，偏向看涨"],
                      levels={"support": lo, "resistance": hi},
                      target_price=round(target, 3))
    return None


def _v_reversal(bars, ctx):
    if len(bars) < 7:
        return None
    seg = bars[-7:]
    lows = [x["l"] for x in seg]
    highs = [x["h"] for x in seg]
    lo_i = min(range(len(seg)), key=lambda i: lows[i])
    hi_i = max(range(len(seg)), key=lambda i: highs[i])
    last = bars[-1]["c"]
    if 1 <= lo_i <= 4 and _pct(seg[lo_i]["c"], seg[max(0, lo_i - 3)]["c"]) < -2.5:
        rebound = _pct(last, seg[lo_i]["c"])
        if rebound > 2.0:
            return _match("v_reversal", 62 + min(12, rebound * 1.5),
                          ["前段快速下跌后出现尖锐低点", "自低点反弹 %.1f%%" % rebound],
                          direction="bullish", levels={"support": lows[lo_i], "resistance": max(highs)},
                          target_price=round(max(highs), 3))
    if 1 <= hi_i <= 4 and _pct(seg[hi_i]["c"], seg[max(0, hi_i - 3)]["c"]) > 2.5:
        fall = _pct(last, seg[hi_i]["c"])
        if fall < -2.0:
            return _match("v_reversal", 62 + min(12, abs(fall) * 1.5),
                          ["前段快速上涨后出现尖锐高点", "自高点回落 %.1f%%" % fall],
                          direction="bearish", levels={"support": min(lows), "resistance": highs[hi_i]},
                          target_price=round(min(lows), 3))
    return None


def _broadening_top(bars, ctx):
    highs = _swings(bars, 3, "high")
    lows = _swings(bars, 3, "low")
    if len(highs) < 3 or len(lows) < 2:
        return None
    (h1, p1), (h2, p2), (h3, p3) = highs[-3:]
    (l1, q1), (l2, q2) = lows[-2:]
    if not (p1 < p2 < p3 and q1 > q2):
        return None
    if _pct(p1, bars[max(0, h1 - 20)]["c"]) < 3.0:
        return None
    if min(h2 - h1, h3 - h2, l2 - l1) < 4:
        return None
    if len(bars) - 1 - max(h3, l2) > 20:
        return None
    last = bars[-1]["c"]
    near = _pct(last, q2)
    if near > 1.0:
        return None
    width = _pct(p3, q2)
    score = 66 + (8 if p3 > p2 > p1 else 0) + (8 if q2 < q1 else 0) + min(10, width * 0.4) + (8 if near <= 0 else 2)
    target = q2 - (p3 - q2) * 0.75
    return _match("broadening_top", score,
                  ["三个峰依次抬高 %.2f / %.2f / %.2f" % (p1, p2, p3),
                   "两个谷依次降低 %.2f / %.2f，波幅扩大" % (q1, q2),
                   "现价距第二谷 %+.1f%%" % near],
                  levels={"support": q2, "resistance": p3},
                  target_price=round(target, 3))


DETECTORS = [
    _head_shoulders_bottom, _head_shoulders_top,
    _triple_bottom, _triple_top, _double_bottom, _double_top,
    _v_reversal, _pennant, _flag, _wedge, _triangle, _rectangle,
    _broadening_top,
]


# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
def _trend(bars):
    n = min(60, len(bars))
    seg = bars[-n:]
    closes = [x["c"] for x in seg]
    slope = _slope(closes)
    ref = _mean(closes) or closes[-1]
    per20 = slope * 20 / ref * 100
    hi = max(x["h"] for x in seg)
    lo = min(x["l"] for x in seg)
    atr = _atr(bars)
    if per20 > 2.2:
        phase, direction = "上升趋势", "bullish"
    elif per20 < -2.2:
        phase, direction = "下降趋势", "bearish"
    else:
        phase, direction = "区间震荡", "neutral"
    strength = _clip(abs(per20) * 8 + (atr / ref * 100) * 6, 0, 100)
    return {
        "phase": phase,
        "direction": direction,
        "slope20": round(per20, 2),
        "strength": round(strength, 1),
        "range": round(_pct(hi, lo), 2),
    }, atr


def analyze(raw_bars, limit=420):
    bars = normalize_bars(raw_bars, limit)
    if len(bars) < 6:
        return {
            "ok": False,
            "error": "有效K线少于 6 根，无法识别形态。请重新框选只包含K线图的价格区域。",
            "bars": len(bars),
        }
    trend, atr = _trend(bars)
    closes = [x["c"] for x in bars]
    ctx = {
        "atr": atr,
        "last": closes[-1],
        "avg_body": _mean([abs(x["c"] - x["o"]) for x in bars[-20:]]),
        "avg_range": _mean([x["h"] - x["l"] for x in bars[-20:]]),
        "trend": trend,
    }
    matches = []
    for fn in DETECTORS:
        try:
            m = fn(bars, ctx)
        except (IndexError, ValueError, ZeroDivisionError):
            m = None
        if m:
            matches.append(m)
    # 同一形态只保留分数最高的一条
    best = {}
    for m in matches:
        if m["key"] not in best or m["score"] > best[m["key"]]["score"]:
            best[m["key"]] = m
    matches = sorted(best.values(), key=lambda x: x["score"], reverse=True)[:7]

    bull = sum(m["score"] for m in matches if m["direction"] == "bullish")
    bear = sum(m["score"] for m in matches if m["direction"] == "bearish")
    neutral = sum(m["score"] for m in matches if m["direction"] == "neutral")
    bull_max = max([m["score"] for m in matches if m["direction"] == "bullish"] or [0])
    bear_max = max([m["score"] for m in matches if m["direction"] == "bearish"] or [0])
    if bull_max and bear_max and abs(bull_max - bear_max) <= max(6.0, max(bull_max, bear_max) * 0.12):
        bias, bias_dir = "多空分歧", "neutral"
    elif bull_max > bear_max * 1.12 and bull_max >= 55:
        bias, bias_dir = "偏多", "bullish"
    elif bear_max > bull_max * 1.12 and bear_max >= 55:
        bias, bias_dir = "偏空", "bearish"
    elif bull and bear:
        bias, bias_dir = "多空分歧", "neutral"
    else:
        bias, bias_dir = "方向待确认", "neutral"
    if trend["direction"] == "bullish" and bias_dir == "bullish":
        bias = "顺势偏多"
    elif trend["direction"] == "bearish" and bias_dir == "bearish":
        bias = "顺势偏空"

    n = min(60, len(bars))
    seg = bars[-n:]
    support = min(x["l"] for x in seg)
    resistance = max(x["h"] for x in seg)
    # 优先采用更近的结构位
    for m in matches:
        lv = m.get("levels") or {}
        if lv.get("support") and lv["support"] < closes[-1]:
            support = max(support, lv["support"])
        if lv.get("resistance") and lv["resistance"] > closes[-1]:
            resistance = min(resistance, lv["resistance"])
    top = matches[0]["score"] if matches else 0
    confidence = _clip(top * 0.7 + (20 if bias_dir != "neutral" else 8) - (12 if bias == "多空分歧" else 0), 0, 96)
    if not matches:
        confidence = _clip(35 + trend["strength"] * 0.3, 0, 60)
    vols = [x["v"] for x in bars[-21:] if x.get("v", 0) > 0]
    vol_ratio = None
    if len(vols) >= 5 and bars[-1].get("v", 0) > 0:
        vol_ratio = bars[-1]["v"] / max(_mean(vols[:-1]), 1e-9)
    if vol_ratio is None:
        volume = {"ratio": None, "confirmed": None, "text": "截图未包含成交量，量能需结合原图判断"}
    else:
        confirmed = vol_ratio >= 1.2
        volume = {
            "ratio": round(vol_ratio, 2),
            "confirmed": confirmed,
            "text": ("放量，量能确认" if confirmed else "未明显放量，需等待确认") + "（近20根均量的 %.2f 倍）" % vol_ratio,
        }
    return {
        "ok": True,
        "bars": len(bars),
        "trend": trend,
        "bias": bias,
        "bias_dir": bias_dir,
        "confidence": round(confidence, 1),
        "matches": matches,
        "levels": {
            "support": round(support, 3),
            "resistance": round(resistance, 3),
            "last": round(closes[-1], 3),
        },
        "volume": volume,
        "source": "《期货市场技术分析》（1994 中文版）第4–6章形态体系",
        "high": round(max(x["h"] for x in bars), 3),
        "low": round(min(x["l"] for x in bars), 3),
        "note": "匹配度由规则模型按价格结构计算，代表形态相似程度，不等同于涨跌概率。形态完成还需要突破与量能确认。",
    }


def best_quiz_match(raw_bars):
    """给形态测验用：返回更可靠的单一形态。"""
    res = analyze(raw_bars)
    if not res.get("ok"):
        return None, res
    preferred = [m for m in res["matches"]
                 if m["group"] in ("reversal", "continuation") and m["score"] >= 70]
    if not preferred:
        return None, res
    return preferred[0], res
