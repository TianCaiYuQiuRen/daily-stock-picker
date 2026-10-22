# -*- coding: utf-8 -*-
"""每日选股系统 —— 本地 Web 服务（Python 标准库，无第三方依赖）。"""
import atexit
import calendar
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core import (chart_series, config, engine, history, online, patterns,  # noqa: E402
                  pattern_cases, quotes, sell, shape_match, snapshot, strategies,
                  tdx_block, training)
from core.tdx_local import TdxStore, board_of  # noqa: E402

WEB_DIR = config.WEB_DIR
BOOK_DIR = os.path.join(config.DATA_DIR, "book")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

_STORES = {}


def get_store(root):
    store = _STORES.get(root)
    if store is None:
        store = TdxStore(root)
        _STORES[root] = store
    return store


def bars_for(market, code, limit=400):
    """按当前数据模式取日线（历史统计/看图共用）。"""
    cfg = config.get()
    store = get_store(cfg["tdx_root"])
    if store.available() and cfg.get("data_source") != "online":
        return store.bars(market, code, limit=limit)
    bars = online.get_bars(market, code)
    if not bars:
        online.fetch_bars(market, code)
        bars = online.get_bars(market, code)
    return bars[:limit]


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return "127.0.0.1"


class ShareManager:
    """用 cloudflared 快速隧道把本机页面分享到公网。"""

    URL_RE = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    def __init__(self):
        self.lock = threading.Lock()
        self.proc = None
        self.url = ""
        self.error = ""
        self.started_at = ""
        self.port = 0

    def exe(self):
        candidates = [
            os.path.join(ROOT, "bin", "cloudflared.exe"),
            r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
            r"C:\Program Files\cloudflared\cloudflared.exe",
        ]
        found = shutil.which("cloudflared")
        if found:
            candidates.append(found)
        for path in candidates:
            try:
                if os.path.isfile(path) and os.path.getsize(path) > 30 * 1024 * 1024:
                    return path
            except OSError:
                continue
        return ""

    def status(self):
        running = bool(self.proc and self.proc.poll() is None)
        return {
            "running": running,
            "url": self.url if running else "",
            "last_url": self.url,
            "error": self.error,
            "started_at": self.started_at,
            "available": bool(self.exe()),
        }

    def start(self, port):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                return self.status()
            exe = self.exe()
            if not exe:
                raise RuntimeError("未找到 cloudflared.exe，请先运行「下载分享组件.bat」")
            self.url = ""
            self.error = ""
            self.port = port
            flags = 0
            if os.name == "nt":
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            self.proc = subprocess.Popen(
                [exe, "tunnel", "--url", "http://127.0.0.1:%d" % port,
                 "--no-autoupdate"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="ignore",
                creationflags=flags,
            )
            self.started_at = time.strftime("%H:%M:%S")
            threading.Thread(target=self._read, args=(self.proc,), daemon=True).start()
        return self.status()

    def _read(self, proc):
        try:
            for line in proc.stdout:
                if not self.url:
                    m = self.URL_RE.search(line)
                    if m:
                        self.url = m.group(0)
                if "ERR" in line and not self.url and not self.error:
                    self.error = line.strip()[:240]
        except Exception:
            pass
        proc.wait()
        if not self.url and not self.error:
            self.error = "隧道进程已退出，请重试"

    def stop(self):
        with self.lock:
            proc = self.proc
            self.proc = None
            self.url = ""
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        return self.status()


SHARE = ShareManager()


class AppState:
    def __init__(self):
        self.lock = threading.RLock()
        self.scan = {"running": False, "phase": "", "pct": 0.0, "error": None,
                     "started_at": None, "finished_at": None, "boards": []}
        self.result = config.load_last_result()
        self.last_auto_date = ""
        self.last_snap_date = ""
        self.write = {"ok": None, "message": "", "at": ""}
        self.last_remote_scan = 0.0

    def board_stats(self, cfg):
        stats = {key: 0 for key in config.BOARDS}
        store = get_store(cfg["tdx_root"])
        if store.available():
            for market, code in store.universe():
                b = board_of(market, code)
                if b in stats:
                    stats[b] += 1
        return stats

    def snapshot(self, remote=False, can_scan=True):
        with self.lock:
            cfg = config.get()
            store = get_store(cfg["tdx_root"])
            saved_params = cfg.get("strategy_params") or {}
            cur_key = cfg.get("strategy_key")
            strat = strategies.get_strategy(cur_key, saved_params.get(cur_key))
            pub = public_config(cfg)
            if remote:
                pub.pop("tdx_root", None)
            strat_meta = strat.meta()
            strat_meta["block_name"] = strat.block_name(cfg.get("block_prefix") or "智选")
            tdx_info = {
                "running": tdx_block.is_tdx_running(),
                "connected": bool(cfg.get("tdx_root")),
            }
            if not remote:
                tdx_info["root"] = cfg.get("tdx_root", "")
                tdx_info["blocks"] = (tdx_block.list_blocks(cfg["tdx_root"])
                                      if cfg.get("tdx_root") else [])
            else:
                tdx_info["blocks"] = []
            return {
                "config": pub,
                "scan": dict(self.scan),
                "result": self.result,
                "write": dict(self.write),
                "remote": remote,
                "can_write": not remote,
                "can_scan": can_scan,
                "boards": config.BOARDS,
                "board_stats": self.board_stats(cfg),
                "strategy": strat_meta,
                "strategy_list": [
                    dict(strategies.get_strategy(s.key, saved_params.get(s.key)).meta(),
                         block_name=strategies.get_strategy(s.key).block_name(
                             cfg.get("block_prefix") or "智选"),
                         default_params=dict(s.params))
                    for s in strategies.STRATEGIES.values()
                ],
                "snapshot": snapshot.info(),
                "tdx": tdx_info,
                "data_mode": "tdx" if store.available() else "online",
                "market_date": store.last_trade_date() if store.available() else 0,
                "share": SHARE.status(),
                "lan_url": "http://%s:%d" % (lan_ip(), STATE_PORT[0] or 8765),
                "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }


STATE = AppState()
STATE_PORT = [0]


def public_config(cfg):
    return {
        "tdx_root": cfg.get("tdx_root", ""),
        "data_source": cfg.get("data_source", "auto"),
        "strategy_params": cfg.get("strategy_params", {}),
        "block_prefix": cfg.get("block_prefix", "智选"),
        "strategy_key": cfg.get("strategy_key", ""),
        "top_n": cfg.get("top_n", 0),
        "filters": cfg.get("filters", {}),
        "schedule": cfg.get("schedule", {}),
        "share": cfg.get("share", {}),
    }


def normalize_boards(raw, cfg):
    if raw is None:
        return [b for b in (cfg["filters"].get("boards") or list(config.BOARDS)) if b in config.BOARDS]
    if isinstance(raw, str):
        raw = [raw]
    return [b for b in raw if b in config.BOARDS]


def normalize_strategy(raw, cfg):
    if raw in strategies.STRATEGIES:
        return raw
    key = cfg.get("strategy_key")
    return key if key in strategies.STRATEGIES else "zhuanxing"


def _run_scan_async(boards=None, strategy_key=None, auto_write=False):
    with STATE.lock:
        if STATE.scan["running"]:
            return False
        STATE.scan.update({"running": True, "phase": "准备中…", "pct": 0.0,
                           "error": None, "started_at": datetime.now().strftime("%H:%M:%S"),
                           "finished_at": None, "boards": list(boards or []),
                           "strategy": strategy_key or ""})
    config.ensure_dirs()

    def progress(phase, pct):
        with STATE.lock:
            STATE.scan["phase"] = phase
            STATE.scan["pct"] = round(float(pct), 3)

    def worker():
        result, err = engine.safe_scan(progress, boards, strategy_key)
        with STATE.lock:
            STATE.scan["running"] = False
            STATE.scan["finished_at"] = datetime.now().strftime("%H:%M:%S")
            STATE.scan["pct"] = 1.0
            if err:
                STATE.scan["error"] = err
                STATE.scan["phase"] = "失败"
            else:
                STATE.result = result
                STATE.scan["phase"] = "完成"
                try:
                    history.save(result)
                except Exception:
                    pass
        if result and auto_write and config.get()["schedule"].get("auto_write"):
            try:
                _write_block(auto=True)
            except Exception:
                pass

    threading.Thread(target=worker, daemon=True).start()
    return True


def _write_block(auto=False, restart=False):
    with STATE.lock:
        result = STATE.result
        if not result or not result.get("items"):
            raise ValueError("还没有选股结果，请先选股")
        if STATE.scan["running"]:
            raise ValueError("选股正在进行中，请稍候")
        name = result["strategy"]["block_name"]
        pairs = [(it["market"], it["code"]) for it in result["items"]]
        root = config.get()["tdx_root"]

    was_running = tdx_block.is_tdx_running()
    if was_running and auto:
        with STATE.lock:
            STATE.write = {"ok": False,
                           "message": "通达信正在运行，已跳过自动写入；请手动点「写入板块」（会先清空再写）"}
        return {"ok": False, "skipped": True, "reason": "tdx_running",
                "name": name, "removed": 0, "count": 0}
    if was_running and not auto and not restart:
        raise ValueError("通达信正在运行，请先关闭通达信再写入（程序会提示自动关闭）")
    if restart and was_running:
        if not tdx_block.close_tdx():
            raise ValueError("无法关闭通达信，请手动关闭后重试")
        time.sleep(1.0)

    info = tdx_block.write_block(root, name, pairs)
    info["ok"] = True
    info["at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    info["auto"] = auto
    info["tdx_running"] = tdx_block.is_tdx_running()
    info["restarted"] = False
    if restart and was_running:
        info["restarted"] = tdx_block.start_tdx(root)

    with STATE.lock:
        STATE.write = {"ok": True,
                       "message": "已清空「%s」原有 %d 只，写入 %d 只"
                                  % (name, info.get("removed", 0), info["count"]),
                       "at": info["at"]}
        if STATE.result is not None:
            STATE.result["written"] = {"name": name, "count": info["count"],
                                       "at": info["at"], "file": info["file"]}
            config.save_last_result(STATE.result)
    return info


def _capture_snapshot():
    try:
        info = engine.capture_1445()
        with STATE.lock:
            STATE.last_snap_date = str(info.get("date") or "")
    except Exception:
        pass


def _scheduler():
    while True:
        try:
            time.sleep(15)
            cfg = config.get()
            now = datetime.now()
            if now.weekday() >= 5:
                continue
            today = now.strftime("%Y-%m-%d")

            # 14:45 抓取全市场涨跌幅快照（少妇战法用）
            if now.strftime("%H:%M") == "14:45" and STATE.last_snap_date != today:
                STATE.last_snap_date = today
                threading.Thread(target=_capture_snapshot, daemon=True).start()

            sch = cfg.get("schedule") or {}
            if not sch.get("enabled"):
                continue
            if now.strftime("%H:%M") != str(sch.get("time") or "15:05"):
                continue
            with STATE.lock:
                if STATE.last_auto_date == today or STATE.scan["running"]:
                    continue
                STATE.last_auto_date = today
            _run_scan_async(auto_write=bool(sch.get("auto_write")))
        except Exception:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "DailyPicker/2.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _remote(self):
        ip = self.client_address[0]
        if ip in ("127.0.0.1", "::1"):
            for h in ("Cf-Connecting-Ip", "X-Forwarded-For", "X-Real-Ip"):
                v = self.headers.get(h)
                if v and v.strip() and not v.strip().startswith("127.0.0.1"):
                    return True
            return False
        return True

    def _send(self, code, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False, default=str))

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except ValueError:
            return {}

    def _static(self, rel):
        path = os.path.normpath(os.path.join(WEB_DIR, rel.lstrip("/")))
        if not (path == WEB_DIR or path.startswith(WEB_DIR + os.sep)) or not os.path.isfile(path):
            self._send(404, "Not Found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            data = f.read()
        self._send(200, data, MIME.get(ext, "application/octet-stream"))

    def _book_page(self, rel):
        name = os.path.basename(rel)
        if not re.fullmatch(r"p\d{4}\.webp", name):
            return self._send(404, "Not Found", "text/plain; charset=utf-8")
        path = os.path.join(BOOK_DIR, "pages", name)
        if not os.path.isfile(path):
            return self._send(404, "Not Found", "text/plain; charset=utf-8")
        with open(path, "rb") as f:
            data = f.read()
        self._send(200, data, "image/webp")

    # ---------- routes ----------
    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/" or path == "/index.html":
                return self._static("index.html")
            if path in ("/training", "/training/", "/training.html"):
                return self._static("training.html")
            if path.startswith("/book/pages/"):
                return self._book_page(path)
            if path.startswith("/api/"):
                return self._api_get(path, parse_qs(parsed.query))
            return self._static(path)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._json({"ok": False, "error": traceback.format_exc(limit=2)}, 500)

    def do_POST(self):
        try:
            path = urlparse(self.path).path
            data = self._body()  # 先读完请求体，避免 keep-alive 连接残留字节
            remote = self._remote()
            cfg = config.get()

            if path == "/api/scan":
                if remote and not (cfg.get("share") or {}).get("allow_remote_scan", True):
                    return self._json({"ok": False, "error": "访客选股已关闭，请联系站长"}, 403)
                now = time.time()
                if remote and now - STATE.last_remote_scan < 8:
                    return self._json({"ok": False, "error": "操作太快了，请 8 秒后再试"}, 429)
                boards = normalize_boards(data.get("boards"), cfg)
                if not boards:
                    return self._json({"ok": False, "error": "请至少选择一个板块"}, 400)
                strategy_key = normalize_strategy(data.get("strategy"), cfg)
                if not remote:
                    config.save({"filters": {"boards": boards}, "strategy_key": strategy_key})
                if remote:
                    STATE.last_remote_scan = now
                started = _run_scan_async(boards=boards, strategy_key=strategy_key,
                                          auto_write=False)
                return self._json({"ok": True, "started": started, "boards": boards,
                                   "strategy": strategy_key})

            if path == "/api/write":
                if remote:
                    return self._json({"ok": False, "error": "只有本机才能写入通达信板块"}, 403)
                try:
                    info = _write_block(auto=False, restart=bool(data.get("restart")))
                except ValueError as exc:
                    return self._json({"ok": False, "error": str(exc)}, 400)
                except tdx_block.BlockError as exc:
                    return self._json({"ok": False, "error": str(exc)}, 400)
                return self._json(info)

            if path == "/api/config":
                if remote:
                    return self._json({"ok": False, "error": "只有本机才能修改设置"}, 403)
                allowed = {}
                for key in ("tdx_root", "data_source", "block_prefix", "strategy_key", "top_n",
                            "filters", "schedule", "share", "strategy_params"):
                    if key in data:
                        allowed[key] = data[key]
                cfg2 = config.save(allowed)
                return self._json({"ok": True, "config": public_config(cfg2)})

            if path == "/api/snapshot":
                if remote:
                    return self._json({"ok": False, "error": "只有本机才能抓取快照"}, 403)
                try:
                    info = engine.capture_1445()
                except Exception as exc:  # noqa: BLE001
                    return self._json({"ok": False, "error": str(exc)}, 400)
                return self._json({"ok": True, "snapshot": info})

            if path == "/api/share":
                if remote:
                    return self._json({"ok": False, "error": "只有本机才能分享"}, 403)
                action = (data.get("action") or "").strip()
                if action == "start":
                    try:
                        st = SHARE.start(STATE_PORT[0])
                    except RuntimeError as exc:
                        return self._json({"ok": False, "error": str(exc)}, 400)
                    return self._json({"ok": True, "share": st})
                if action == "stop":
                    return self._json({"ok": True, "share": SHARE.stop()})
                return self._json({"ok": True, "share": SHARE.status()})

            if path == "/api/training/quiz/answer":
                qid = str(data.get("id") or "").strip()
                if not qid:
                    return self._json({"ok": False, "error": "缺少题目 id"}, 400)
                try:
                    return self._json(training.answer_quiz(qid, data.get("choice")))
                except KeyError as exc:
                    return self._json({"ok": False, "error": str(exc.args[0])}, 404)
                except Exception as exc:  # noqa: BLE001
                    return self._json({"ok": False, "error": str(exc)}, 502)

            if path == "/api/pattern/shape-match":
                shape = data.get("shape")
                if not isinstance(shape, list):
                    return self._json({"ok": False, "error": "请先在画板上画出走势"}, 400)
                try:
                    lookback = int(data.get("lookback") or 10)
                    limit = int(data.get("limit") or 20)
                    result = shape_match.find_matches(shape, lookback=lookback, limit=limit)
                    return self._json({"ok": True, **result})
                except ValueError as exc:
                    return self._json({"ok": False, "error": str(exc)}, 400)
                except Exception as exc:  # noqa: BLE001
                    return self._json({"ok": False, "error": str(exc)}, 502)

            if path == "/api/pattern/analyze":
                bars = data.get("bars")
                if not isinstance(bars, list):
                    return self._json({"ok": False, "error": "请提供从截图中识别出的K线数据"}, 400)
                if len(bars) > 600:
                    bars = bars[-600:]
                result = patterns.analyze(bars)
                return self._json(result, 200 if result.get("ok") else 400)

            return self._json({"ok": False, "error": "not found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._json({"ok": False, "error": traceback.format_exc(limit=3)}, 500)

    def _api_get(self, path, query):
        remote = self._remote()
        if path == "/api/health":
            return self._json({"ok": True, "service": "daily-picker",
                               "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        if path == "/api/book":
            mf = os.path.join(BOOK_DIR, "manifest.json")
            if not os.path.isfile(mf):
                return self._json({
                    "ok": False,
                    "error": "本机还没有生成电子书页面，请先运行 python tools/build_book.py",
                }, 404)
            try:
                with open(mf, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                data["ok"] = True
                return self._json(data)
            except (OSError, ValueError) as exc:
                return self._json({"ok": False, "error": str(exc)}, 500)
        if path == "/api/state":
            cfg = config.get()
            can_scan = (not remote) or (cfg.get("share") or {}).get("allow_remote_scan", True)
            return self._json(STATE.snapshot(remote=remote, can_scan=can_scan))
        if path == "/api/status":
            with STATE.lock:
                return self._json({"scan": dict(STATE.scan), "write": dict(STATE.write),
                                   "result": STATE.result})
        if path == "/api/quotes":
            codes = (query.get("codes") or [""])[0]
            pairs = []
            for token in codes.split(","):
                token = token.strip()
                if len(token) == 6 and token.isdigit():
                    pairs.append((quotes.market_of(token), token))
            if not pairs:
                return self._json({"quotes": [], "time": ""})
            fresh = quotes.fetch_few(pairs)
            out = []
            for code, q in fresh.items():
                out.append({"code": code, "price": q["price"], "pct": q["pct"],
                            "vol_ratio": q["vol_ratio"], "turnover": q["turnover"],
                            "amount": q["amount"], "time": q.get("time", "")})
            return self._json({"quotes": out, "time": datetime.now().strftime("%H:%M:%S")})
        if path == "/api/stock":
            code = (query.get("code") or [""])[0].strip()
            if not (len(code) == 6 and code.isdigit()):
                return self._json({"ok": False, "error": "股票代码无效"}, 400)
            market = quotes.market_of(code)
            bars = bars_for(market, code, 260)
            if not bars:
                return self._json({"ok": False, "error": "没有这只股票的历史数据"}, 404)
            q = quotes.fetch_few([(market, code)]).get(code)
            if not q:
                return self._json({"ok": False, "error": "行情获取失败"}, 502)
            today_int = int(datetime.now().strftime("%Y%m%d"))
            t = str(q.get("time") or "")
            closed = len(t) >= 14 and (int(t[:8]) < today_int or t[8:14] >= "150000")
            series = chart_series.build_series(bars, q, use_close=closed)
            if not series:
                return self._json({"ok": False, "error": "历史数据不足"}, 400)
            return self._json({"ok": True, "code": code, "market": market,
                               "name": q.get("name", ""), "series": series})

        if path == "/api/sell":
            code = (query.get("code") or [""])[0].strip()
            if not (len(code) == 6 and code.isdigit()):
                return self._json({"ok": False, "error": "股票代码无效"}, 400)
            market = quotes.market_of(code)
            bars = bars_for(market, code, 320)
            if not bars:
                return self._json({"ok": False, "error": "没有这只股票的历史数据"}, 404)
            q = quotes.fetch_few([(market, code)]).get(code)
            if not q:
                return self._json({"ok": False, "error": "行情获取失败"}, 502)
            today_int = int(datetime.now().strftime("%Y%m%d"))
            t = str(q.get("time") or "")
            closed = len(t) >= 14 and (int(t[:8]) < today_int or t[8:14] >= "150000")
            series = chart_series.build_series(bars, q, use_close=closed, limit=240)
            if not series:
                return self._json({"ok": False, "error": "历史数据不足"}, 400)
            result = sell.evaluate(series)
            result.update({"ok": True, "code": code, "market": market,
                           "name": q.get("name", ""), "series": series})
            return self._json(result)

        if path == "/api/calendar":
            month = (query.get("month") or [""])[0]
            m = re.match(r"^(\d{4})-(\d{2})$", month)
            if not m:
                return self._json({"ok": False, "error": "月份格式应为 YYYY-MM"}, 400)
            year, mon = int(m.group(1)), int(m.group(2))
            days = []
            source = "weekday"
            store = get_store(config.get().get("tdx_root"))
            if store.available():
                bars = store.bars("sh", "000001", limit=1600)
                prefix = "%04d%02d" % (year, mon)
                days = sorted({b[0] for b in bars if str(b[0]).startswith(prefix)})
                if days:
                    source = "tdx"
                    # 通达信日线可能还没下载今天（或最近一两天），按工作日补上缺口
                    now = datetime.now()
                    if (year, mon) == (now.year, now.month):
                        last = datetime.strptime(str(max(days)), "%Y%m%d").date()
                        cur = last + timedelta(days=1)
                        while cur <= now.date():
                            if cur.weekday() < 5:
                                v = cur.year * 10000 + cur.month * 100 + cur.day
                                if v not in days:
                                    days.append(v)
                            cur += timedelta(days=1)
                        days = sorted(set(days))
            if not days:
                for d in range(1, calendar.monthrange(year, mon)[1] + 1):
                    if datetime(year, mon, d).weekday() < 5:
                        days.append(year * 10000 + mon * 100 + d)
            return self._json({"ok": True, "month": month, "days": days, "source": source})

        if path == "/api/history":
            rec_id = (query.get("id") or [""])[0].strip()
            if not rec_id:
                return self._json({"records": history.list_records()})
            try:
                rec = history.load(rec_id)
            except (OSError, ValueError):
                return self._json({"ok": False, "error": "记录不存在"}, 404)
            return self._json(history.with_returns(rec, bars_for))

        if path == "/api/blocks":
            if remote:
                return self._json({"blocks": []})
            cfg = config.get()
            return self._json({"blocks": tdx_block.list_blocks(cfg["tdx_root"])})
        if path == "/api/config":
            if remote:
                return self._json({"config": {}})
            cfg = config.get()
            return self._json({"config": public_config(cfg)})
        if path == "/api/share":
            return self._json({"share": SHARE.status()})

        if path == "/api/training/session":
            period = (query.get("period") or ["day"])[0]
            initial = (query.get("initial") or ["60"])[0]
            try:
                initial = int(initial)
            except (TypeError, ValueError):
                initial = 60
            try:
                return self._json(training.make_session(period, initial))
            except Exception as exc:  # noqa: BLE001
                return self._json({"ok": False, "error": str(exc)}, 502)

        if path == "/api/training/reveal":
            sid = (query.get("id") or [""])[0].strip()
            if not sid:
                return self._json({"ok": False, "error": "缺少训练 id"}, 400)
            try:
                return self._json(training.reveal_session(sid))
            except KeyError as exc:
                return self._json({"ok": False, "error": str(exc.args[0])}, 404)
            except Exception as exc:  # noqa: BLE001
                return self._json({"ok": False, "error": str(exc)}, 502)

        if path == "/api/training/quiz":
            period = (query.get("period") or ["day"])[0]
            try:
                return self._json(training.make_quiz(period))
            except Exception as exc:  # noqa: BLE001
                return self._json({"ok": False, "error": str(exc)}, 502)

        if path == "/api/pattern/cases":
            key = (query.get("key") or [""])[0].strip()
            if not key:
                return self._json({"ok": False, "error": "缺少形态 key"}, 400)
            force = (query.get("force") or ["0"])[0] in ("1", "true", "yes")
            try:
                cases = pattern_cases.get_cases(key, 3, force=force)
                auto = bool(patterns.LIB_MAP.get(key, {}).get("detect", True))
                return self._json({"ok": True, "key": key, "auto": auto, "cases": cases})
            except KeyError as exc:
                return self._json({"ok": False, "error": str(exc.args[0])}, 404)
            except Exception as exc:  # noqa: BLE001
                return self._json({"ok": False, "error": str(exc)}, 502)

        if path in ("/api/patterns", "/api/training/patterns"):
            return self._json({
                "ok": True,
                "periods": [{"key": k, "label": training.PERIODS[k]["label"]}
                            for k in training.PERIOD_ORDER],
                "patterns": patterns.library(),
            })

        return self._json({"ok": False, "error": "not found"}, 404)


def pick_port(host, preferred):
    for port in range(preferred, preferred + 30):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit("没有可用端口")


def _already_running(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port, timeout=1.5) as r:
            return b"server_time" in r.read()
    except Exception:
        return False


def main():
    config.ensure_dirs()
    cfg = config.load()
    host = cfg.get("bind") or "0.0.0.0"
    preferred = int(os.environ.get("PORT") or cfg.get("port") or 8765)
    if _already_running(preferred):
        print("每日选股已在运行：http://127.0.0.1:%d" % preferred)
        return
    port = pick_port(host, preferred)
    STATE_PORT[0] = port
    threading.Thread(target=_scheduler, daemon=True).start()

    if (cfg.get("share") or {}).get("auto"):
        try:
            SHARE.start(port)
        except Exception:
            pass

    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    atexit.register(SHARE.stop)
    local = "http://127.0.0.1:%d" % port
    lan = "http://%s:%d" % (lan_ip(), port)
    print("=" * 60)
    print("  每日选股系统已启动")
    print("  通达信目录：%s" % (cfg.get("tdx_root") or "未检测到"))
    print("  本机访问：%s" % local)
    print("  局域网访问：%s" % lan)
    print("  公网分享：点网页右上角「分享」生成链接")
    print("  保持本窗口运行，程序会按设定时间自动选股")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
