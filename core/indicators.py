# -*- coding: utf-8 -*-
"""指标计算：把本地日线与实时行情合成，输出一只股票的完整特征。

包含用户自定义指标：
  - 黄白线：知行短期趋势线（白）= EMA(EMA(C,10),10)
            知行多空线（黄）=(MA(C,14)+MA(C,28)+MA(C,57)+MA(C,114))/4
  - 砖型图：VAR6A 红绿柱
  - 补票战法：短期/中期/中长期/长期 四线
  - KDJ(9,3,3)
"""


def _mean(values, n):
    if len(values) < n or n <= 0:
        return None
    return sum(values[-n:]) / float(n)


def _fmt_date(ts):
    return "%04d-%02d-%02d" % (ts // 10000, (ts // 100) % 100, ts % 100)


def _ema_series(values, n):
    """通达信 EMA：EMA(X,N) = 2/(N+1)*X + (N-1)/(N+1)*EMA_prev"""
    if not values:
        return []
    k = 2.0 / (n + 1.0)
    out = [float(values[0])]
    for v in values[1:]:
        out.append(out[-1] + k * (v - out[-1]))
    return out


def _sma_tdx(values, n, m):
    """通达信 SMA(X,N,M) = (M*X + (N-M)*SMA_prev) / N"""
    out = []
    prev = None
    for v in values:
        if prev is None:
            prev = float(v)
        else:
            prev = (m * v + (n - m) * prev) / float(n)
        out.append(prev)
    return out


def _rolling(vals, n, fn):
    return [fn(vals[max(0, i - n + 1):i + 1]) for i in range(len(vals))]


def _div(a, b, default=0.0):
    return a / b if b else default


def build_features(bars, quote, market_date=None, pct_1445=None, use_close=False):
    """bars 为历史日线（可能含今天），quote 为实时行情。

    use_close=True 时（收盘后筛选），优先用当日日线的收盘价，
    没有当日日线时退回行情接口的最新价（收盘后即为收盘价）。
    返回 dict；数据不足返回 None。
    """
    if not quote or quote.get("price", 0) <= 0:
        return None

    today = market_date
    raw_time = str(quote.get("time") or "")
    if len(raw_time) >= 8 and raw_time[:8].isdigit():
        today = int(raw_time[:8])

    today_bar = None
    if bars and today and bars[-1][0] == today:
        today_bar = bars[-1]

    hist = [b for b in bars if not today or b[0] < today]
    if len(hist) < 25:
        return None
    hist = hist[-180:]

    closes = [b[4] for b in hist]
    highs = [b[2] for b in hist]
    lows = [b[3] for b in hist]
    vols = [b[6] / 100.0 for b in hist]  # 股 -> 手

    price = float(quote["price"])
    pre_close = float(quote.get("pre_close") or (closes[-1] if closes else price))
    open_p = float(quote.get("open") or price)
    high_p = float(quote.get("high") or price)
    low_p = float(quote.get("low") or price)
    vol_today = float(quote.get("volume") or 0)

    used_close = False
    if use_close and today_bar:
        # 本地日线已有当日数据：直接用官方收盘价/最高/最低/成交量
        price = float(today_bar[4])
        open_p = float(today_bar[1])
        high_p = float(today_bar[2])
        low_p = float(today_bar[3])
        amount_today = float(today_bar[5])
        vol_today = float(today_bar[6]) / 100.0
        used_close = True
    else:
        amount_today = float(quote.get("amount") or 0.0)

    pct_val = float(quote.get("pct") or 0.0)
    if pre_close:
        pct_val = (price / pre_close - 1.0) * 100.0

    closes_t = closes + [price]
    highs_t = highs + [high_p]
    lows_t = lows + [low_p]

    ma5 = _mean(closes_t, 5)
    ma10 = _mean(closes_t, 10)
    ma20 = _mean(closes_t, 20)
    ma60 = _mean(closes_t, 60)

    # ---------- 黄白线 ----------
    ema10 = _ema_series(closes_t, 10)
    white = _ema_series(ema10, 10)[-1] if ema10 else None
    ma14 = _mean(closes_t, 14)
    ma28 = _mean(closes_t, 28)
    ma57 = _mean(closes_t, 57)
    ma114 = _mean(closes_t, 114)
    yellow = None
    if None not in (ma14, ma28, ma57, ma114):
        yellow = (ma14 + ma28 + ma57 + ma114) / 4.0

    dist_white = abs(price / white - 1.0) * 100.0 if white else 99.0
    dist_yellow = abs(price / yellow - 1.0) * 100.0 if yellow else 99.0
    above_yellow = bool(yellow and price > yellow)
    white_above_yellow = bool(white and yellow and white > yellow)

    # ---------- 砖型图 ----------
    hhv4 = _rolling(highs_t, 4, max)
    llv4 = _rolling(lows_t, 4, min)
    var1a = [(_div(h - c, h - l) * 100.0 - 90.0) for h, l, c in zip(hhv4, llv4, closes_t)]
    var2a = [x + 100.0 for x in _sma_tdx(var1a, 4, 1)]
    var3a = [(_div(c - l, h - l) * 100.0) for h, l, c in zip(hhv4, llv4, closes_t)]
    var4a = _sma_tdx(var3a, 6, 1)
    var5a = [x + 100.0 for x in _sma_tdx(var4a, 6, 1)]
    var6a = [a - b for a, b in zip(var5a, var2a)]
    brick = [(x - 4.0) if x > 4.0 else 0.0 for x in var6a]

    brick_now = brick[-1]
    brick_prev = brick[-2]
    brick_prev2 = brick[-3]
    brick_prev3 = brick[-4]
    brick_turn_red = brick_now > brick_prev and brick_prev > brick_prev2
    brick_red = brick_now > brick_prev
    brick_red_body = brick_now - brick_prev
    # 两根以内最近的一根绿砖
    brick_green_body = 0.0
    brick_green_offset = 0
    if brick_prev > brick_prev2:
        brick_green_body = brick_prev - brick_prev2
        brick_green_offset = 1
    elif brick_prev2 > brick_prev3:
        brick_green_body = brick_prev2 - brick_prev3
        brick_green_offset = 2
    brick_ok = bool(brick_red and brick_green_body > 0 and
                    brick_red_body >= brick_green_body * 2.0 / 3.0)

    # ---------- 补票战法四线 ----------
    def line(n):
        hhv = _rolling(closes_t, n, max)
        llv = _rolling(lows_t, n, min)
        return [_div(c - l, h - l) * 100.0 for h, l, c in zip(hhv, llv, closes_t)]

    short_line = line(3)
    mid_line = line(10)
    midlong_line = line(20)
    long_line = line(21)

    s0, s1 = short_line[-1], short_line[-2]
    m0, m1 = mid_line[-1], mid_line[-2]
    l0, l1 = long_line[-1], long_line[-2]
    bupiao_sizhu = bool(s0 <= 6 and m0 <= 6 and midlong_line[-1] <= 6 and l0 <= 6)
    bupiao_bai20 = bool(s0 <= 20 and l0 >= 60)
    bupiao_cross_red = bool(s0 > l0 and s1 <= l1 and l0 < 20)
    bupiao_cross_yellow = bool(s0 > m0 and s1 <= m1 and m0 < 30)

    # 补票：白线跌破 75 -> 1~5 日内回到 75 上方，期间红线保持在 75 以上
    level = 75.0
    dip = 0
    idx = len(short_line) - 2
    while idx >= 0 and short_line[idx] < level:
        dip += 1
        idx -= 1
    bupiao_dip_days = dip
    dip_slice = short_line[-(dip + 1):-1] if dip >= 1 else []
    bupiao_dip_min = min(dip_slice) if dip_slice else 999.0
    bupiao_return75 = bool(s0 >= level and dip >= 1)
    bupiao_long_hold75 = bool(dip >= 1 and len(long_line) >= dip + 1 and
                              all(x >= level for x in long_line[-(dip + 1):]))
    bupiao_before75 = bool(dip >= 1 and idx >= 0 and
                           short_line[idx] >= level and long_line[idx] >= level)
    bupiao_short_above_mid = bool(s0 > m0)

    # ---------- KDJ(9,3,3) ----------
    hhv9 = _rolling(highs_t, 9, max)
    llv9 = _rolling(lows_t, 9, min)
    rsv = []
    prev = 50.0
    for h, l, c in zip(hhv9, llv9, closes_t):
        if h == l:
            rsv.append(prev)
        else:
            prev = (c - l) / (h - l) * 100.0
            rsv.append(prev)
    k_series = _sma_tdx(rsv, 3, 1)
    d_series = _sma_tdx(k_series, 3, 1)
    k_val = k_series[-1]
    d_val = d_series[-1]
    j_val = 3.0 * k_val - 2.0 * d_val

    # ---------- 其它 ----------
    prev_high20 = max(highs[-20:]) if len(highs) >= 20 else None
    vol_ma5 = _mean(vols, 5)
    vol_multiple = (vol_today / vol_ma5) if (vol_ma5 and vol_today) else 0.0

    # 四类型好图：前期放量、极致缩量、箱体/洗盘特征
    vol_peak20 = max(vols[-20:]) if len(vols) >= 5 else 0.0
    vol_avg60 = _mean(vols, 60) or _mean(vols, len(vols)) or 0.0
    vol_ratio_peak = (vol_today / vol_peak20) if vol_peak20 else 99.0
    vol_expand = (vol_peak20 / vol_avg60) if vol_avg60 else 0.0
    days_since_vol_peak = 0
    if vols:
        window = vols[-20:]
        peak_idx = max(range(len(window)), key=lambda i: window[i])
        days_since_vol_peak = len(window) - 1 - peak_idx
    max_drop20 = 0.0
    if len(closes) >= 2:
        drops = [(closes[i] / closes[i - 1] - 1.0) * 100.0
                 for i in range(max(1, len(closes) - 20), len(closes)) if closes[i - 1]]
        if drops:
            max_drop20 = min(drops)
    c20 = closes[-20:] if len(closes) >= 20 else closes
    range20 = ((max(c20) / min(c20) - 1.0) * 100.0) if c20 and min(c20) else 0.0
    dist_low_white = abs(low_p / white - 1.0) * 100.0 if white else 99.0
    dist_low_yellow = abs(low_p / yellow - 1.0) * 100.0 if yellow else 99.0
    near_support = min(dist_low_white, dist_low_yellow)

    def pct_change(n):
        if len(closes) < n:
            return None
        base = closes[-n]
        return (price / base - 1.0) * 100.0 if base else None

    up_days = 0
    for i in range(len(closes) - 1, 0, -1):
        if closes[i] > closes[i - 1]:
            up_days += 1
        else:
            break

    rng = high_p - low_p
    close_pos = ((price - low_p) / rng) if rng > 0 else 0.5
    amplitude = ((high_p - low_p) / pre_close * 100.0) if pre_close else 0.0
    gap = ((open_p / pre_close - 1.0) * 100.0) if pre_close else 0.0

    use_snapshot = pct_1445 is not None
    feats = {
        "code": quote["code"],
        "market": quote["market"],
        "name": quote.get("name", ""),
        "price": price,
        "pre_close": pre_close,
        "open": open_p,
        "high": high_p,
        "low": low_p,
        "pct": pct_val,
        "volume": vol_today,
        "amount": amount_today,
        "turnover": float(quote.get("turnover") or 0.0),
        "vol_ratio": float(quote.get("vol_ratio") or 0.0),
        "pe": float(quote.get("pe") or 0.0),
        "pb": float(quote.get("pb") or 0.0),
        "float_cap": float(quote.get("float_cap") or 0.0),
        "total_cap": float(quote.get("total_cap") or 0.0),
        "amplitude": amplitude,
        "gap": gap,
        "close_pos": close_pos,
        "avg_price": float(quote.get("avg_price") or 0.0),
        "ma5": ma5,
        "ma10": ma10,
        "ma20": ma20,
        "ma60": ma60,
        "ma_bull": bool(ma5 and ma10 and ma20 and price > ma5 > ma10 > ma20),
        "above_ma20": bool(ma20 and price > ma20),
        "dist_ma20": ((price / ma20 - 1.0) * 100.0) if ma20 else 0.0,
        "new_high20": bool(prev_high20 and high_p >= prev_high20),
        "pct5": pct_change(5),
        "pct10": pct_change(10),
        "pct20": pct_change(20),
        "vol_multiple": vol_multiple,
        "vol_peak20": vol_peak20,
        "vol_avg60": vol_avg60,
        "vol_ratio_peak": vol_ratio_peak,
        "vol_expand": vol_expand,
        "days_since_vol_peak": days_since_vol_peak,
        "max_drop20": max_drop20,
        "range20": range20,
        "near_support": near_support,
        "dist_low_white": dist_low_white,
        "dist_low_yellow": dist_low_yellow,
        "up_days": up_days,
        "bars": len(hist) + 1,
        "last_bar": _fmt_date(hist[-1][0]) if hist else "",
        # 黄白线
        "white": white,
        "yellow": yellow,
        "above_yellow": above_yellow,
        "white_above_yellow": white_above_yellow,
        "dist_white": dist_white,
        "dist_yellow": dist_yellow,
        "near_line": bool(min(dist_white, dist_yellow) < 5.0),
        # 砖型图
        "brick": brick_now,
        "brick_prev": brick_prev,
        "brick_prev2": brick_prev2,
        "brick_prev3": brick_prev3,
        "brick_red": brick_red,
        "brick_turn_red": brick_turn_red,
        "brick_red_body": brick_red_body,
        "brick_green_body": brick_green_body,
        "brick_green_offset": brick_green_offset,
        "brick_ok": brick_ok,
        # 补票
        "bupiao_short": s0,
        "bupiao_mid": m0,
        "bupiao_midlong": midlong_line[-1],
        "bupiao_long": l0,
        "bupiao_sizhu": bupiao_sizhu,
        "bupiao_bai20": bupiao_bai20,
        "bupiao_cross_red": bupiao_cross_red,
        "bupiao_cross_yellow": bupiao_cross_yellow,
        "bupiao_dip_days": bupiao_dip_days,
        "bupiao_dip_min": bupiao_dip_min,
        "bupiao_return75": bupiao_return75,
        "bupiao_long_hold75": bupiao_long_hold75,
        "bupiao_before75": bupiao_before75,
        "bupiao_short_above_mid": bupiao_short_above_mid,
        # KDJ
        "kdj_k": k_val,
        "kdj_d": d_val,
        "kdj_j": j_val,
        # 14:45 快照
        "pct_1445": float(pct_1445) if pct_1445 is not None else pct_val,
        "pct_1445_snapshot": use_snapshot,
        "price_source": "close" if (used_close or use_close) else "realtime",
    }
    return feats

