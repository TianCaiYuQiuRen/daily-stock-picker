# -*- coding: utf-8 -*-
import sys

sys.path.insert(0, r"E:\DS工作区\每日选股")
from core import chart_series, quotes, tdx_local  # noqa: E402

store = tdx_local.TdxStore(r"F:\TDX")
market, code = "sz", "300308"
bars = store.bars(market, code, limit=320)
q = quotes.fetch_few([(market, code)])[code]
s = chart_series.build_series(bars, q, use_close=False, limit=240)
ohlc = s["ohlc"]
vols = s["volumes"]
closes = [x[1] for x in ohlc]
n = len(ohlc)

for i in range(25, n):
    pc = closes[i - 1]
    pct = (closes[i] / pc - 1) * 100 if pc else 0
    if pct > -4:
        continue
    avg5 = sum(vols[i - 5:i]) / 5
    max20 = max(vols[i - 20:i])
    high20 = max(ohlc[j][3] for j in range(i - 20, i))
    base = ohlc[max(0, i - 21)][1]
    run_up = (high20 / base - 1) * 100 if base else 0
    accel = run_up >= 18 or (closes[i-1] / closes[i-21] - 1) * 100 >= 15 if i >= 21 else False
    print(s["dates"][i], "pct %.1f" % pct, "run_up %.0f" % run_up, "accel", accel,
          "v/avg5 %.1f" % (vols[i] / avg5 if avg5 else 0),
          "v/max20 %.2f" % (vols[i] / max20 if max20 else 0),
          "high20 %.1f h %.1f" % (high20, ohlc[i][3]))
