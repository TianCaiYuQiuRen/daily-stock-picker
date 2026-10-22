# -*- coding: utf-8 -*-
"""把本机 PDF 拆成在线阅读页。

用法：
    python tools/build_book.py
    python tools/build_book.py --pdf "C:\\...\\期货市场技术分析.pdf"

注意：
- 页面写到 data/book/pages，已被 .gitignore / 发布同步排除；
- 不把电子书页面打进免安装包或源码包，避免版权文件随发布包传播；
- 只在本机运行一次，阅读器会直接读取这些页面。
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core import config  # noqa: E402

DEFAULT_PDF = str(Path.home() / "Desktop" / "期货市场技术分析（约翰墨菲）.pdf")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", default=DEFAULT_PDF)
    parser.add_argument("--ocr-dir", default="", help="同时导出用于OCR的JPG目录")
    parser.add_argument("--width", type=int, default=1100)
    args = parser.parse_args()

    try:
        from pypdf import PdfReader
        from PIL import Image
    except ImportError:
        raise SystemExit("需要先安装 pypdf 和 Pillow：pip install pypdf Pillow")

    pdf = Path(args.pdf)
    if not pdf.exists():
        raise SystemExit("找不到 PDF：%s" % pdf)

    out = Path(config.DATA_DIR) / "book" / "pages"
    out.mkdir(parents=True, exist_ok=True)
    ocr_dir = Path(args.ocr_dir) if args.ocr_dir else None
    if ocr_dir:
        ocr_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(pdf))
    total = len(reader.pages)
    made = 0
    for i, page in enumerate(reader.pages):
        try:
            images = list(page.images)
            if not images:
                continue
            im = Image.open(io.BytesIO(images[0].data)).convert("RGB")
            if im.width > args.width:
                ratio = args.width / im.width
                im = im.resize((args.width, max(1, round(im.height * ratio))), Image.LANCZOS)
            im.save(out / ("p%04d.webp" % (i + 1)), "WEBP", quality=78, method=5)
            if ocr_dir:
                im.save(ocr_dir / ("p%04d.jpg" % (i + 1)), "JPEG", quality=86)
            made += 1
        except Exception as exc:  # noqa: BLE001
            print("skip page", i + 1, exc)
        if (i + 1) % 50 == 0:
            print("processed", i + 1, "/", total)

    meta = {
        "title": "期货市场技术分析",
        "author": "约翰·墨菲",
        "translator": "丁圣元",
        "edition": "1994 中文版",
        "total": total,
        "made": made,
        "source": str(pdf),
    }
    (Path(config.DATA_DIR) / "book" / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("done:", made, "/", total, "->", out)


if __name__ == "__main__":
    main()
