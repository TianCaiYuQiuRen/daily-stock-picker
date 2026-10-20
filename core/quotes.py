# -*- coding: utf-8 -*-
"""实时行情：腾讯批量接口为主，新浪为兜底。"""
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

CHUNK = 60
WORKERS = 6
_TIMEOUT = 8


def _http_get(url, headers, timeout=_TIMEOUT):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def market_of(code):
    if code.startswith(("60", "68", "90", "51", "58", "11", "13")):
        return "sh"
    if code.startswith(("43", "83", "87", "92", "88")):
        return "bj"
    return "sz"


def tx_code(market, code):
    return ("sh" if market == "sh" else "sz" if market == "sz" else "bj") + code


def _f(parts, idx, default=0.0):
    try:
        v = parts[idx]
        if v in ("", "-", None):
            return default
        return float(v)
    except (IndexError, ValueError):
        return default


def _parse_tencent_line(line):
    """解析 v_sh600519="1~名称~代码~..." 中的字段。"""
    if "~" not in line or "pv_none" in line:
        return None
    try:
        body = line.split("=", 1)[1].strip().strip(";").strip('"')
        p = body.split("~")
        if len(p) < 50:
            return None
        code = p[2].strip()
        price = _f(p, 3)
        if not code or price <= 0:
            return None
        market = market_of(code)
        amount = _f(p, 37) * 10000.0  # 成交额（万元 -> 元）
        volume = _f(p, 36)
        # 腾讯对科创板（688/689）返回的成交量单位是「股」，其余是「手」
        if code.startswith(("688", "689")):
            volume = volume / 100.0
        pct = _f(p, 32)
        return {
            "code": code,
            "market": market,
            "name": p[1].strip(),
            "price": price,
            "pre_close": _f(p, 4),
            "open": _f(p, 5),
            "high": _f(p, 33),
            "low": _f(p, 34),
            "volume": volume,             # 手
            "amount": amount,             # 元
            "pct": pct,
            "turnover": _f(p, 38),        # %
            "pe": _f(p, 39),
            "amplitude": _f(p, 43),
            "float_cap": _f(p, 44),       # 亿元
            "total_cap": _f(p, 45),       # 亿元
            "pb": _f(p, 46),
            "limit_up": _f(p, 47),
            "limit_down": _f(p, 48),
            "vol_ratio": _f(p, 49),
            "avg_price": _f(p, 51),
            "time": p[30].strip(),
        }
    except (IndexError, ValueError):
        return None


def _fetch_tencent_chunk(codes):
    url = "https://qt.gtimg.cn/q=" + ",".join(codes)
    raw = _http_get(url, {"User-Agent": UA, "Referer": "https://gu.qq.com/"})
    text = raw.decode("gbk", "replace")
    out = {}
    for line in text.split(";"):
        line = line.strip()
        if not line:
            continue
        q = _parse_tencent_line(line)
        if q:
            out[q["code"]] = q
    return out


def _parse_sina_line(line):
    """新浪兜底：只有基础价格字段。"""
    if "=" not in line:
        return None
    head, body = line.split("=", 1)
    raw_code = head.split("_")[-1].strip()
    code = raw_code[2:] if raw_code[:2] in ("sh", "sz", "bj") else raw_code
    body = body.strip().strip(";").strip('"')
    if not body or len(code) != 6:
        return None
    p = body.split(",")
    if len(p) < 32 or not p[0]:
        return None
    try:
        price = float(p[3] or 0)
        pre_close = float(p[2] or 0)
        if price <= 0:
            return None
        volume = float(p[8] or 0) / 100.0  # 股 -> 手
        return {
            "code": code,
            "market": market_of(code),
            "name": p[0].strip(),
            "price": price,
            "pre_close": pre_close,
            "open": float(p[1] or 0),
            "high": float(p[4] or 0),
            "low": float(p[5] or 0),
            "volume": volume,
            "amount": float(p[9] or 0),
            "pct": round((price / pre_close - 1) * 100, 2) if pre_close else 0.0,
            "turnover": 0.0,
            "pe": 0.0,
            "amplitude": 0.0,
            "float_cap": 0.0,
            "total_cap": 0.0,
            "pb": 0.0,
            "limit_up": 0.0,
            "limit_down": 0.0,
            "vol_ratio": 0.0,
            "avg_price": 0.0,
            "time": (p[30] + " " + p[31]) if len(p) > 31 else "",
        }
    except (ValueError, IndexError):
        return None


def _fetch_sina_chunk(codes):
    url = "https://hq.sinajs.cn/list=" + ",".join(codes)
    raw = _http_get(url, {"User-Agent": UA, "Referer": "https://finance.sina.com.cn/"})
    text = raw.decode("gbk", "replace")
    out = {}
    for line in text.split(";"):
        q = _parse_sina_line(line.strip())
        if q:
            out[q["code"]] = q
    return out


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch_quotes(markets, progress=None):
    """markets: [(market, code)] -> {code: quote}
    腾讯为主；整批失败时用新浪兜底补齐基础价格。
    """
    pairs = [(m, c) for m, c in markets if c]
    codes = [tx_code(m, c) for m, c in pairs]
    batches = list(_chunks(codes, CHUNK))
    result = {}
    done = [0]
    lock = threading.Lock()

    def run(batch):
        last_err = None
        for attempt in range(3):
            try:
                return _fetch_tencent_chunk(batch)
            except Exception as exc:  # noqa: BLE001 - 网络抖动重试
                last_err = exc
        failed = [c for c in batch]
        try:
            return _fetch_sina_chunk(failed)
        except Exception:
            if last_err:
                pass
            return {}

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(run, b): b for b in batches}
        for fut in as_completed(futures):
            try:
                part = fut.result()
            except Exception:
                part = {}
            with lock:
                result.update(part)
                done[0] += len(futures[fut])
                if progress:
                    progress(min(0.9, 0.15 + 0.75 * done[0] / max(1, len(codes))))
    return result


def fetch_few(markets):
    """少量代码刷新（列表页用），单线程即可。"""
    codes = [tx_code(m, c) for m, c in markets]
    out = {}
    for batch in _chunks(codes, CHUNK):
        try:
            out.update(_fetch_tencent_chunk(batch))
        except Exception:
            try:
                out.update(_fetch_sina_chunk(batch))
            except Exception:
                pass
    return out
