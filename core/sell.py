# -*- coding: utf-8 -*-
"""主力出货评分（依据《主力出货的5种方式》）。

所有判断只用「当天及以前」的数据，逐根 K 线滚动计算，
因此图上标出的卖点不存在马后炮（不会用到未来数据）。
"""
from core.indicators import _mean

WEIGHTS = {
    "S1": 45,   # 加速后单日放天量大阴线
    "S2": 40,   # 加速后次高点突然巨量长阴
    "S3": 30,   # 新高后连续阶梯放量下跌
    "S4": 32,   # 双头双放量巨阴
    "S5": 22,   # 顶部绿长红短（绿肥红瘦）
    "S6": 32,   # 顶部大风车（巨量长上影、收在低位）
}

LABELS = {
    "S1": "S1 加速后天量大阴线",
    "S2": "S2 次高点突然巨量长阴",
    "S3": "S3 阶梯放量下跌",
    "S4": "S4 双头双放量巨阴",
    "S5": "S5 顶部绿长红短",
    "S6": "顶部大风车（巨量长上影）",
}


def _pct(closes, i, n):
    if i < n:
        return 0.0
    base = closes[i - n]
    return (closes[i] / base - 1.0) * 100.0 if base else 0.0


def _avg(values):
    return sum(values) / float(len(values)) if values else 0.0


def _double_top(ohlc, vols, i):
    """在最近 40 根里找两个相近的高点，且第二个量不小于第一个。"""
    start = max(0, i - 40)
    highs = [(j, ohlc[j][3]) for j in range(start, i + 1)]
    if len(highs) < 12:
        return None
    highs.sort(key=lambda x: x[1], reverse=True)
    first = highs[0]
    for cand in highs[1:]:
        if abs(first[0] - cand[0]) < 5:
            continue
        if abs(first[1] / cand[1] - 1.0) <= 0.03:
            lo, hi = sorted([first[0], cand[0]])
            if hi - lo < 5:
                continue
            neck = min(ohlc[j][2] for j in range(lo, hi + 1))
            v_first = vols[min(first[0], cand[0])]
            v_second = vols[max(first[0], cand[0])]
            if v_second >= v_first * 1.05 and ohlc[i][1] < neck:
                return {"peak1": first[0], "peak2": cand[0], "neck": neck}
        break
    return None


def detect_signals(series):
    """逐根计算卖点信号，返回 [{index,date,price,type,reason}]。"""
    dates = series["dates"]
    ohlc = series["ohlc"]
    vols = series["volumes"]
    white = series["white"]
    yellow = series["yellow"]
    closes = [x[1] for x in ohlc]

    out = []
    last_hit = {}
    for i in range(25, len(ohlc)):
        o, c, l, h = ohlc[i]
        pc = closes[i - 1]
        pct = (c / pc - 1.0) * 100.0 if pc else 0.0
        body = c - o
        upper = h - max(o, c)
        avg5 = _avg(vols[i - 5:i])
        max20 = max(vols[i - 20:i]) if i >= 20 else vols[i]
        v = vols[i]
        pct20 = _pct(closes, i, 20)
        high20 = max(ohlc[j][3] for j in range(max(0, i - 20), i)) if i else h
        # 加速用「下跌之前」的涨幅/前高判断，避免大阴线当天把 20 日涨幅打没
        base_idx = max(0, i - 21)
        run_up = ((high20 / ohlc[base_idx][1] - 1.0) * 100.0) if ohlc[base_idx][1] else 0.0
        accel = (run_up >= 18.0 or _pct(closes, i - 1, 20) >= 15.0
                 or _pct(closes, i - 1, 10) >= 12.0)
        w = white[i] if white[i] is not None else 0
        y = yellow[i] if yellow[i] is not None else 0

        sigs = []
        # S1 加速之后单日放天量大阴线（成交量创 20 日新高）
        if accel and pct <= -4.0 and v >= max20:
            sigs.append(("S1", "加速后放天量大阴线（%.1f%%，量能 %.1f 倍）"
                         % (pct, v / avg5 if avg5 else 0)))
        # S6 顶部大风车：巨量长上影、收在低位
        if accel and upper >= max(abs(body) * 2.0, h * 0.02) and v >= avg5 * 1.5 and c < (h + l) / 2:
            sigs.append(("S6", "顶部大风车：巨量长上影，收在当日低位"))
        # S2 加速之后次高点突然巨量长阴（成交量创 10 日新高，且前一日缩量）
        max10 = max(vols[max(0, i - 10):i]) if i >= 2 else v
        if (accel and not any(t == "S1" for t, _ in sigs)
                and high20 and h <= high20 * 0.995 and h >= high20 * 0.95
                and pct <= -4.0 and v >= max10 * 1.05
                and (i < 2 or vols[i - 1] <= _avg(vols[max(0, i - 6):i - 1]) * 1.1)):
            sigs.append(("S2", "次高点突然巨量长阴（%.1f%%）" % pct))
        # S3 新高之后连续阶梯放量下跌
        if i >= 4:
            down3 = closes[i] < closes[i - 1] < closes[i - 2] < closes[i - 3]
            up_vol = [vols[j] for j in range(max(0, i - 10), i) if closes[j] >= closes[j - 1]]
            vol_step = vols[i] > vols[i - 1] > vols[i - 2]
            if (down3 and vol_step and v >= _avg(up_vol) * 1.2
                    and ((w and c < w) or (y and c < y))):
                sigs.append(("S3", "连续阶梯放量下跌，跌破%s"
                             % ("白线" if w and c < w else "黄线")))
        # S4 双头双放量巨阴
        if pct <= -4.0 and v >= avg5 * 1.5:
            dt = _double_top(ohlc, vols, i)
            if dt:
                sigs.append(("S4", "双头（%.0f→%.0f）后放量破颈线"
                             % (dt["peak1"], dt["peak2"])))
        # S5 顶部绿长红短（绿肥红瘦）
        if i >= 10 and pct20 >= 15.0 and c >= high20 * 0.98:
            window = range(i - 9, i + 1)
            green = sum(max(closes[j] - ohlc[j][0], 0) for j in window)
            red = sum(max(ohlc[j][0] - closes[j], 0) for j in window)
            gv = sum(vols[j] for j in window if closes[j] >= ohlc[j][0])
            rv = sum(vols[j] for j in window if closes[j] < ohlc[j][0])
            if green > red * 2.0 and gv > rv * 1.5:
                sigs.append(("S5", "顶部绿长红短，绿肥红瘦"))

        for typ, reason in sigs:
            last = last_hit.get(typ, -99)
            if i - last < 8:
                continue
            last_hit[typ] = i
            out.append({"index": i, "date": dates[i], "price": round(h, 2),
                        "type": typ, "reason": reason})
    return out


