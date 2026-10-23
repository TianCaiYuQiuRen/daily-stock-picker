# -*- coding: utf-8 -*-
"""在线数据模式：没有安装通达信时，用网络行情 + 在线日线工作。"""
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from core import config
from core.tdx_local import is_a_share

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
UNIV_PATH = os.path.join(config.DATA_DIR, "online_universe.json")
KLINE_DIR = os.path.join(config.DATA_DIR, "kline")


def _today():
    return time.strftime("%Y%m%d")


def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Referer": "https://gu.qq.com/"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_universe(force=False, progress=None):
    """用新浪全市场列表拿到 [(market, code)]，按天缓存。"""
    if not force:
        try:
            with open(UNIV_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("date") == _today() and data.get("items"):
                return [(m, c) for m, c in data["items"]]
        except (OSError, ValueError):
            pass

    items = []
    page = 1
    while page <= 80:
        url = ("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
               "Market_Center.getHQNodeData?page=%d&num=100&sort=symbol&asc=1"
               "&node=hs_a&symbol=&_s_r_a=page" % page)
        try:
            arr = json.loads(_get(url).decode("gbk"))
        except Exception:
            break
        if not arr:
            break
        for row in arr:
            sym = str(row.get("symbol") or "")
            code = str(row.get("code") or (sym[-6:] if len(sym) >= 6 else ""))
            market = sym[:2] if sym[:2] in ("sh", "sz", "bj") else ""
            if market and is_a_share(market, code):
                items.append((market, code))
        if progress:
            try:
                progress(min(0.95, page / 60.0))
            except Exception:
                pass
        if len(arr) < 100:
            break
        page += 1

    if items:
        config.ensure_dirs()
        with open(UNIV_PATH, "w", encoding="utf-8") as f:
            json.dump({"date": _today(), "items": items}, f)
    return items


def _path(market, code):
    return os.path.join(KLINE_DIR, "%s%s.json" % (market, code))


def get_bars(market, code):
    try:
        with open(_path(market, code), "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("date") == _today():
            return [tuple(b) for b in data.get("bars") or []]
    except (OSError, ValueError):
        pass
    return []


def fetch_bars(market, code):
    sym = market + code
    url = ("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
           "?param=%s,day,,,220,qfq" % sym)
    rows = []
    for attempt in range(2):
        try:
            j = json.loads(_get(url).decode("utf-8"))
            d = (j.get("data") or {}).get(sym) or {}
            rows = d.get("qfqday") or d.get("day") or []
            if rows:
                break
        except Exception:
            time.sleep(0.3)
    if not rows:
        return False
    bars = []
    for row in rows:
        try:
            date = int(str(row[0]).replace("-", ""))
            o, c, h, l = float(row[1]), float(row[2]), float(row[3]), float(row[4])
            vol = float(row[5]) * 100.0  # 手 -> 股
            bars.append((date, o, h, l, c, 0.0, vol))
        except (ValueError, IndexError):
            continue
    if not bars:
        return False
    os.makedirs(KLINE_DIR, exist_ok=True)
    try:
        with open(_path(market, code), "w", encoding="utf-8") as f:
            json.dump({"date": _today(), "bars": bars}, f)
    except OSError:
        return False
    return True


def prefetch(pairs, progress=None):
    """并发补齐当日缺失的日线，返回成功数量。"""
    todo = [(m, c) for m, c in pairs if not get_bars(m, c)]
    total = len(todo)
    if not total:
        return 0
    done = 0
    ok = 0
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(fetch_bars, m, c) for m, c in todo]
        for fut in as_completed(futs):
            done += 1
            try:
                if fut.result():
                    ok += 1
            except Exception:
                pass
            if progress and (done % 20 == 0 or done == total):
                try:
                    progress(done / float(total))
                except Exception:
                    pass
    return ok

