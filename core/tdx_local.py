# -*- coding: utf-8 -*-
"""读取通达信本地日线数据（vipdoc/*/lday/*.day）。"""
import os
import struct

RECORD = struct.Struct("<IIIIIfII")  # 日期, 开, 高, 低, 收(分), 成交额(元), 成交量(股), 保留

SH_PREFIX = ("600", "601", "603", "605", "688", "689")
SZ_PREFIX = ("000", "001", "002", "003", "300", "301")
BJ_PREFIX = ("430", "831", "832", "833", "834", "835", "836", "837", "838", "839",
             "870", "871", "872", "873", "874", "875", "876", "877", "878", "879",
             "920", "921")


def is_a_share(market, code):
    if len(code) != 6 or not code.isdigit():
        return False
    if market == "sh":
        return code.startswith(SH_PREFIX)
    if market == "sz":
        return code.startswith(SZ_PREFIX)
    if market == "bj":
        return code.startswith(BJ_PREFIX)
    return False


def board_of(market, code):
    """返回 main / gem / star / bj。"""
    if market == "bj":
        return "bj"
    if market == "sh":
        return "star" if code.startswith(("688", "689")) else "main"
    if market == "sz":
        return "gem" if code.startswith(("300", "301")) else "main"
    return None


class TdxStore:
    def __init__(self, root):
        self.root = root
        self.vipdoc = os.path.join(root, "vipdoc")
        self._universe = None

    def available(self):
        return os.path.isdir(self.vipdoc)

    def day_path(self, market, code):
        return os.path.join(self.vipdoc, market, "lday", "%s%s.day" % (market, code))

    def universe(self):
        """返回 [(market, code)]，只含 A 股。"""
        if self._universe is not None:
            return self._universe
        out = []
        for market in ("sh", "sz", "bj"):
            d = os.path.join(self.vipdoc, market, "lday")
            if not os.path.isdir(d):
                continue
            for entry in os.scandir(d):
                name = entry.name
                if not name.endswith(".day") or len(name) != 12:
                    continue
                code = name[2:8]
                if is_a_share(market, code):
                    out.append((market, code))
        out.sort(key=lambda x: (x[0], x[1]))
        self._universe = out
        return out

    def bars(self, market, code, limit=320):
        """返回最近 limit 根日线：[(date, open, high, low, close, amount, volume_shares)]"""
        path = self.day_path(market, code)
        try:
            with open(path, "rb") as f:
                f.seek(0, os.SEEK_END)
                size = f.tell()
                count = size // 32
                if count <= 0:
                    return []
                take = min(count, limit)
                f.seek((count - take) * 32)
                raw = f.read(take * 32)
        except OSError:
            return []
        out = []
        for rec in RECORD.iter_unpack(raw):
            if rec[0] < 19900101:
                continue
            out.append((rec[0], rec[1] / 100.0, rec[2] / 100.0, rec[3] / 100.0,
                        rec[4] / 100.0, rec[5], rec[6]))
        return out

    def last_trade_date(self):
        bars = self.bars("sh", "000001", limit=2)
        return bars[-1][0] if bars else 0
