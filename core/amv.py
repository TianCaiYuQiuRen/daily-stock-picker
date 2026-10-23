# -*- coding: utf-8 -*-
"""0AMV 活跃市值（活筹指数）代理指标。

指南针未公开原版算法；这里按公开流传的民间公式：
    VAR1 = SMA(沪深全市场成交额, 10, 1) / 1e7
成交额取通达信本地「上证指数 + 深证综指」日线的 amount 字段。
"""
from datetime import datetime

from core import config
from core.tdx_local import TdxStore

SMA_N = 10
SMA_M = 1
SCALE = 1e7


def _fmt_date(d):
    s = str(d)
    return "%s-%s-%s" % (s[:4], s[4:6], s[6:8])


def _load_tdx_amounts():
    root = (config.get() or {}).get("tdx_root") or ""
    if not root:
        return None
    store = TdxStore(root)
    if not store.available():
        return None
    sh = store.bars("sh", "000001", limit=500)
    sz = store.bars("sz", "399106", limit=500)
    if not sh or not sz:
        return None
    sh_amt = {b[0]: b[5] for b in sh}
    sz_amt = {b[0]: b[5] for b in sz}
    dates = sorted(set(sh_amt) & set(sz_amt))
    return [(d, sh_amt[d] + sz_amt[d]) for d in dates if sh_amt[d] and sz_amt[d]]


def compute(days=160):
    rows = _load_tdx_amounts()
    if not rows:
        return {"ok": False, "error": "未找到通达信指数日线（需要 sh000001 和 sz399106）"}

    series = []
    y = None
    for d, amount in rows:
        x = amount / SCALE
        if y is None:
            y = x
        else:
            y = (SMA_M * x + (SMA_N - SMA_M) * y) / SMA_N
        series.append({"date": _fmt_date(d), "value": round(y, 2)})

    for i, item in enumerate(series):
        prev = series[i - 1]["value"] if i else item["value"]
        item["open"] = prev
        item["high"] = max(prev, item["value"])
        item["low"] = min(prev, item["value"])
        item["chg"] = round((item["value"] / prev - 1.0) * 100.0, 2) if prev else 0.0

    # EMA12 平滑线（参考实现里的“平滑线”）
    ema = None
    for item in series:
        ema = item["value"] if ema is None else ema * 11.0 / 12.0 + item["value"] / 12.0
        item["ema"] = round(ema, 2)

    last = series[-1]
    stale_days = 0
    try:
        last_dt = datetime.strptime(last["date"], "%Y-%m-%d").date()
        stale_days = (datetime.now().date() - last_dt).days
    except ValueError:
        pass

    return {
        "ok": True,
        "source": "tdx",
        "formula": "SMA(沪深成交额,10,1)/1e7",
        "last_date": last["date"],
        "value": last["value"],
        "chg": last["chg"],
        "up": last["chg"] >= 0,
        "stale_days": stale_days,
        "series": series[-days:],
    }

