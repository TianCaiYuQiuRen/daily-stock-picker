# -*- coding: utf-8 -*-
"""通达信自定义板块读写。

blocknew.cfg 每条记录 120 字节：板块名(50, GBK) + 板块文件名(50, ASCII) + 保留(20)。
.blk 每行 7 位：市场前缀(0深/1沪/2京) + 6 位代码。
"""
import os
import shutil
import subprocess
import time

RECORD_SIZE = 120
NAME_SIZE = 50
FILE_SIZE = 50

MARKET_PREFIX = {"sz": "0", "sh": "1", "bj": "2"}


class BlockError(Exception):
    pass


def blocknew_dir(root):
    return os.path.join(root, "T0002", "blocknew")


def cfg_path(root):
    return os.path.join(blocknew_dir(root), "blocknew.cfg")


def is_tdx_running():
    try:
        out = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq tdxw.exe", "/NH"],
            capture_output=True, text=True, errors="ignore", timeout=10,
        )
        return "tdxw.exe" in (out.stdout or "").lower()
    except Exception:
        return False


def close_tdx(wait=12):
    """先礼后兵：先发关闭消息，超时再强制结束。"""
    if not is_tdx_running():
        return True
    try:
        subprocess.run(["taskkill", "/IM", "tdxw.exe"], capture_output=True,
                       text=True, errors="ignore", timeout=10)
    except Exception:
        pass
    deadline = time.time() + wait
    while time.time() < deadline:
        if not is_tdx_running():
            return True
        time.sleep(0.5)
    try:
        subprocess.run(["taskkill", "/F", "/IM", "tdxw.exe"], capture_output=True,
                       text=True, errors="ignore", timeout=10)
    except Exception:
        pass
    time.sleep(1.0)
    return not is_tdx_running()


def start_tdx(root):
    exe = os.path.join(root, "tdxw.exe")
    if not os.path.isfile(exe):
        return False
    try:
        subprocess.Popen([exe], cwd=root, close_fds=True)
        return True
    except OSError:
        return False


def read_blocks(root):
    """解析 blocknew.cfg，返回 [{name, file, index}]。"""
    path = cfg_path(root)
    if not os.path.isfile(path):
        return []
    raw = open(path, "rb").read()
    out = []
    for i in range(0, len(raw) - RECORD_SIZE + 1, RECORD_SIZE):
        rec = raw[i:i + RECORD_SIZE]
        name = rec[:NAME_SIZE].split(b"\x00", 1)[0].decode("gbk", "ignore").strip()
        fname = rec[NAME_SIZE:NAME_SIZE + FILE_SIZE].split(b"\x00", 1)[0].decode("ascii", "ignore").strip()
        if not name or not fname:
            continue
        out.append({"name": name, "file": fname, "index": i // RECORD_SIZE})
    return out


def _blk_count(root, fname):
    path = os.path.join(blocknew_dir(root), fname + ".blk")
    if not os.path.isfile(path):
        return 0
    try:
        text = open(path, "rb").read().decode("ascii", "ignore")
    except OSError:
        return 0
    return len([ln for ln in text.replace("\r", "\n").split("\n") if ln.strip()])


def list_blocks(root):
    out = []
    for b in read_blocks(root):
        b["count"] = _blk_count(root, b["file"])
        out.append(b)
    return out


def _backup(root):
    ts = time.strftime("%Y%m%d_%H%M%S")
    src = cfg_path(root)
    if not os.path.isfile(src):
        return ""
    dst_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "backups")
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, "blocknew_%s.cfg" % ts)
    shutil.copy2(src, dst)
    return dst


def _new_file_name(root, existing):
    taken = {b["file"].upper() for b in existing}
    stamp = int(time.time())
    for i in range(1000):
        candidate = "ZX%05X" % ((stamp + i) % 0xFFFFF)
        if candidate.upper() not in taken:
            return candidate
    raise BlockError("无法生成新的板块文件名")


def _encode_line(market, code):
    prefix = MARKET_PREFIX.get(market, "0")
    return prefix + code


def write_block(root, name, pairs):
    """创建/更新自定义板块。

    pairs: [(market, code)]
    返回 {name, file, count, created, backup}
    """
    if not root or not os.path.isdir(os.path.join(root, "T0002")):
        raise BlockError("通达信目录无效：%s" % root)
    if not pairs:
        raise BlockError("没有可写入的股票")

    if not os.path.isdir(blocknew_dir(root)):
        os.makedirs(blocknew_dir(root), exist_ok=True)

    name = (name or "").strip()
    if not name:
        raise BlockError("板块名称为空")

    backup = _backup(root)
    entries = read_blocks(root)
    target = next((b for b in entries if b["name"] == name), None)
    created = target is None
    if target:
        fname = target["file"]
    else:
        fname = _new_file_name(root, entries)

    # 写 .blk
    lines = []
    seen = set()
    for market, code in pairs:
        line = _encode_line(market, code)
        if len(line) != 7 or line in seen:
            continue
        seen.add(line)
        lines.append(line)
    if not lines:
        raise BlockError("没有有效的股票代码")

    blk_file = os.path.join(blocknew_dir(root), fname + ".blk")
    tmp = blk_file + ".tmp"
    with open(tmp, "wb") as f:
        f.write(("\r\n".join(lines) + "\r\n").encode("ascii"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, blk_file)

    # 更新 cfg
    if created:
        rec = (name.encode("gbk", "ignore")[:NAME_SIZE].ljust(NAME_SIZE, b"\x00")
               + fname.encode("ascii")[:FILE_SIZE].ljust(FILE_SIZE, b"\x00")
               + b"\x00" * 20)
        with open(cfg_path(root), "ab") as f:
            f.write(rec)
            f.flush()
            os.fsync(f.fileno())

    # 校验
    check = next((b for b in read_blocks(root) if b["name"] == name), None)
    if not check or check["file"] != fname:
        raise BlockError("写入后校验失败，请检查 blocknew.cfg 是否被占用")
    if _blk_count(root, fname) != len(lines):
        raise BlockError("写入后校验失败：板块文件行数不一致")

    return {
        "name": name,
        "file": fname,
        "count": len(lines),
        "created": created,
        "backup": backup,
    }


def delete_block(root, name):
    """仅从 cfg 中移除（保留 .blk 文件），用于测试清理。"""
    entries = read_blocks(root)
    keep = [b for b in entries if b["name"] != name]
    if len(keep) == len(entries):
        return False
    _backup(root)
    data = b""
    for b in keep:
        data += (b["name"].encode("gbk", "ignore")[:NAME_SIZE].ljust(NAME_SIZE, b"\x00")
                 + b["file"].encode("ascii")[:FILE_SIZE].ljust(FILE_SIZE, b"\x00")
                 + b"\x00" * 20)
    with open(cfg_path(root), "wb") as f:
        f.write(data)
    return True
