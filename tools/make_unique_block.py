# -*- coding: utf-8 -*-
"""按 unique_map.json 新建/更新「中国唯一性」板块。"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import config, tdx_block  # noqa: E402

ROOT = config.get()["tdx_root"]
data = json.load(open(r"E:\DS工作区\每日选股\data\unique_map.json", encoding="utf-8"))
pairs = [(x["market"], x["code"]) for x in data["resolved"]]
print("pairs", len(pairs), "root", ROOT)

was_running = tdx_block.is_tdx_running()
if was_running:
    print("通达信运行中，先关闭…")
    if not tdx_block.close_tdx():
        raise SystemExit("无法关闭通达信，请手动关闭后重试")

res = tdx_block.write_block(ROOT, "中国唯一性", pairs)
print(json.dumps(res, ensure_ascii=False, indent=2))

if was_running:
    tdx_block.start_tdx(ROOT)
    print("通达信已重新启动")
