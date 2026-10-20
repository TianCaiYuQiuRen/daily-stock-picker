# -*- coding: utf-8 -*-
import json
import os
import sys
import time

sys.path.insert(0, r"E:\DS工作区\每日选股")
from core import config  # noqa: E402

# 模拟“没有安装通达信”的电脑
config._CFG = json.loads(json.dumps(config.DEFAULTS))
config._CFG["tdx_root"] = r"Z:\no_such_dir"
config._CFG["filters"]["boards"] = ["bj"]
config.RESULT_PATH = os.path.join(config.DATA_DIR, "_test_result.json")

from core import engine  # noqa: E402

t0 = time.time()
result, err = engine.safe_scan(boards=["bj"], strategy_key="zhuanxing")
print("elapsed %.1fs" % (time.time() - t0))
if err:
    print("ERROR:", err[:800])
else:
    print("mode", result["data_mode"], "universe", result["universe"],
          "quoted", result["quoted"], "matched", result["matched"])
    for it in result["items"][:3]:
        print(it["code"], it["name"].encode("unicode_escape"), it["price"], it["pct"], it["tags"])

p = config.RESULT_PATH
if os.path.exists(p):
    os.remove(p)
