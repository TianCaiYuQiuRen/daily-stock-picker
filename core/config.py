# -*- coding: utf-8 -*-
"""全局配置：读写 data/config.json，并自动探测通达信安装目录。"""
import json
import os
import threading

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(APP_DIR, "data")
WEB_DIR = os.path.join(APP_DIR, "web")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
RESULT_PATH = os.path.join(DATA_DIR, "last_result.json")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")

DEFAULTS = {
    "tdx_root": "",
    "data_source": "auto",
    "strategy_params": {},
    "block_prefix": "智选",
    "strategy_key": "zhuanxing",
    "top_n": 0,
    "port": 8765,
    "bind": "0.0.0.0",
    "filters": {
        "boards": ["main", "gem", "star"],
        "exclude_st": True,
        "min_price": 2.0,
        "max_price": 500.0,
    },
    "schedule": {
        "enabled": True,
        "time": "15:05",
        "auto_write": True,
    },
    "share": {
        "auto": False,
        "allow_remote_scan": True,
    },
}

BOARDS = {
    "main": "主板",
    "gem": "创业板",
    "star": "科创板",
    "bj": "北交所",
}

_LOCK = threading.RLock()
_CFG = None


def ensure_dirs():
    for d in (DATA_DIR, BACKUP_DIR):
        os.makedirs(d, exist_ok=True)


def _merge(base, patch):
    out = dict(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def detect_tdx_root():
    """在常见位置寻找带 T0002 目录的通达信客户端。"""
    candidates = [
        r"F:\TDX", r"D:\TDX", r"C:\TDX", r"E:\TDX",
        r"C:\new_tdx", r"D:\new_tdx", r"E:\new_tdx", r"F:\new_tdx",
        r"C:\zd_zsone", r"D:\zd_zsone",
    ]
    for c in candidates:
        if c and os.path.isdir(os.path.join(c, "T0002")):
            return c
    # 扫描各盘符一层目录
    for drive in "CDEFGH":
        root = drive + ":\\"
        if not os.path.isdir(root):
            continue
        try:
            for entry in os.scandir(root):
                if entry.is_dir() and os.path.isdir(os.path.join(entry.path, "T0002")):
                    return entry.path
        except OSError:
            continue
    return ""


def load():
    global _CFG
    with _LOCK:
        cfg = json.loads(json.dumps(DEFAULTS))
        if os.path.exists(CONFIG_PATH):
            try:
                disk = json.load(open(CONFIG_PATH, "r", encoding="utf-8-sig"))
                cfg = _merge(cfg, disk)
            except (OSError, ValueError):
                pass
        if cfg.get("data_source") != "online" and (
                not cfg.get("tdx_root") or not os.path.isdir(os.path.join(cfg["tdx_root"], "T0002"))):
            cfg["tdx_root"] = detect_tdx_root()

        # 兼容旧版配置：把 exclude_* 迁移成 boards
        f = cfg.get("filters") or {}
        if not f.get("boards"):
            boards = ["main", "gem", "star", "bj"]
            if f.get("exclude_bj", True):
                boards.remove("bj")
            if f.get("exclude_star"):
                boards.remove("star")
            if f.get("exclude_chinext"):
                boards.remove("gem")
            f["boards"] = [b for b in boards if b in BOARDS]
            cfg["filters"] = f
        f.pop("exclude_bj", None)
        f.pop("exclude_star", None)
        f.pop("exclude_chinext", None)

        if cfg.get("strategy_key") not in ("zhuanxing", "bupiao", "shaofu", "fourtypes"):
            cfg["strategy_key"] = "zhuanxing"

        _CFG = cfg
        return cfg


def get():
    global _CFG
    with _LOCK:
        if _CFG is None:
            return load()
        return _CFG


def save(patch):
    global _CFG
    with _LOCK:
        cfg = _merge(get(), patch)
        ensure_dirs()
        tmp = CONFIG_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)
        _CFG = cfg
        return cfg


def load_last_result():
    try:
        with open(RESULT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save_last_result(result):
    ensure_dirs()
    tmp = RESULT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    os.replace(tmp, RESULT_PATH)
