# -*- coding: utf-8 -*-
"""ETF 选股：周 K + 少妇战法条件；按名称/跟踪指数分纯血、混血、股指。

说明：ETF 持仓与行业归属没有公开稳定的本地数据，这里按基金名称/跟踪指数
做归类，命中 1 个板块为纯血、2 个为混血，宽基/境外指数为股指。
"""
import os
import time
from datetime import datetime

from core import config, indicators, quotes
from core.tdx_local import TdxStore

ETF_PREFIX = {"sh": ("51", "56", "58"), "sz": ("159",)}

# 名称过于宽泛的，按典型持仓拆成两个板块 → 混血
SECTOR_EXPAND = {
    "科技": ["电子", "计算机"],
    "金融": ["银行", "证券"],
    "消费": ["食品饮料", "家电"],
}

# 先匹配细分行业，再匹配宽泛主题
SECTOR_RULES = [
    ("半导体", ("半导体", "芯片", "集成电路", "存储")),
    ("电子", ("电子",)),
    ("医药", ("医药", "生物", "创新药", "医疗", "疫苗", "CXO", "中药")),
    ("军工", ("军工", "国防", "航天", "航空")),
    ("证券", ("证券", "券商")),
    ("银行", ("银行",)),
    ("保险", ("保险",)),
    ("白酒", ("白酒",)),
    ("食品饮料", ("食品", "饮料")),
    ("家电", ("家电",)),
    ("地产", ("地产", "房地产")),
    ("基建", ("基建", "建筑", "建材")),
    ("煤炭", ("煤炭",)),
    ("钢铁", ("钢铁",)),
    ("有色", ("有色", "稀土", "铜", "铝", "锂")),
    ("化工", ("化工",)),
    ("新能源", ("新能源", "光伏", "储能", "风电", "氢能", "电池", "锂电")),
    ("汽车", ("汽车", "智能车", "整车")),
    ("机器人", ("机器人", "机械")),
    ("人工智能", ("人工智能", "AI", "算力")),
    ("通信", ("通信", "5G", "光模块")),
    ("计算机", ("计算机", "软件", "云计算", "大数据", "信创", "网络安全")),
    ("传媒", ("传媒", "游戏", "影视", "动漫")),
    ("农业", ("农业", "养殖", "畜牧", "种业")),
    ("旅游", ("旅游", "酒店", "景区")),
    ("电力", ("电力", "公用事业")),
    ("环保", ("环保",)),
    ("消费", ("消费",)),
    ("金融", ("金融",)),
    ("科技", ("科技",)),
    ("红利", ("红利", "高股息")),
    ("国企", ("国企", "央企", "国资")),
]

INDEX_RULES = [
    ("沪深300", ("沪深300",)),
    ("中证500", ("中证500",)),
    ("中证1000", ("中证1000",)),
    ("中证2000", ("中证2000",)),
    ("上证50", ("上证50",)),
    ("上证180", ("上证180",)),
    ("上证380", ("上证380",)),
    ("上证指数", ("上证指数", "上证综指")),
    ("深证100", ("深证100",)),
    ("创业板", ("创业板",)),
    ("科创50", ("科创50",)),
    ("科创100", ("科创100",)),
    ("科创200", ("科创200",)),
    ("科创综指", ("科创综指",)),
    ("中证A500", ("A500", "中证A500")),
    ("中证A50", ("A50", "中证A50")),
    ("中证100", ("中证100",)),
    ("中证800", ("中证800",)),
    ("中证全指", ("中证全指", "全指")),
    ("国证2000", ("国证2000",)),
    ("恒生指数", ("恒生",)),
    ("港股", ("港股", "H股")),
    ("纳斯达克", ("纳斯达克", "纳指")),
    ("标普500", ("标普",)),
    ("日经225", ("日经",)),
    ("中概互联", ("中概",)),
]

EXCLUDE_RULES = [
    ("债券", ("债", "国债", "城投", "信用", "短融", "可转")),
    ("货币", ("货币", "现金", "理财")),
    ("商品", ("原油", "豆粕", "商品")),
]


def classify(name):
    """返回 (kind, sectors, label)。kind: index/pure/mixed/other/excluded。"""
    name = (name or "").replace(" ", "")
    for tag, kws in EXCLUDE_RULES:
        if any(k in name for k in kws):
            # 黄金股 ETF 持有的是股票，不算商品
            if tag == "商品" and "黄金" in name and "黄金股" not in name:
                continue
            return "excluded", [], tag
    if "黄金" in name and "黄金股" not in name:
        return "excluded", [], "商品"

    # 名称里带“消费/科技”但实际是单一行业的特例
    if "消费电子" in name:
        return "pure", ["电子"], "纯血 · 电子"
    if "生物科技" in name:
        return "pure", ["医药"], "纯血 · 医药"

    tags = []
    for tag, kws in SECTOR_RULES:
        if any(k in name for k in kws):
            if tag not in tags:
                tags.append(tag)
        if len(tags) >= 2:
            break

    expanded = []
    for t in tags:
        for x in SECTOR_EXPAND.get(t, [t]):
            if x not in expanded:
                expanded.append(x)
    tags = expanded

    if len(tags) >= 1:
        if len(tags) == 1:
            return "pure", tags, "纯血 · " + tags[0]
        return "mixed", tags[:2], "混血 · " + " + ".join(tags[:2])

    for idx_name, kws in INDEX_RULES:
        if any(k in name for k in kws):
            return "index", [idx_name], "股指 · " + idx_name

    return "other", [], "未归类"


