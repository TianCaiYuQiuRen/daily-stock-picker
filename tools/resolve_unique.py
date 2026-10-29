# -*- coding: utf-8 -*-
"""把公司名解析成 A 股代码（腾讯 smartbox）。"""
import json
import re
import time
import urllib.parse
import urllib.request

ROOT = r"E:\DS工作区\每日选股"
names = json.load(open(ROOT + r"\data\unique_names.json", encoding="utf-8"))
out, miss = [], []
for name in names:
    url = "https://smartbox.gtimg.cn/s3/?q=" + urllib.parse.quote(name) + "&t=all"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"})
        txt = urllib.request.urlopen(req, timeout=10).read().decode("gbk", "ignore")
        m = re.search(r'v_hint="([^"]*)"', txt)
        items = m.group(1).split("^") if m else []
        pick = None
        for item in items:
            p = item.split("~")
            if len(p) >= 3 and p[0] in ("sh", "sz", "bj") and re.fullmatch(r"\d{6}", p[1]):
                pick = (p[0], p[1], p[2])
                break
        if pick:
            out.append({"name": name, "market": pick[0], "code": pick[1], "quote_name": pick[2]})
        else:
            miss.append(name)
    except Exception:
        miss.append(name)
    time.sleep(0.05)

json.dump({"resolved": out, "missing": miss},
          open(ROOT + r"\data\unique_map.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)
print("resolved", len(out), "missing", len(miss))
for x in out:
    print(x["name"], x["market"], x["code"], x["quote_name"])
print("MISSING", miss)
