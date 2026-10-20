# -*- coding: utf-8 -*-
"""K 线图用的序列：K线 + 黄白线 + 砖型图 + KDJ。"""
from core.indicators import _div, _ema_series, _fmt_date, _rolling, _sma_tdx


def _ma_series(values, n):
    out = []
    run = 0.0
    for i, v in enumerate(values):
        run += v
        if i >= n:
            run -= values[i - n]
        out.append(run / n if i >= n - 1 else None)
    return out


def build_series(bars, quote, market_date=None, use_close=False, limit=140):
    if not quote or quote.get("price", 0) <= 0:
        return None
    today = market_date
    t = str(quote.get("time") or "")
    if len(t) >= 8 and t[:8].isdigit():
        today = int(t[:8])

    today_bar = None
    if bars and today and bars[-1][0] == today:
        today_bar = bars[-1]

    hist = [b for b in bars if b[0] < today][-(limit - 1):]
    if len(hist) < 20:
        return None

    if use_close and today_bar:
        o, h, l, c = today_bar[1], today_bar[2], today_bar[3], today_bar[4]
        v = today_bar[6] / 100.0
    else:
        c = float(quote["price"])
        o = float(quote.get("open") or c)
        h = float(quote.get("high") or c)
        l = float(quote.get("low") or c)
        v = float(quote.get("volume") or 0)

    dates = [_fmt_date(b[0]) for b in hist] + [_fmt_date(today or hist[-1][0])]
    opens = [b[1] for b in hist] + [o]
    highs = [b[2] for b in hist] + [h]
    lows = [b[3] for b in hist] + [l]
    closes = [b[4] for b in hist] + [c]
    vols = [b[6] / 100.0 for b in hist] + [v]

    white = _ema_series(_ema_series(closes, 10), 10)
    ma14 = _ma_series(closes, 14)
    ma28 = _ma_series(closes, 28)
    ma57 = _ma_series(closes, 57)
    ma114 = _ma_series(closes, 114)
    yellow = []
    for a, b2, d2, e in zip(ma14, ma28, ma57, ma114):
        yellow.append((a + b2 + d2 + e) / 4.0 if None not in (a, b2, d2, e) else None)

    hhv4 = _rolling(highs, 4, max)
    llv4 = _rolling(lows, 4, min)
    var1a = [(_div(hh - cc, hh - ll) * 100.0 - 90.0)
             for hh, ll, cc in zip(hhv4, llv4, closes)]
    var2a = [x + 100.0 for x in _sma_tdx(var1a, 4, 1)]
    var3a = [(_div(cc - ll, hh - ll) * 100.0)
             for hh, ll, cc in zip(hhv4, llv4, closes)]
    var4a = _sma_tdx(var3a, 6, 1)
    var5a = [x + 100.0 for x in _sma_tdx(var4a, 6, 1)]
    brick = [((a - b2) - 4.0) if (a - b2) > 4.0 else 0.0 for a, b2 in zip(var5a, var2a)]

    hhv9 = _rolling(highs, 9, max)
    llv9 = _rolling(lows, 9, min)
    rsv = []
    prev = 50.0
    for hh, ll, cc in zip(hhv9, llv9, closes):
        if hh == ll:
            rsv.append(prev)
        else:
            prev = (cc - ll) / (hh - ll) * 100.0
            rsv.append(prev)
    ks = _sma_tdx(rsv, 3, 1)
    ds = _sma_tdx(ks, 3, 1)
    js = [3.0 * a - 2.0 * b2 for a, b2 in zip(ks, ds)]

    def bline(n):
        hhv = _rolling(closes, n, max)
        llv = _rolling(lows, n, min)
        return [_div(cc - ll, hh - ll) * 100.0 for hh, ll, cc in zip(hhv, llv, closes)]

    bupiao = {
        "short": bline(3),
        "mid": bline(10),
        "midlong": bline(20),
        "long": bline(21),
    }

    return {
        "dates": dates,
        "ohlc": [[opens[i], closes[i], lows[i], highs[i]] for i in range(len(closes))],
        "volumes": vols,
        "white": white,
        "yellow": yellow,
        "brick": brick,
        "k": ks,
        "d": ds,
        "j": js,
        "bupiao": bupiao,
        "selected": len(closes) - 1,
        "price": c,
        "pct": quote.get("pct", 0),
        "name": quote.get("name", ""),
        "last_bar": _fmt_date(hist[-1][0]) if hist else "",
    }