def list_etfs():
    root = (config.get() or {}).get("tdx_root") or ""
    if not root:
        return []
    store = TdxStore(root)
    if not store.available():
        return []
    out = []
    for market, prefixes in ETF_PREFIX.items():
        d = os.path.join(store.vipdoc, market, "lday")
        if not os.path.isdir(d):
            continue
        for entry in os.scandir(d):
            if not entry.name.endswith(".day") or len(entry.name) != 12:
                continue
            code = entry.name[2:8]
            if code.startswith(prefixes):
                out.append((market, code))
    out.sort()
    return out


def scale_bars(bars):
    """通达信 ETF 价格以 0.001 元存储，换算成 0.01 元口径。"""
    return [(d, o / 10.0, h / 10.0, l / 10.0, c / 10.0, amount, volume)
            for d, o, h, l, c, amount, volume in bars]


def _recent_gap(bars, threshold=3.0):
    """近 10 个交易日是否出现 ≥3% 的跳空。"""
    for i in range(max(1, len(bars) - 10), len(bars)):
        pc = bars[i - 1][4]
        o = bars[i][1]
        if pc and abs(o / pc - 1.0) * 100.0 >= threshold:
            return True
    return False


def to_weekly(bars):
    """日线聚合为周线，保留最后交易日作为日期。"""
    out = []
    cur = None
    key = None
    for b in bars:
        d, o, h, l, c, amount, volume = b
        try:
            y, w, _ = datetime.strptime(str(d), "%Y%m%d").isocalendar()
        except ValueError:
            continue
        k = (y, w)
        if k != key:
            if cur:
                out.append(tuple(cur))
            cur = [d, o, h, l, c, amount, volume]
            key = k
        else:
            cur[0] = d
            cur[2] = max(cur[2], h)
            cur[3] = min(cur[3], l)
            cur[4] = c
            cur[5] += amount
            cur[6] += volume
    if cur:
        out.append(tuple(cur))
    return out


_CACHE = {"at": 0.0, "items": [], "totals": {}, "market_date": 0,
          "elapsed": 0.0, "generated_at": ""}
CACHE_TTL = 300.0


def _scan_all(min_weeks=120, pct_abs_max=2.45):
    root = (config.get() or {}).get("tdx_root") or ""
    store = TdxStore(root) if root else None
    if not store or not store.available():
        return {"ok": False, "error": "需要通达信本地数据才能筛选 ETF"}

    pairs = list_etfs()
    if not pairs:
        return {"ok": False, "error": "没有找到 ETF 日线文件"}

    quote_map = quotes.fetch_few(pairs)
    items = []
    totals = {"pure": 0, "mixed": 0, "index": 0}
    market_date = 0

    for market, code in pairs:
        q = quote_map.get(code)
        if not q:
            continue
        name = q.get("name", "")
        kind, sectors, label = classify(name)
        if kind in ("excluded", "other"):
            continue
        totals[kind] += 1
        bars = scale_bars(store.bars(market, code, limit=900))
        if _recent_gap(bars):
            continue
        weekly = to_weekly(bars)
        if len(weekly) < min_weeks:
            continue
        market_date = max(market_date, weekly[-1][0])
        f = indicators.build_features(weekly, q, weekly[-1][0], pct_1445=None, use_close=True)
        if not f:
            continue
        weekly_pct = (weekly[-1][4] / weekly[-2][4] - 1.0) * 100.0 if weekly[-2][4] else 0.0
        if not f["white_above_yellow"]:
            continue
        if not (-20.0 < f["kdj_j"] <= 35.0):
            continue
        if abs(weekly_pct) >= pct_abs_max:
            continue
        tags = list(sectors) + ["J=%.2f" % f["kdj_j"]]
        score = 30.0 - f["kdj_j"] * 0.5 + (pct_abs_max - abs(weekly_pct)) * 3.0
        items.append({
            "market": market,
            "code": code,
            "name": name,
            "price": q.get("price", 0),
            "pct": q.get("pct", 0),
            "weekly_pct": round(weekly_pct, 2),
            "j": round(f["kdj_j"], 2),
            "amount": q.get("amount", 0),
            "kind": kind,
            "kind_label": {"pure": "纯血", "mixed": "混血", "index": "股指"}[kind],
            "sectors": sectors,
            "sector_label": label,
            "tags": tags,
            "score": round(score, 2),
        })

    items.sort(key=lambda x: x["score"], reverse=True)
    for i, it in enumerate(items, 1):
        it["rank"] = i
    _CACHE.update({
        "at": time.time(),
        "items": items,
        "totals": totals,
        "market_date": market_date,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    })
    return None


def scan(category="all", min_weeks=120, pct_abs_max=2.45, force=False):
    if force or time.time() - _CACHE["at"] > CACHE_TTL or not _CACHE["items"]:
        started = time.time()
        err = _scan_all(min_weeks=min_weeks, pct_abs_max=pct_abs_max)
        if err:
            return err
        _CACHE["elapsed"] = round(time.time() - started, 2)

    items = _CACHE["items"]
    if category != "all":
        items = [x for x in items if x["kind"] == category]
    items = [dict(x, rank=i) for i, x in enumerate(items, 1)]
    totals = _CACHE["totals"]
    total = sum(totals.values()) if category == "all" else totals.get(category, 0)
    return {
        "ok": True,
        "category": category,
        "items": items,
        "matched": len(items),
        "total": total,
        "market_date": _CACHE["market_date"],
        "elapsed": _CACHE["elapsed"],
        "generated_at": _CACHE["generated_at"],
    }

