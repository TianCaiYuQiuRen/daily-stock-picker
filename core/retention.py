# -*- coding: utf-8 -*-
"""少妇战法留存观察：不再命中后保留 N 个交易日，到期自动清除。"""
import json
import os
from datetime import date, datetime, timedelta

from core import config

RETAIN_DAYS = 10
STRATEGY_KEY = "shaofu"
FIELDS = (
    "code", "market", "name", "price", "pct", "vol_ratio", "turnover",
    "amount", "float_cap", "score", "tags", "white", "yellow", "brick",
    "pct_1445", "last_bar",
)


def _path(path=None):
    return path or os.path.join(config.DATA_DIR, "retention.json")


def _load(path=None):
    try:
        with open(_path(path), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data, path=None):
    target = _path(path)
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, target)
    except OSError:
        pass


def _to_date(value):
    try:
        v = int(value)
        return datetime.strptime(str(v), "%Y%m%d").date() if v else None
    except (TypeError, ValueError):
        return None


def _sessions(start_date, end_date, store=None):
    """start 之后到 end 之间经过的交易日数量。"""
    start, end = _to_date(start_date), _to_date(end_date)
    if not start or not end or end <= start:
        return 0
    dates = []
    try:
        if store is not None and store.available():
            dates = [b[0] for b in (store.bars("sh", "000001", limit=800) or [])]
    except (OSError, TypeError, ValueError):
        dates = []
    if dates:
        start_int, end_int = int(start_date), int(end_date)
        count = sum(1 for d in dates if start_int < int(d) <= end_int)
        last = max(int(d) for d in dates)
        if end_int > last:
            cur = datetime.strptime(str(last), "%Y%m%d").date()
            while cur < end:
                cur += timedelta(days=1)
                if cur.weekday() < 5:
                    count += 1
        return count
    # 没有本地交易日历时按工作日近似，避免在线模式完全失效
    n, cur = 0, start
    while cur < end:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            n += 1
    return n


def _payload(item):
    return {k: item.get(k) for k in FIELDS if k in item}


def _refresh_quote(payload, quote):
    if not quote:
        return
    try:
        price = float(quote.get("price") or 0)
        pre = float(quote.get("pre_close") or 0)
        if price > 0:
            payload["price"] = price
            if pre > 0:
                payload["pct"] = round((price / pre - 1) * 100, 3)
        for key in ("vol_ratio", "turnover", "amount", "float_cap"):
            if quote.get(key) is not None:
                payload[key] = quote.get(key)
    except (TypeError, ValueError):
        pass


def merge(strategy_key, items, market_date, quote_map=None, store=None, path=None):
    """合并今日命中项和留存观察项，返回 (全部展示项, 留存数量)。"""
    if strategy_key != STRATEGY_KEY:
        return items, 0

    quote_map = quote_map or {}
    today = int(market_date or 0) or int(datetime.now().strftime("%Y%m%d"))
    data = _load(path)
    strategies = data.setdefault("strategies", {})
    bucket = strategies.setdefault(STRATEGY_KEY, {})
    current = {it.get("code"): it for it in items if it.get("code")}

    retained = []
    for code, rec in list(bucket.items()):
        if not isinstance(rec, dict) or code in current:
            continue
        start = rec.get("first_date") or rec.get("last_date")
        hold = _sessions(start, today, store)
        if hold > RETAIN_DAYS:
            bucket.pop(code, None)
            continue
        payload = dict(rec.get("payload") or {})
        if not payload:
            bucket.pop(code, None)
            continue
        _refresh_quote(payload, quote_map.get(code))
        payload["retained"] = True
        payload["hold_days"] = hold
        payload["first_date"] = start
        old_tags = [t for t in (payload.get("tags") or []) if not str(t).startswith("留存观察")]
        payload["tags"] = ["留存观察 " + ("当日" if hold == 0 else "%d/%d日" % (hold, RETAIN_DAYS))] + old_tags
        retained.append(payload)

    # 今天命中的股票重新开始计算观察期；同时刷新留存内容
    for code, it in current.items():
        bucket[code] = {
            "first_date": today,
            "last_date": today,
            "payload": _payload(it),
        }

    _save(data, path)
    return list(items) + retained, len(retained)
