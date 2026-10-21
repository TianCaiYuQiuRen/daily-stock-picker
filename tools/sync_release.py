# -*- coding: utf-8 -*-
"""一键同步发布包 + 重建两个压缩包 + 刷新桌面快捷方式。

用法（在项目根目录）：
    python tools/sync_release.py

做的事：
  1. 把当前项目同步到 发布/每日选股（免安装版目录）
  2. 把当前项目同步到 发布/源码/每日选股_源码（源码版目录）
  3. 重新生成 每日选股_免安装版.zip 和 每日选股_源码.zip
  4. 刷新桌面「每日选股」「K线训练」快捷方式

以后改动代码后，双击根目录的「更新发布包.bat」即可完成以上全部步骤。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
PUBLISH = WORKSPACE / "发布"
STANDALONE = PUBLISH / "每日选股"
SOURCE_DIR = PUBLISH / "源码" / "每日选股_源码"

STANDALONE_ZIP = PUBLISH / "每日选股_免安装版.zip"
SOURCE_ZIP = PUBLISH / "源码" / "每日选股_源码.zip"

ROOT_FILES_COMMON = [
    "server.py",
    "README.md",
    "使用说明.txt",
    "启动选股系统.bat",
    "启动K线训练.bat",
    "启动.bat",
    "创建桌面快捷方式.bat",
    "create_shortcuts.ps1",
    "后台运行.vbs",
    "下载分享组件.bat",
    "允许局域网访问.bat",
]
ROOT_FILES_SOURCE = ROOT_FILES_COMMON + [
    "源码说明.md",
    "更新发布包.bat",
    ".dockerignore",
    ".gitignore",
    "Caddyfile",
    "docker-compose.yml",
    "Dockerfile",
]
COPY_DIRS = ["core", "web", "deploy", "tools"]
ASSETS = ["app.ico", "training.ico"]
DOCS_STANDALONE = ["screenshot.png", "training.png", "murphy-pattern-notes.md"]
EXCLUDE_PARTS = {"__pycache__", ".git", ".pytest_cache", "node_modules"}


def log(msg=""):
    print(msg, flush=True)


def copy_file(src: Path, dst: Path):
    if not src.is_file():
        return 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return 1


def copy_tree(src: Path, dst: Path):
    if not src.is_dir():
        return 0
    count = 0
    for base, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_PARTS]
        src_base = Path(base)
        rel = src_base.relative_to(src)
        target_base = dst / rel
        target_base.mkdir(parents=True, exist_ok=True)
        for name in files:
            if name.endswith(".pyc") or name.endswith(".pyo"):
                continue
            if name in (".DS_Store", "Thumbs.db"):
                continue
            shutil.copy2(src_base / name, target_base / name)
            count += 1
    return count


def sync_standalone():
    log("[1/4] 同步免安装版目录 ...")
    STANDALONE.mkdir(parents=True, exist_ok=True)
    n = 0
    for name in ROOT_FILES_COMMON:
        n += copy_file(ROOT / name, STANDALONE / name)
    for d in ("core", "web"):
        n += copy_tree(ROOT / d, STANDALONE / d)
    for name in ASSETS:
        n += copy_file(ROOT / "assets" / name, STANDALONE / "assets" / name)
    for name in DOCS_STANDALONE:
        n += copy_file(ROOT / "docs" / name, STANDALONE / "docs" / name)
    if not (STANDALONE / "python" / "python.exe").exists():
        log("  ! 警告：免安装版目录里没有 python\\python.exe，解压后的启动脚本会依赖系统 Python")
    log("  已同步 %d 个文件 -> %s" % (n, STANDALONE))


def sync_source():
    log("[2/4] 同步源码版目录 ...")
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for name in ROOT_FILES_SOURCE:
        n += copy_file(ROOT / name, SOURCE_DIR / name)
    for d in COPY_DIRS:
        n += copy_tree(ROOT / d, SOURCE_DIR / d)
    for name in ASSETS:
        n += copy_file(ROOT / "assets" / name, SOURCE_DIR / "assets" / name)
    n += copy_tree(ROOT / "docs", SOURCE_DIR / "docs")
    log("  已同步 %d 个文件 -> %s" % (n, SOURCE_DIR))


def build_zip(folder: Path, out: Path, root_name: str, skip_dirs: set):
    log("  重建 %s ..." % out.name)
    if not folder.is_dir():
        raise SystemExit("发布目录不存在：%s" % folder)
    tmp = out.with_suffix(out.suffix + ".tmp")
    if tmp.exists():
        tmp.unlink()
    count = 0
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for base, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in skip_dirs and d not in EXCLUDE_PARTS]
            for name in files:
                if name.endswith((".pyc", ".pyo")) or name in (".DS_Store", "Thumbs.db"):
                    continue
                src = Path(base) / name
                rel = src.relative_to(folder)
                arc = Path(root_name) / rel
                z.write(src, str(arc).replace("\\", "/"))
                count += 1
    if out.exists():
        out.unlink()
    tmp.replace(out)
    log("  完成：%d 个文件，%.1f MB" % (count, out.stat().st_size / 1024 / 1024))


def refresh_shortcuts():
    log("[4/4] 刷新桌面快捷方式 ...")
    ps1 = ROOT / "create_shortcuts.ps1"
    if not ps1.exists():
        log("  ! 找不到 create_shortcuts.ps1，跳过")
        return
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps1)],
            check=False,
        )
    except OSError as exc:
        log("  ! 刷新快捷方式失败：%s" % exc)


def main():
    parser = argparse.ArgumentParser(description="同步发布包、重建压缩包、刷新桌面快捷方式")
    parser.add_argument("--skip-shortcut", action="store_true", help="只打包，不刷新桌面快捷方式")
    parser.add_argument("--skip-zip", action="store_true", help="只同步目录，不重建压缩包")
    args = parser.parse_args()

    if not (ROOT / "server.py").exists():
        raise SystemExit("没有找到 server.py，请在项目根目录运行")
    if not PUBLISH.exists():
        raise SystemExit("没有找到发布目录：%s" % PUBLISH)

    log("=" * 62)
    log("  K线训练营 · 发布更新")
    log("  项目：%s" % ROOT)
    log("  发布：%s" % PUBLISH)
    log("=" * 62)

    # 清理旧版本遗留文件（快捷方式脚本已改名为 ASCII 文件名）
    for folder in (STANDALONE, SOURCE_DIR):
        stale = folder / "创建桌面快捷方式.ps1"
        if stale.exists():
            stale.unlink()
            log("  已移除旧文件：%s" % stale)

    sync_standalone()
    sync_source()

    if not args.skip_zip:
        log("[3/4] 重建两个压缩包 ...")
        build_zip(STANDALONE, STANDALONE_ZIP, "每日选股",
                  {"data", "bin", "tools", "__pycache__", ".git"})
        build_zip(SOURCE_DIR, SOURCE_ZIP, "每日选股_源码",
                  {"data", "bin", "__pycache__", ".git"})
    else:
        log("[3/4] 已跳过压缩包")

    if not args.skip_shortcut:
        refresh_shortcuts()
    else:
        log("[4/4] 已跳过桌面快捷方式")

    log("=" * 62)
    log("  更新完成")
    if not args.skip_zip:
        log("  免安装包：%s" % STANDALONE_ZIP)
        log("  源码包：  %s" % SOURCE_ZIP)
    log("  桌面快捷方式：每日选股 / K线训练")
    log("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
