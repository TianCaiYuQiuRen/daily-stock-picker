# -*- coding: utf-8 -*-
"""14:45 全市场涨跌幅快照（少妇战法需要）。"""
import json
import os
import time

from core import config

PATH = os.path.join(config.DATA_DIR, "snapshot_1445.json")


def save(date, pct_map):
    config.ensure_dirs()
    data = {
        "date": int(date),
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(pct_map),
        "pct": pct_map,
    }
    tmp = PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, PATH)
    return data


def load(date=None):
    try:
        with open(PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if date is not None and int(data.get("date") or 0) != int(date):
        return None
    return data


def info():
    data = load()
    if not data:
        return {"available": False}
    return {"available": True, "date": data.get("date"), "time": data.get("time"),
            "count": data.get("count", 0)}