CATEGORY_OF = {
    "S1": "top", "S2": "top", "S3": "top", "S4": "top", "S5": "top", "S6": "top",
    "破白线": "trend", "破黄线": "trend",
    "放量滞涨": "volume", "长上影": "volume",
    "涨幅过大": "extend", "KDJ超买": "extend",
}
CATEGORY_NAMES = {"top": "顶部形态", "trend": "趋势破位", "volume": "量能异常", "extend": "位置过热"}
CATEGORY_ORDER = ["top", "trend", "volume", "extend"]


def evaluate(series):
    """对最新一根 K 线给出出货评分、结论和理由。"""
    signals = detect_signals(series)
    n = len(series["dates"]) - 1
    ohlc = series["ohlc"]
    vols = series["volumes"]
    closes = [x[1] for x in ohlc]
    white = series["white"]
    yellow = series["yellow"]
    j = series["j"][-1]

    recent = [s for s in signals if s["index"] >= n - 5]
    seen = {}
    for s in recent:
        seen[s["type"]] = s

    score = 0
    reasons = []
    cats = {k: {"key": k, "name": CATEGORY_NAMES[k], "score": 0, "items": []}
            for k in CATEGORY_ORDER}

    def add(typ, text, points):
        nonlocal score
        score += points
        reasons.append({"type": typ, "text": text, "points": points})
        cat = cats[CATEGORY_OF.get(typ, "top")]
        cat["score"] += points
        cat["items"].append({"type": typ, "text": text, "points": points})

    for typ, s in seen.items():
        add(typ, s["reason"], WEIGHTS.get(typ, 10))

    c = closes[-1]
    w = white[-1] if white[-1] is not None else 0
    y = yellow[-1] if yellow[-1] is not None else 0
    if w and c < w:
        add("破白线", "收盘跌破白线（短期趋势）", 15)
    if y and c < y:
        add("破黄线", "收盘跌破黄线（多空线）", 15)
    if n >= 20:
        p20 = (c / closes[n - 20] - 1.0) * 100.0 if closes[n - 20] else 0
        if p20 > 40:
            add("涨幅过大", "20 日涨幅 %.0f%%，位置偏高" % p20, 8)
    if j is not None and j > 100:
        add("KDJ超买", "KDJ 的 J=%.2f，超买" % j, 5)

    # 放量滞涨 / 高位长上影
    if len(ohlc) >= 2:
        o, cc, l, h = ohlc[-1]
        avg5 = _avg(vols[-6:-1])
        pct = (cc / closes[-2] - 1.0) * 100.0 if closes[-2] else 0
        if abs(pct) < 1.0 and avg5 and vols[-1] > avg5 * 2.0:
            add("放量滞涨", "放量但涨幅仅 %.1f%%，有出货嫌疑" % pct, 8)
        upper = h - max(o, cc)
        if upper > max(abs(cc - o) * 2.0, h * 0.02) and h >= max(x[3] for x in ohlc[-21:]):
            add("长上影", "高位长上影，上方抛压重", 8)

    score = max(0, min(100, int(round(score))))

    if score >= 60:
        verdict, level = "卖出", "danger"
    elif score >= 40:
        verdict, level = "减仓", "warn"
    elif score >= 20:
        verdict, level = "观察", "watch"
    else:
        verdict, level = "持有", "ok"

    # 图上只标最近 30 个交易日内的卖点
    markers = [s for s in signals if s["index"] >= n - 29][-12:]
    return {
        "score": score,
        "verdict": verdict,
        "level": level,
        "reasons": reasons,
        "categories": [cats[k] for k in CATEGORY_ORDER],
        "markers": markers,
        "signal_count": len(signals),
    }

