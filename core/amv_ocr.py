# -*- coding: utf-8 -*-
"""调用 Windows 自带 OCR 识别指南针 0AMV 截图，提取数字。"""
import base64
import os
import re
import subprocess
import time

from core import config

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "tools", "ocr_image.ps1")
NUM = r"\d{1,3}(?:[.,·。，．]\d{1,3}){1,3}"


def _fix_number(s):
    s = s.strip().replace(" ", "").replace(",", "").replace("，", "")
    s = s.replace("·", ".").replace("。", ".").replace("．", ".")
    parts = s.split(".")
    if len(parts) > 2:
        s = "".join(parts[:-1]) + "." + parts[-1]
    return float(s)


def _norm_text(text):
    t = text.replace("％", "%").replace("＋", "+").replace("－", "-")
    t = t.replace("—", "-").replace("–", "-").replace("。", ".")
    return t


def parse(text):
    t = _norm_text(text)
    compact = re.sub(r"\s+", "", t)
    fields = {}

    candidates = []
    for m in re.finditer(NUM, compact):
        try:
            v = _fix_number(m.group(0))
        except ValueError:
            continue
        if 50000 <= v <= 500000:
            candidates.append(v)

    def labeled(label):
        m = re.search(label + r"[^\d]{0,4}(" + NUM + r")", compact)
        if not m:
            return None
        try:
            return _fix_number(m.group(1))
        except ValueError:
            return None

    high = labeled("高")
    low = labeled("低")
    open_ = labeled("开")
    if high is not None:
        fields["high"] = round(high, 2)
    if low is not None:
        fields["low"] = round(low, 2)
    if open_ is not None:
        fields["open"] = round(open_, 2)

    used = {round(x, 1) for x in (high, low, open_) if x is not None}
    close = None
    for v in candidates:
        if round(v, 1) in used:
            continue
        close = v
        break
    if close is None and candidates:
        close = candidates[0]
    if close is not None:
        fields["close"] = round(close, 2)

    m = re.search(r"([+-]?\d{1,2}(?:[.,·]\d{1,2}))\s*%", compact)
    if m:
        fields["chg"] = round(_fix_number(m.group(1)), 2)

    m = re.search(r"(20\d{2})(?:年|[-.]|一)(\d{1,2})(?:月|[-.]|一)(\d{1,2})", compact)
    if m:
        mon, day = int(m.group(2)), int(m.group(3))
    else:
        m = re.search(r"(?<!\d)(\d{1,2})(?:月|[-.]|一)(\d{1,2})(?!\d)", compact)
        mon = int(m.group(1)) if m else 0
        day = int(m.group(2)) if m else 0
    if 1 <= mon <= 12 and 1 <= day <= 31:
        year = time.strftime("%Y")
        fields["date"] = "%s-%02d-%02d" % (year, mon, day)

    return fields, candidates


def recognize(image_bytes, ext=".jpg"):
    os.makedirs(os.path.join(config.DATA_DIR, "uploads"), exist_ok=True)
    path = os.path.join(config.DATA_DIR, "uploads", "amv_ocr_%d%s" % (int(time.time() * 1000), ext))
    with open(path, "wb") as f:
        f.write(image_bytes)
    try:
        if not os.path.isfile(SCRIPT):
            raise RuntimeError("缺少 OCR 脚本 tools/ocr_image.ps1")
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", SCRIPT, "-Path", path],
            capture_output=True, timeout=40,
        )
        out = (proc.stdout or b"").decode("utf-8", "ignore")
        if proc.returncode != 0 and not out.strip():
            err = (proc.stderr or b"").decode("utf-8", "ignore")
            raise RuntimeError(err.strip()[:200] or "OCR 执行失败")
        text = out.strip()
        fields, candidates = parse(text)
        return {
            "ok": True,
            "fields": fields,
            "candidates": [round(x, 2) for x in candidates[:8]],
            "text": text[:4000],
        }
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
