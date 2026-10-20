# -*- coding: utf-8 -*-
"""选股引擎：行情 -> 本地日线 -> 指标 -> 战法 -> 结果。"""
import time
import traceback

from core import config, indicators, online, quotes, snapshot, strategies, tdx_local


class ScanError(Exception):
    pass


def _is_st(name):
    up = (name or "").upper().replace(" ", "")
    return "ST" in up or "退" in up


def run_scan(progress=None, boards=None, strategy_key=None):
    """执行一次全市场选股，返回结果 dict。progress(phase, pct) 可选。"""
    t0 = time.time()

    def report(phase, pct):
        if progress:
            try:
                progress(phase, pct)
            except Exception:
                pass

    cfg = config.get()
    strategy_key = strategy_key or cfg.get("strategy_key")
    overrides = (cfg.get("strategy_params") or {}).get(strategy_key) or {}
    strategy = strategies.get_strategy(strategy_key, overrides)
    store = tdx_local.TdxStore(cfg["tdx_root"])
    if cfg.get("data_source") == "online":
        mode = "online"
    else:
        mode = "tdx" if store.available() else "online"

    filters = cfg.get("filters", {})
    picked_boards = boards if boards is not None else (filters.get("boards") or list(config.BOARDS))
    picked_boards = [b for b in picked_boards if b in config.BOARDS]
    if not picked_boards:
        raise ScanError("请至少选择一个板块（主板 / 创业板 / 科创板 / 北交所）")

    if mode == "tdx":
        universe = [(m, c) for m, c in store.universe()
                    if tdx_local.board_of(m, c) in picked_boards]
        if not universe:
            raise ScanError("所选板块在本地没有日线数据，请先打开通达信下载盘后数据。")
        market_date = store.last_trade_date()
    else:
        report("正在获取全市场股票列表…", 0.02)
        all_univ = online.fetch_universe(
            progress=lambda p: report("正在获取全市场股票列表…", 0.02 + 0.05 * p))
        universe = [(m, c) for m, c in all_univ
                    if tdx_local.board_of(m, c) in picked_boards]
        if not universe:
            raise ScanError("无法从网络获取股票列表，请检查网络后重试。")
        market_date = 0
        report("首次运行需下载日线，请稍候…", 0.08)
        online.prefetch(universe, progress=lambda p: report(
            "正在下载日线 %d%%" % int(p * 100), 0.08 + 0.58 * p))

    report("正在获取实时行情…", 0.68)
    quote_map = quotes.fetch_quotes(
        universe, progress=lambda p: report("正在获取实时行情…", max(0.68, 0.68 + 0.16 * p)))

    # 判断是否收盘后：数据日期早于今天，或行情时间已过 15:00
    today_int = int(time.strftime("%Y%m%d"))
    quote_time = ""
    for q in quote_map.values():
        t = str(q.get("time") or "")
        if t > quote_time:
            quote_time = t

    if mode == "online":
        if len(quote_time) >= 8 and quote_time[:8].isdigit():
            market_date = int(quote_time[:8])
        else:
            market_date = today_int

    snap = snapshot.load(market_date)
    pct_map = (snap or {}).get("pct") or {}

    closed = False
    if len(quote_time) >= 14:
        qdate = int(quote_time[:8])
        qhms = quote_time[8:14]
        closed = (qdate < today_int) or (qhms >= "150000")

    report("正在计算指标…", 0.85)

    min_price = float(filters.get("min_price") or 0)
    max_price = float(filters.get("max_price") or 1e9)
    new_items = []
    total = len(universe)

    for idx, (market, code) in enumerate(universe):
        q = quote_map.get(code)
        if not q:
            continue

        name = q.get("name", "")
        if filters.get("exclude_st", True) and _is_st(name):
            continue
        price = q.get("price") or 0
        if price < min_price or price > max_price:
            continue
        if (q.get("volume") or 0) <= 0:
            continue

        bars = store.bars(market, code, limit=220) if mode == "tdx" else online.get_bars(market, code)
        f = indicators.build_features(bars, q, market_date, pct_1445=pct_map.get(code),
                                      use_close=closed)
        if not f:
            continue
        ok, score, tags = strategy.match(f)
        if not ok:
            continue
        f["score"] = score
        f["tags"] = tags
        new_items.append(f)

        if idx % 500 == 0:
            report("正在计算指标…", 0.78 + 0.2 * idx / max(1, total))

    top_n = int(cfg.get("top_n") or 0)
    new_items.sort(key=lambda x: x["score"], reverse=True)
    if top_n > 0:
        new_items = new_items[:top_n]

    items = new_items
    for i, it in enumerate(items, 1):
        it["rank"] = i
        it["hold_days"] = 0
        it["retained"] = False

    elapsed = round(time.time() - t0, 2)
    strat_meta = strategy.meta()
    strat_meta["block_name"] = strategy.block_name(cfg.get("block_prefix") or "智选")
    result = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed": elapsed,
        "market_date": market_date,
        "quote_time": quote_time,
        "universe": total,
        "quoted": len(quote_map),
        "matched": len(items),
        "boards": picked_boards,
        "strategy": strat_meta,
        "data_mode": mode,
        "price_mode": "close" if closed else "realtime",
        "pct1445": {
            "available": bool(snap),
            "date": (snap or {}).get("date"),
            "time": (snap or {}).get("time"),
        },
        "items": items,
        "tdx_root": cfg["tdx_root"],
    }
    config.save_last_result(result)
    report("完成", 1.0)
    return result


def refresh_quotes(items):
    """刷新结果列表中的最新价/涨幅/量比等。"""
    pairs = [(it["market"], it["code"]) for it in items]
    fresh = quotes.fetch_few(pairs)
    out = []
    for it in items:
        q = fresh.get(it["code"])
        if not q:
            continue
        out.append({
            "code": it["code"],
            "price": q["price"],
            "pct": q["pct"],
            "vol_ratio": q["vol_ratio"],
            "turnover": q["turnover"],
            "amount": q["amount"],
            "time": q.get("time", ""),
        })
    return out


def capture_1445(progress=None):
    """抓取全市场 14:45 涨跌幅快照（少妇战法用）。"""
    cfg = config.get()
    store = tdx_local.TdxStore(cfg["tdx_root"])
    use_tdx = store.available() and cfg.get("data_source") != "online"
    if use_tdx:
        universe = store.universe()
    else:
        universe = online.fetch_universe()
    if not universe:
        raise ScanError("无法获取股票列表")
    quote_map = quotes.fetch_quotes(universe)
    if not quote_map:
        raise ScanError("未获取到行情")
    date = 0
    for q in quote_map.values():
        t = str(q.get("time") or "")
        if len(t) >= 8 and t[:8].isdigit():
            date = max(date, int(t[:8]))
    if not date:
        date = store.last_trade_date()
    if date != int(time.strftime("%Y%m%d")):
        raise ScanError("今天不是交易日或行情尚未更新，无法抓取 14:45 快照")
    pct_map = {code: q.get("pct", 0.0) for code, q in quote_map.items()}
    snapshot.save(date, pct_map)
    return {"date": date, "count": len(pct_map)}


def safe_scan(progress=None, boards=None, strategy_key=None):
    """给后台线程用的包装：异常不抛出，返回 (result, error)。"""
    try:
        return run_scan(progress, boards, strategy_key), None
    except ScanError as exc:
        return None, str(exc)
    except Exception:  # noqa: BLE001
        return None, "选股失败：\n" + traceback.format_exc(limit=3)
