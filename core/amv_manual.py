# -*- coding: utf-8 -*-
"""手工录入的指南针官方 0AMV 数据。

存 data/amv_manual.json；有录入时优先使用官方值，没有时回退到成交额代理。
"""
import json
import os
import threading
from datetime import datetime, timedelta

from core import config

PATH = os.path.join(config.DATA_DIR, "amv_manual.json")
_LOCK = threading.RLock()


def _load():
    try:
        with open(PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data):
    config.ensure_dirs()
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, PATH)


def _norm_date(value):
    s = str(value or "").strip().replace("/", "-").replace(".", "-")
    if len(s) == 8 and s.isdigit():
        s = s[:4] + "-" + s[4:6] + "-" + s[6:8]
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        raise ValueError("日期格式应为 YYYY-MM-DD")
    return s


def save_entry(payload):
    date = _norm_date(payload.get("date"))
    try:
        close = float(payload.get("close"))
    except (TypeError, ValueError):
        raise ValueError("0AMV 收盘价无效")
    if close <= 0:
        raise ValueError("0AMV 收盘价必须大于 0")

    def opt(name):
        v = payload.get(name)
        if v in (None, ""):
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            raise ValueError("%s 数值无效" % name)

    chg = opt("chg")
    if chg is not None and not (-30 <= chg <= 30):
        raise ValueError("涨跌幅应在 -30% ~ 30% 之间")
    open_ = opt("open")
    high = opt("high")
    low = opt("low")
    if open_ is not None and open_ <= 0:
        raise ValueError("开盘价必须大于 0")
    if high is not None and low is not None and high < low:
        raise ValueError("最高价不能小于最低价")

    with _LOCK:
        data = _load()
        data[date] = {
            "date": date,
            "close": round(close, 2),
            "chg": round(chg, 2) if chg is not None else None,
            "open": round(open_, 2) if open_ is not None else None,
            "high": round(high, 2) if high is not None else None,
            "low": round(low, 2) if low is not None else None,
        }
        _save(data)
    return data


def delete_entry(date):
    date = _norm_date(date)
    with _LOCK:
        data = _load()
        data.pop(date, None)
        _save(data)
    return data


def build(days=160):
    with _LOCK:
        data = _load()
    if not data:
        return None

    rows = [data[k] for k in sorted(data)]
    series = []
    prev_close = None
    for row in rows:
        close = float(row["close"])
        if row.get("chg") is not None:
            chg = float(row["chg"])
        else:
            chg = ((close / prev_close - 1.0) * 100.0) if prev_close else 0.0
        open_ = row.get("open")
        if open_ is None:
            open_ = prev_close if prev_close else close
        high = row.get("high")
        low = row.get("low")
        if high is None:
            high = max(open_, close)
        if low is None:
            low = min(open_, close)
        series.append({
            "date": row["date"],
            "value": round(close, 2),
            "open": round(open_, 2),
            "high": round(high, 2),
            "low": round(low, 2),
            "chg": round(chg, 2),
        })
        prev_close = close

    ema = None
    for item in series:
        ema = item["value"] if ema is None else ema * 11.0 / 12.0 + item["value"] / 12.0
        item["ema"] = round(ema, 2)

    last = series[-1]
    stale = 0
    try:
        cur = datetime.strptime(last["date"], "%Y-%m-%d").date()
        today = datetime.now().date()
        while cur < today:
            cur += timedelta(days=1)
            if cur.weekday() < 5:
                stale += 1
    except ValueError:
        pass

    entries = [{"date": x["date"], "close": x["value"], "chg": x["chg"]} for x in series[-30:]]
    return {
        "ok": True,
        "source": "manual",
        "formula": "指南针官方值（手工录入）",
        "last_date": last["date"],
        "value": last["value"],
        "chg": last["chg"],
        "up": last["chg"] >= 0,
        "stale_days": stale,
        "series": series[-days:],
        "count": len(series),
        "entries": entries,
    }
