# -*- coding: utf-8 -*-
"""生成 data/book/manifest.json：章节、小标题、页码。

页码以 PDF 页为准；OCR 目录可选。没有 OCR 时按章节区间均匀分布，
有 OCR 时用标题关键词定位，定位不到再回退。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.book_outline import BOOK, CHAPTERS, SECTION_PAGES  # noqa: E402

PARSED = Path(ROOT) / "data" / "book" / "ocr"
TOTAL_DEFAULT = 546


def clean(text):
    return re.sub(r"\s+", "", text or "")


def load_ocr(ocr_dir=None):
    root = Path(ocr_dir) if ocr_dir else PARSED
    out = {}
    if not root.exists():
        return out
    for p in root.glob("page_*.txt"):
        try:
            n = int(p.stem.split("_")[1])
            out[n] = clean(p.read_text(encoding="utf-8", errors="ignore"))
        except (ValueError, OSError):
            pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(ROOT) / "data" / "book" / "manifest.json"))
    ap.add_argument("--ocr", default="")
    args = ap.parse_args()

    meta_path = Path(ROOT) / "data" / "book" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    total = int(meta.get("total") or TOTAL_DEFAULT)
    ocr = load_ocr(args.ocr)

    chapters = []
    for idx, ch in enumerate(CHAPTERS):
        start = int(ch["fallback_page"])
        end = int(CHAPTERS[idx + 1]["fallback_page"]) if idx + 1 < len(CHAPTERS) else total + 1
        if end <= start:
            end = min(total + 1, start + 30)
        sections = []
        manual = SECTION_PAGES.get(ch["id"]) or []
        if len(manual) == len(ch["sections"]):
            for (title, _keys), page in zip(ch["sections"], manual):
                sections.append({"title": title, "page": int(page)})
        else:
            prev = start
            for si, (title, keys) in enumerate(ch["sections"]):
                want = [clean(k) for k in keys if clean(k)]
                hit = None
                for p in range(max(start, 1), min(total + 1, end)):
                    text = ocr.get(p, "")
                    if text and any(k in text for k in want):
                        hit = p
                        break
                if hit is None:
                    span = max(1, end - start)
                    hit = start + round((si + 1) * span / (len(ch["sections"]) + 1))
                hit = max(start, min(end - 1, hit))
                hit = max(prev, hit)
                prev = hit
                sections.append({"title": title, "page": int(hit)})
        chapters.append({
            "id": ch["id"],
            "title": ch["title"],
            "page": start,
            "sections": sections,
        })

    data = {
        "ok": True,
        "title": meta.get("title") or BOOK["title"],
        "author": meta.get("author") or BOOK["author"],
        "translator": meta.get("translator") or BOOK["translator"],
        "edition": meta.get("edition") or BOOK["edition"],
        "total": total,
        "chapters": chapters,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("manifest:", out, "chapters:", len(chapters), "total:", total)
    for ch in chapters:
        print(ch["page"], ch["title"], "|", ", ".join("%s:%s" % (s["title"], s["page"]) for s in ch["sections"]))


if __name__ == "__main__":
    main()
