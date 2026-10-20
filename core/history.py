# -*- coding: utf-8 -*-
"""历史选股记录与后续表现统计。"""
import json
import os
import time

from core import config

HIST_DIR = os.path.join(config.DATA_DIR, "history")
MAX_RECORDS = 300


def save(result):
    if not result or not result.get("items") is not None:
        return ""
    os.makedirs(HIST_DIR, exist_ok=True)
    date = result.get("market_date") or 0
    qt = str(result.get("quote_time") or "")
    if len(qt) >= 8 and qt[:8].isdigit():
        date = int(qt[:8])
    key = (result.get("strategy") or {}).get("key") or "unknown"
    rec_id = "%s_%s" % (date, key)
    fields = ("code", "market", "name", "price", "pct", "tags", "rank", "score")
    items = [{k: it.get(k) for k in fields} for it in result.get("items") or []]
    data = {
        "id": rec_id,
        "date": date,
        "generated_at": result.get("generated_at"),
        "strategy": result.get("strategy"),
        "boards": result.get("boards"),
        "price_mode": result.get("price_mode"),
        "count": len(items),
        "items": items,
    }
    path = os.path.join(HIST_DIR, rec_id + ".json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)
    _prune()
    return rec_id


def _prune():
    try:
        files = [os.path.join(HIST_DIR, f) for f in os.listdir(HIST_DIR) if f.endswith(".json")]
        if len(files) <= MAX_RECORDS:
            return
        files.sort(key=lambda p: os.path.getmtime(p))
        for p in files[:len(files) - MAX_RECORDS]:
            try:
                os.remove(p)
            except OSError:
                pass
    except OSError:
        pass


def list_records():
    out = []
    if not os.path.isdir(HIST_DIR):
        return out
    for fn in os.listdir(HIST_DIR):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(HIST_DIR, fn), "r", encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        st = d.get("strategy") or {}
        out.append({
            "id": d.get("id"),
            "date": d.get("date"),
            "generated_at": d.get("generated_at"),
            "strategy": st.get("name"),
            "key": st.get("key"),
            "count": d.get("count"),
        })
    out.sort(key=lambda x: (x.get("date") or 0, x.get("generated_at") or ""), reverse=True)
    return out


def load(rec_id):
    path = os.path.join(HIST_DIR, "%s.json" % rec_id)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def with_returns(record, bars_getter):
    items = record.get("items") or []
    date = int(record.get("date") or 0)
    horizons = (1, 3, 5, 10)
    sums = {n: 0.0 for n in horizons}
    wins = {n: 0 for n in horizons}
    counts = {n: 0 for n in horizons}
    out = []
    for it in items:
        bars = bars_getter(it.get("market"), it.get("code")) or []
        idx = None
        for i, b in enumerate(bars):
            if b[0] == date:
                idx = i
                break
        entry = bars[idx][4] if idx is not None else it.get("price")
        row = {"code": it.get("code"), "name": it.get("name"),
               "price": it.get("price"), "tags": it.get("tags")}
        for n in horizons:
            val = None
            if idx is not None and entry and idx + n < len(bars):
                val = (bars[idx + n][4] / entry - 1.0) * 100.0
            row["r%d" % n] = val
            if val is not None:
                sums[n] += val
                counts[n] += 1
                if val > 0:
                    wins[n] += 1
        out.append(row)

    summary = {}
    for n in horizons:
        summary["r%d" % n] = {
            "avg": round(sums[n] / counts[n], 2) if counts[n] else None,
            "win": round(wins[n] * 100.0 / counts[n], 1) if counts[n] else None,
            "count": counts[n],
        }
    return {"record": {
        "id": record.get("id"), "date": record.get("date"),
        "generated_at": record.get("generated_at"),
        "strategy": record.get("strategy"), "count": record.get("count"),
    }, "items": out, "summary": summary}
