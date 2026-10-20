# -*- coding: utf-8 -*-
import sys

sys.path.insert(0, r"E:\DS工作区\每日选股")
from core import indicators, online, quotes  # noqa: E402

codes = [("sh", "600519"), ("sz", "000001"), ("sz", "002262"), ("sz", "300750"), ("sh", "688050")]
for m, c in codes:
    ok = online.fetch_bars(m, c)
    bars = online.get_bars(m, c)
    q = quotes.fetch_few([(m, c)]).get(c)
    f = indicators.build_features(bars, q, 20261020, use_close=False)
    print(c, "fetch", ok, "bars", len(bars), "last", bars[-1][0] if bars else None,
          "J", round(f["kdj_j"], 1) if f else None,
          "white/yellow", (round(f["white"], 2), round(f["yellow"], 2)) if f else None)
