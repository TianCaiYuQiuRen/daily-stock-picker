/* ===== 每日选股 前端逻辑 ===== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    cfg: null,
    strategy: null,
    result: null,
    scan: { running: false },
    tdx: {},
    remote: false,
    canScan: true,
    canWrite: true,
    boardsMeta: {},
    boardStats: {},
    selectedBoards: [],
    strategyKey: "",
    strategyList: [],
    sort: { key: "score", dir: -1 },
    share: { running: false },
  };

  let pollTimer = null;
  let quoteTimer = null;
  let toastTimer = null;
  let shareTimer = null;
  let modalResolve = null;

  /* ---------- 基础工具 ---------- */
  async function api(path, opts) {
    const init = Object.assign({ headers: {} }, opts || {});
    if (init.body && typeof init.body !== "string") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(init.body);
    }
    const resp = await fetch(path, init);
    let data = {};
    try { data = await resp.json(); } catch (e) { data = {}; }
    if (!resp.ok) {
      const err = new Error(data.error || ("请求失败 (" + resp.status + ")"));
      err.data = data;
      throw err;
    }
    return data;
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function showModal(title, text, okText, withCancel) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      $("modalTitle").textContent = title;
      $("modalText").textContent = text;
      $("modalOk").textContent = okText || "知道了";
      $("modalCancel").hidden = !withCancel;
      $("modal").hidden = false;
    });
  }

  function closeModal(value) {
    $("modal").hidden = true;
    if (modalResolve) {
      const fn = modalResolve;
      modalResolve = null;
      fn(!!value);
    }
  }

  const fmtPrice = (v) => (v === undefined || v === null || !isFinite(v)) ? "--" : Number(v).toFixed(2);
  const fmtPct = (v) => (v > 0 ? "+" : "") + Number(v || 0).toFixed(2) + "%";
  const fmtRatio = (v) => (v === undefined || v === null || v === 0) ? "--" : Number(v).toFixed(2);
  const fmtTurnover = (v) => (v === undefined || v === null || v === 0) ? "--" : Number(v).toFixed(2) + "%";

  function fmtAmount(v) {
    if (!v) return "--";
    if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
    if (v >= 1e4) return (v / 1e4).toFixed(0) + "万";
    return Number(v).toFixed(0);
  }

  function fmtCap(v) {
    if (!v) return "--";
    return Number(v).toFixed(0) + "亿";
  }

  function fmtQuoteTime(t) {
    if (!t) return "--";
    t = String(t);
    if (/^\d{14}$/.test(t)) {
      return t.slice(8, 10) + ":" + t.slice(10, 12) + ":" + t.slice(12, 14);
    }
    return t;
  }

  function fmtMarketDate(d) {
    d = String(d || "");
    if (/^\d{8}$/.test(d)) return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
    return d || "--";
  }

  function pctClass(v) {
    if (v > 0) return "up";
    if (v < 0) return "down";
    return "flat";
  }

  /* ---------- 排序 ---------- */
  function loadSort() {
    try {
      const saved = JSON.parse(localStorage.getItem("picker_sort") || "null");
      if (saved && saved.key) return saved;
    } catch (e) { /* ignore */ }
    return { key: "score", dir: -1 };
  }

  function saveSort() {
    try { localStorage.setItem("picker_sort", JSON.stringify(state.sort)); } catch (e) {}
  }

  function sortItems(items) {
    const key = state.sort.key;
    const dir = state.sort.dir;
    const arr = items.slice();
    arr.sort((a, b) => {
      if (key === "code" || key === "name") {
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""), "zh");
      }
      const va = Number(a[key] || 0);
      const vb = Number(b[key] || 0);
      return dir * (va - vb);
    });
    return arr;
  }

  function updateSortHeaders() {
    document.querySelectorAll("#resultTable th[data-sort]").forEach((th) => {
      const active = th.dataset.sort === state.sort.key;
      th.classList.toggle("active", active);
      const arrow = th.querySelector(".arrow");
      if (arrow) arrow.textContent = active ? (state.sort.dir > 0 ? "▲" : "▼") : "";
    });
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- 行情状态 ---------- */
  function marketStatus() {
    const now = new Date();
    const day = now.getDay();
    const mins = now.getHours() * 60 + now.getMinutes();
    if (day === 0 || day === 6) return ["休市", "closed"];
    if (mins >= 555 && mins < 690) return ["交易中", "live"];
    if (mins >= 690 && mins < 780) return ["午间休市", "closed"];
    if (mins >= 780 && mins < 900) return ["交易中", "live"];
    if (mins < 555) return ["未开盘", "closed"];
    return ["已收盘", "closed"];
  }

  function isTrading() { return marketStatus()[1] === "live"; }

  function updateMarketClock() {
    const [text, cls] = marketStatus();
    $("marketText").textContent = text;
    $("marketDot").className = "dot " + cls;
  }

  /* ---------- 板块选择 ---------- */
  function loadSavedBoards() {
    try {
      const raw = localStorage.getItem("picker_boards");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveBoardsLocal() {
    try { localStorage.setItem("picker_boards", JSON.stringify(state.selectedBoards)); } catch (e) {}
  }

  function initBoards() {
    const keys = Object.keys(state.boardsMeta || {});
    let picked = loadSavedBoards();
    if (!Array.isArray(picked) || !picked.length) {
      if (state.result && state.result.boards && state.result.boards.length) {
        picked = state.result.boards;
      } else if (state.cfg && state.cfg.filters && state.cfg.filters.boards) {
        picked = state.cfg.filters.boards;
      } else {
        picked = keys;
      }
    }
    picked = picked.filter((b) => keys.indexOf(b) >= 0);
    state.selectedBoards = picked.length ? picked : keys.slice();
  }

  function renderBoards() {
    const box = $("boardChips");
    const keys = Object.keys(state.boardsMeta || {});
    box.innerHTML = keys.map((key) => {
      const active = state.selectedBoards.indexOf(key) >= 0 ? " active" : "";
      const count = state.boardStats[key] || 0;
      return '<button type="button" class="board-chip' + active + '" data-board="' + key + '">' +
        esc(state.boardsMeta[key]) + '<em>' + count + '</em></button>';
    }).join("");

    box.querySelectorAll(".board-chip").forEach((btn) => {
      btn.addEventListener("click", () => toggleBoard(btn.dataset.board));
    });

    const total = state.selectedBoards.reduce((s, k) => s + (state.boardStats[k] || 0), 0);
    $("boardHint").textContent = state.selectedBoards.length
      ? "已选 " + state.selectedBoards.length + " 个板块 · " + total + " 只"
      : "请至少选择一个板块";
    if (!state.canScan) {
      $("boardHint").textContent = "访客可查看，选股已关闭";
    }
  }

  function toggleBoard(key) {
    if (!state.canScan) {
      toast("站长已关闭访客选股");
      return;
    }
    const idx = state.selectedBoards.indexOf(key);
    if (idx >= 0) {
      if (state.selectedBoards.length === 1) {
        toast("至少保留一个板块");
        return;
      }
      state.selectedBoards.splice(idx, 1);
    } else {
      state.selectedBoards.push(key);
    }
    saveBoardsLocal();
    renderBoards();
  }

  /* ---------- 渲染 ---------- */
  function selectedMeta() {
    return (state.strategyList || []).find((s) => s.key === state.strategyKey) ||
      state.strategy || (state.result && state.result.strategy) || null;
  }

  function resultMatchesSelection() {
    return !!(state.result && state.result.strategy &&
      state.result.strategy.key === state.strategyKey);
  }

  function renderStrategy() {
    const st = selectedMeta();
    if (!st) return;
    $("strategyName").textContent = st.name || "策略";
    $("strategyDesc").textContent = st.description || "";
    const chips = st.chips || [];
    $("paramChips").innerHTML = chips.map((c) => '<span class="chip">' + esc(c) + "</span>").join("");
  }

  function renderStrategyBar() {
    const box = $("strategyChips");
    box.innerHTML = (state.strategyList || []).map((s) =>
      '<button type="button" class="strategy-chip' + (s.key === state.strategyKey ? " active" : "") +
      '" data-key="' + esc(s.key) + '">' + esc(s.name) + "</button>"
    ).join("");
    box.querySelectorAll(".strategy-chip").forEach((btn) => {
      btn.addEventListener("click", () => selectStrategy(btn.dataset.key));
    });
    $("strategyHint").textContent = resultMatchesSelection() ? "" : "已切换战法，点「开始选股」生效";
  }

  function selectStrategy(key) {
    if (!key || key === state.strategyKey) return;
    if (state.scan.running) { toast("选股进行中，请稍候"); return; }
    state.strategyKey = key;
    try { localStorage.setItem("picker_strategy", key); } catch (e) {}
    renderStrategyBar();
    renderStrategy();
    renderBlock();
    renderMeta();
    setWriteEnabled(state.canWrite);
    renderTable();
    if (!$("drawer").hidden) renderParamFields();
  }

  function renderStats() {
    const r = state.result;
    $("statUniverse").textContent = r ? r.universe : "--";
    $("statMatched").textContent = r ? r.matched : "--";
    $("statTime").textContent = r ? (r.elapsed + "s") : "--";
  }

  function renderMeta() {
    const r = state.result;
    if (!r) {
      $("metaText").textContent = "尚未选股";
      return;
    }
    let text = "更新于 " + r.generated_at +
      " · 行情 " + fmtQuoteTime(r.quote_time) +
      " · 日线 " + fmtMarketDate(r.market_date);
    if (r.data_mode === "online") {
      text += " · 在线日线";
    }
    if (r.price_mode === "close") {
      text += " · 收盘价筛选";
    }
    if (r.strategy && r.strategy.key === "shaofu") {
      if (r.pct1445 && r.pct1445.available) {
        text += " · 14:45 快照 ✓";
      } else {
        text += " · 14:45 快照缺失（用当前涨幅代替）";
      }
    }
    if (!resultMatchesSelection()) {
      text += " · 已切换战法，请重新选股";
    }
    $("metaText").textContent = text;
  }

  function renderTable() {
    const r = state.result;
    const body = $("resultBody");
    const empty = $("empty");
    const raw = (r && r.items) || [];
    const items = sortItems(raw);

    if (!raw.length) {
      body.innerHTML = "";
      empty.hidden = false;
      empty.querySelector(".empty-title").textContent = r ? "今日没有符合条件的股票" : "还没有选股结果";
      empty.querySelector(".empty-sub").textContent = r
        ? "可以换一个板块范围，或等待下一个交易日"
        : "点击「开始选股」，从全市场实时行情中筛选";
      $("btnExport").disabled = true;
      setWriteEnabled(false);
      return;
    }

    empty.hidden = true;
    $("btnExport").disabled = false;
    setWriteEnabled(state.canWrite);

    const html = items.map((it, idx) => {
      const pctCls = pctClass(it.pct);
      const tags = (it.tags || []).slice(0, 2).map((t, i) =>
        '<span class="tagbadge' + (i === 0 ? " green" : "") + '">' + esc(t) + "</span>"
      ).join("");
      return (
        '<tr class="clickable" data-code="' + it.code + '" data-price="' + it.price + '">' +
        '<td class="rank">' + (idx + 1) + "</td>" +
        '<td class="code">' + esc(it.code) + "</td>" +
        '<td class="name">' + esc(it.name) + "</td>" +
        '<td class="num price">' + fmtPrice(it.price) + "</td>" +
        '<td class="num"><span class="pct ' + pctCls + '">' + fmtPct(it.pct) + "</span></td>" +
        '<td class="num vol-ratio">' + fmtRatio(it.vol_ratio) + "</td>" +
        '<td class="num turnover">' + fmtTurnover(it.turnover) + "</td>" +
        '<td class="num amount">' + fmtAmount(it.amount) + "</td>" +
        '<td class="num float-cap">' + fmtCap(it.float_cap) + "</td>" +
        '<td class="signals">' + tags + "</td>" +
        "</tr>"
      );
    }).join("");
    body.innerHTML = html;
    body.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => openChart(tr.dataset.code));
    });
    updateSortHeaders();
  }

  function setWriteEnabled(on) {
    const has = !!(state.result && state.result.items && state.result.items.length);
    const connected = !!(state.tdx && state.tdx.connected);
    const enabled = has && on && state.canWrite && connected && resultMatchesSelection();
    ["btnWrite", "btnWriteSide"].forEach((id) => {
      const el = $(id);
      el.disabled = !enabled;
      el.hidden = !state.canWrite || !connected;
    });
  }

  function renderBlock() {
    const r = state.result;
    const meta = selectedMeta();
    const name = (meta && meta.block_name) ||
      (r && r.strategy && r.strategy.block_name) || "--";
    $("blockName").textContent = name;

    const tag = $("tdxTag");
    if (state.remote) {
      tag.textContent = "本机维护";
      tag.className = "tag warn";
    } else if (!state.tdx || !state.tdx.connected) {
      tag.textContent = "在线数据";
      tag.className = "tag warn";
    } else if (state.tdx.running) {
      tag.textContent = "运行中";
      tag.className = "tag ok";
    } else {
      tag.textContent = "未运行";
      tag.className = "tag";
    }

    const written = (r && r.written && resultMatchesSelection()) ? r.written : null;
    if (written) {
      tag.textContent = "已写入";
      tag.className = "tag ok";
      $("blockDesc").textContent = "已写入 " + written.count + " 只 · " + (written.at || "").slice(11, 16);
      $("writeHint").textContent = "重启通达信后，在左侧「板块」中即可看到";
    } else if (state.remote) {
      $("blockDesc").textContent = "板块由站长的通达信客户端维护";
      $("writeHint").textContent = "访客只能查看，不能写入";
    } else if (!state.tdx || !state.tdx.connected) {
      $("blockDesc").textContent = "未检测到通达信，当前为在线数据模式";
      $("writeHint").textContent = "安装通达信并下载盘后数据后，即可把结果写入板块";
    } else if (!resultMatchesSelection()) {
      $("blockDesc").textContent = "已切换战法，重新选股后才能写入该板块";
      $("writeHint").textContent = "先点「开始选股」，再写入板块";
    } else {
      $("blockDesc").textContent = "尚未写入，点击下方按钮创建板块";
      $("writeHint").textContent = "通达信只在启动时读取板块，写入后需重启客户端";
    }
  }

  function renderAll() {
    renderStrategy();
    renderStrategyBar();
    renderStats();
    renderMeta();
    renderTable();
    renderBlock();
    renderBoards();
    updateMarketClock();
    const r = state.result;
    $("quoteTime").textContent = r ? fmtQuoteTime(r.quote_time) : "--";
    const sch = (state.cfg && state.cfg.schedule) || {};
    $("schedTime").textContent = sch.time || "15:05";
  }

  function applyMode() {
    $("guestPill").hidden = !state.remote;
    $("btnSettings").hidden = state.remote;
    $("btnShare").hidden = state.remote;
    if (!state.canScan) {
      $("btnScan").disabled = true;
      $("btnScan").title = "站长已关闭访客选股";
    }
  }

  /* ---------- 选股 ---------- */
  function setScanning(on) {
    const btn = $("btnScan");
    btn.disabled = on || !state.canScan;
    btn.classList.toggle("loading", on);
    btn.textContent = on ? "选股中" : "开始选股";
    $("progress").hidden = !on;
    if (!on) $("progressFill").style.width = "0%";
  }

  function updateProgress(scan) {
    $("progress").hidden = false;
    const pct = Math.round((scan.pct || 0) * 100);
    $("progressFill").style.width = pct + "%";
    $("progressText").textContent = scan.phase || "处理中…";
    $("progressPct").textContent = pct + "%";
  }

  async function startScan() {
    if (state.scan.running || !state.canScan) return;
    if (!state.selectedBoards.length) {
      toast("请先选择至少一个板块");
      return;
    }
    setScanning(true);
    updateProgress({ phase: "正在启动选股…", pct: 0.01 });
    try {
      await api("/api/scan", { method: "POST", body: { boards: state.selectedBoards, strategy: state.strategyKey } });
      pollScan();
    } catch (e) {
      setScanning(false);
      showModal("无法开始选股", e.message);
    }
  }

  function pollScan() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const s = await api("/api/status");
        state.scan = s.scan;
        updateProgress(s.scan);
        if (s.scan.running) {
          pollScan();
          return;
        }
        setScanning(false);
        if (s.scan.error) {
          showModal("选股失败", s.scan.error);
        } else if (s.result) {
          state.result = s.result;
          if (s.result.strategy && s.result.strategy.key) {
            state.strategyKey = s.result.strategy.key;
          }
          if (s.result.boards && s.result.boards.length) {
            state.selectedBoards = s.result.boards.slice();
            saveBoardsLocal();
          }
          renderAll();
          toast("选股完成，今日入选 " + s.result.matched + " 只");
          scheduleQuotes();
        }
      } catch (e) {
        setScanning(false);
        showModal("选股失败", e.message);
      }
    }, 600);
  }

  /* ---------- 实时刷新 ---------- */
  function scheduleQuotes() {
    clearTimeout(quoteTimer);
    const delay = isTrading() ? 5000 : 30000;
    quoteTimer = setTimeout(async () => {
      const r = state.result;
      if (!r || !r.items || !r.items.length || state.scan.running) {
        scheduleQuotes();
        return;
      }
      try {
        const codes = r.items.map((i) => i.code).join(",");
        const data = await api("/api/quotes?codes=" + codes);
        applyQuotes(data.quotes || []);
        if (data.time && (!r.quote_time || String(data.time) > String(r.quote_time))) {
          $("quoteTime").textContent = fmtQuoteTime(data.time);
        }
      } catch (e) { /* 静默 */ }
      scheduleQuotes();
    }, delay);
  }

  function applyQuotes(quotes) {
    const map = {};
    quotes.forEach((q) => { map[q.code] = q; });
    document.querySelectorAll("#resultBody tr").forEach((tr) => {
      const q = map[tr.dataset.code];
      if (!q) return;
      const oldPrice = parseFloat(tr.dataset.price || "0");
      const priceCell = tr.querySelector(".price");
      const pctCell = tr.querySelector(".pct");
      const vrCell = tr.querySelector(".vol-ratio");
      const toCell = tr.querySelector(".turnover");
      const amCell = tr.querySelector(".amount");

      priceCell.textContent = fmtPrice(q.price);
      pctCell.textContent = fmtPct(q.pct);
      pctCell.className = "pct " + pctClass(q.pct);
      if (vrCell) vrCell.textContent = fmtRatio(q.vol_ratio);
      if (toCell) toCell.textContent = fmtTurnover(q.turnover);
      if (amCell) amCell.textContent = fmtAmount(q.amount);

      if (oldPrice && q.price !== oldPrice) {
        priceCell.classList.remove("flash-up", "flash-down");
        void priceCell.offsetWidth;
        priceCell.classList.add(q.price > oldPrice ? "flash-up" : "flash-down");
      }
      tr.dataset.price = q.price;
      const item = state.result.items.find((i) => i.code === q.code);
      if (item) {
        item.price = q.price;
        item.pct = q.pct;
      }
    });
  }

  /* ---------- 写入通达信 ---------- */
  async function doWrite() {
    if (!state.canWrite) {
      toast("访客不能写入板块");
      return;
    }
    const r = state.result;
    if (!r || !r.items || !r.items.length) {
      showModal("无法写入", "还没有选股结果，请先选股。");
      return;
    }

    // 写入前刷新一次，避免拿到过期的「通达信是否运行」状态
    try {
      const st = await api("/api/state");
      if (st && st.tdx) state.tdx = st.tdx;
    } catch (e) { /* 忽略，交给服务端校验 */ }

    const wasRunning = !!(state.tdx && state.tdx.running);
    if (wasRunning) {
      const yes = await showModal(
        "写入前需要关闭通达信",
        "写入会先清空「" + ((r.strategy && r.strategy.block_name) || "该板块") +
        "」里的原有股票，再写入今天选出的 " + r.items.length + " 只。\n\n" +
        "通达信正在运行，必须先关闭，否则客户端会用内存里的旧名单覆盖文件。\n关闭并写入，完成后自动重启通达信？",
        "关闭并写入", true
      );
      if (!yes) { toast("已取消，未写入"); return; }
    }

    const btns = [$("btnWrite"), $("btnWriteSide")];
    btns.forEach((b) => { b.disabled = true; });
    $("btnWriteSide").textContent = "写入中…";

    try {
      const res = await api("/api/write", { method: "POST", body: { restart: wasRunning } });
      if (!res.ok) throw new Error(res.error || "写入失败");
      state.result.written = { name: res.name, count: res.count, at: res.at };
      renderBlock();
      toast("已清空原 " + (res.removed || 0) + " 只，写入 " + res.count + " 只");

      if (res.tdx_running) {
        showModal("还需要重启通达信",
          "文件已经写入，但通达信仍在运行，客户端不会加载新名单。\n请关闭通达信后重新打开，再查看「" + res.name + "」。",
          "知道了", false);
      } else if (wasRunning && res.restarted) {
        toast("通达信已重启，登录后查看「" + res.name + "」");
      }
    } catch (e) {
      showModal("写入失败", e.message);
    } finally {
      btns.forEach((b) => { b.disabled = false; });
      setWriteEnabled(state.canWrite);
      $("btnWriteSide").textContent = "写入板块";
    }
  }

  /* ---------- 导出 ---------- */
  function exportCsv() {
    const r = state.result;
    if (!r || !r.items || !r.items.length) return;
    const head = ["排名", "代码", "名称", "现价", "涨幅%", "量比", "换手%", "成交额(元)", "流通市值(亿)", "信号"];
    const lines = [head.join(",")];
    r.items.forEach((it) => {
      lines.push([
        it.rank, it.code, it.name, it.price, it.pct, it.vol_ratio,
        it.turnover, Math.round(it.amount), it.float_cap, (it.tags || []).join(" "),
      ].join(","));
    });
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "选股_" + (r.strategy.name || "策略") + "_" + (r.generated_at || "").slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 分享 ---------- */
  function openShare() {
    $("shareModal").hidden = false;
    $("shareRow").hidden = true;
    $("btnStopShare").hidden = true;
    $("shareText").textContent = "正在生成公网链接，请稍候…";
    startShare();
  }

  async function startShare() {
    try {
      const res = await api("/api/share", { method: "POST", body: { action: "start" } });
      if (res.share && res.share.url) {
        showShareUrl(res.share.url);
        return;
      }
      pollShare();
    } catch (e) {
      $("shareText").textContent = e.message;
    }
  }

  function pollShare() {
    clearTimeout(shareTimer);
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const res = await api("/api/share");
        const st = res.share || {};
        if (st.url) {
          showShareUrl(st.url);
          return;
        }
        if (st.error) {
          $("shareText").textContent = "分享失败：" + st.error;
          return;
        }
        if (tries > 20) {
          $("shareText").textContent = "生成超时，请关掉弹窗重试一次";
          return;
        }
        $("shareText").textContent = "正在生成公网链接…（约 5~15 秒）";
        shareTimer = setTimeout(tick, 1500);
      } catch (e) {
        $("shareText").textContent = e.message;
      }
    };
    tick();
  }

  function showShareUrl(url) {
    $("shareText").textContent = "朋友打开下面的链接即可使用（只读）：";
    $("shareRow").hidden = false;
    $("shareUrl").value = url;
    $("btnStopShare").hidden = false;
    $("btnShare").textContent = "分享中";
  }

  async function copyShare() {
    const url = $("shareUrl").value;
    try {
      await navigator.clipboard.writeText(url);
      toast("链接已复制");
    } catch (e) {
      $("shareUrl").select();
      document.execCommand("copy");
      toast("链接已复制");
    }
  }

  async function stopShare() {
    try {
      await api("/api/share", { method: "POST", body: { action: "stop" } });
    } catch (e) { /* ignore */ }
    $("shareModal").hidden = true;
    $("btnShare").textContent = "分享";
  }

  /* ---------- 设置 ---------- */
  function openDrawer() {
    const cfg = state.cfg || {};
    const f = cfg.filters || {};
    const sch = cfg.schedule || {};
    const sh = cfg.share || {};
    $("cfgTdxRoot").value = cfg.tdx_root || "";
    $("cfgPrefix").value = cfg.block_prefix || "智选";
    $("cfgTopN").value = cfg.top_n !== undefined ? cfg.top_n : 0;
    $("cfgSchedEnabled").checked = !!sch.enabled;
    $("cfgSchedTime").value = sch.time || "15:05";
    $("cfgAutoWrite").checked = !!sch.auto_write;
    $("cfgAllowRemoteScan").checked = sh.allow_remote_scan !== false;
    $("cfgExSt").checked = f.exclude_st !== false;
    $("cfgMinPrice").value = f.min_price !== undefined ? f.min_price : 2;
    $("cfgMaxPrice").value = f.max_price !== undefined ? f.max_price : 500;
    $("overlay").hidden = false;
    $("drawer").hidden = false;
    renderParamFields();
  }

  function closeDrawer() {
    $("overlay").hidden = true;
    $("drawer").hidden = true;
  }

  async function saveSettings(ev) {
    ev.preventDefault();
    const sp = Object.assign({}, (state.cfg && state.cfg.strategy_params) || {});
    sp[state.strategyKey] = collectParams();
    const payload = {
      tdx_root: $("cfgTdxRoot").value.trim(),
      strategy_params: sp,
      block_prefix: $("cfgPrefix").value.trim() || "智选",
      top_n: Math.max(0, parseInt($("cfgTopN").value, 10) || 0),
      filters: {
        exclude_st: $("cfgExSt").checked,
        min_price: parseFloat($("cfgMinPrice").value) || 0,
        max_price: parseFloat($("cfgMaxPrice").value) || 500,
      },
      schedule: {
        enabled: $("cfgSchedEnabled").checked,
        time: $("cfgSchedTime").value || "15:05",
        auto_write: $("cfgAutoWrite").checked,
      },
      share: {
        allow_remote_scan: $("cfgAllowRemoteScan").checked,
      },
    };
    try {
      const res = await api("/api/config", { method: "POST", body: payload });
      state.cfg = res.config;
      closeDrawer();
      toast("设置已保存");
      const s = await api("/api/state");
      state.tdx = s.tdx;
      state.strategy = s.strategy;
      state.strategyList = s.strategy_list || state.strategyList;
      renderBlock();
      $("schedTime").textContent = (res.config.schedule || {}).time || "15:05";
    } catch (e) {
      showModal("保存失败", e.message);
    }
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $("btnScan").addEventListener("click", startScan);
    $("btnWrite").addEventListener("click", doWrite);
    $("btnWriteSide").addEventListener("click", doWrite);
    $("btnExport").addEventListener("click", exportCsv);
    $("btnHistory").addEventListener("click", openHistory);
    $("btnSellScore").addEventListener("click", openSell);
    $("btnCheckin").addEventListener("click", openCheckin);
    $("btnCloseCheckin").addEventListener("click", closeCheckin);
    $("checkinModal").addEventListener("click", (e) => { if (e.target.id === "checkinModal") closeCheckin(); });
    $("calPrev").addEventListener("click", () => shiftCal(-1));
    $("calNext").addEventListener("click", () => shiftCal(1));
    $("btnSavePnl").addEventListener("click", savePnl);
    $("btnDelPnl").addEventListener("click", delPnl);
    $("btnTodayCheckin").addEventListener("click", checkinToday);
    $("calPnl").addEventListener("keydown", (e) => { if (e.key === "Enter") savePnl(); });
    $("btnCloseSell").addEventListener("click", closeSell);
    $("btnSellRun").addEventListener("click", runSell);
    $("sellCode").addEventListener("keydown", (e) => { if (e.key === "Enter") runSell(); });
    $("sellModal").addEventListener("click", (e) => { if (e.target.id === "sellModal") closeSell(); });
    $("btnCloseChart").addEventListener("click", closeChart);
    $("btnCloseHistory").addEventListener("click", closeHistoryModal);
    $("chartModal").addEventListener("click", (e) => { if (e.target.id === "chartModal") closeChart(); });
    $("historyModal").addEventListener("click", (e) => { if (e.target.id === "historyModal") closeHistoryModal(); });
    $("btnSettings").addEventListener("click", openDrawer);
    $("btnCloseDrawer").addEventListener("click", closeDrawer);
    $("overlay").addEventListener("click", closeDrawer);
    $("btnCancelSettings").addEventListener("click", closeDrawer);
    $("settingsForm").addEventListener("submit", saveSettings);
    $("modalOk").addEventListener("click", () => closeModal(true));
    $("modalCancel").addEventListener("click", () => closeModal(false));
    $("btnShare").addEventListener("click", openShare);
    $("btnCloseShare").addEventListener("click", () => { $("shareModal").hidden = true; });
    $("btnStopShare").addEventListener("click", stopShare);
    $("btnCopyShare").addEventListener("click", copyShare);
    document.querySelectorAll("#resultTable th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (state.sort.key === key) {
          state.sort.dir = -state.sort.dir;
        } else {
          state.sort.key = key;
          state.sort.dir = (key === "code" || key === "name") ? 1 : -1;
        }
        saveSort();
        renderTable();
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("checkinModal").hidden) closeCheckin();
        else if (!$("sellModal").hidden) closeSell();
        else if (!$("chartModal").hidden) closeChart();
        else if (!$("historyModal").hidden) closeHistoryModal();
        else if (!$("modal").hidden) closeModal(false);
        else if (!$("shareModal").hidden) $("shareModal").hidden = true;
        else closeDrawer();
      }
    });
  }

  /* ---------- K线图 ---------- */
  let chartInstance = null;

  function openChart(code) {
    $("chartModal").hidden = false;
    $("chartName").textContent = code;
    $("chartMeta").textContent = "加载中…";
    $("chartBox").innerHTML = "";
    api("/api/stock?code=" + encodeURIComponent(code)).then((data) => {
      if (!data.ok) throw new Error(data.error || "加载失败");
      const s = data.series;
      $("chartName").textContent = (data.name || "") + " " + code;
      $("chartMeta").textContent = "现价 " + fmtPrice(s.price) + "  " +
        (s.pct >= 0 ? "+" : "") + Number(s.pct || 0).toFixed(2) + "%";
      renderChart(s, state.strategyKey);
    }).catch((e) => {
      $("chartMeta").textContent = "";
      $("chartBox").innerHTML = '<div class="empty" style="padding:40px">' + esc(e.message) + "</div>";
    });
  }

  function renderChart(s, key) {
    if (!window.echarts) {
      $("chartBox").innerHTML = '<div class="empty" style="padding:40px">图表库加载失败</div>';
      return;
    }
    if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
    chartInstance = echarts.init($("chartBox"));
    const up = "#e5343f", down = "#0a9e6b";
    const names = { zhuanxing: "砖型图", bupiao: "补票四线", shaofu: "KDJ", fourtypes: "KDJ" };
    const indName = names[key] || "指标";
    $("chartMeta").textContent += " · 指标：" + indName;
    $("chartLegend").textContent = "K线 · 白线 · 黄线 · 成交量 · " + indName;

    const volData = s.volumes.map((v, i) => ({
      value: v,
      itemStyle: { color: (s.ohlc[i][1] >= s.ohlc[i][0]) ? up : down },
    }));
    const volMa5 = s.volumes.map((_, i) => {
      if (i < 4) return null;
      let sum = 0;
      for (let j = i - 4; j <= i; j++) sum += s.volumes[j];
      return sum / 5;
    });

    let indY = { scale: true, gridIndex: 2, splitLine: { lineStyle: { color: "#f7f9fc" } },
      axisLabel: { fontSize: 10, color: "#8a94a6" } };
    let indSeries = [];
    if (key === "zhuanxing") {
      const brick = s.brick.map((v, i) => ({
        value: v,
        itemStyle: { color: i > 0 && v < s.brick[i - 1] ? down : up },
      }));
      indSeries = [{ name: "砖型图", type: "bar", data: brick, xAxisIndex: 2, yAxisIndex: 2, barWidth: "60%" }];
    } else if (key === "bupiao") {
      indY = { min: 0, max: 100, gridIndex: 2, splitLine: { lineStyle: { color: "#f7f9fc" } },
        axisLabel: { fontSize: 10, color: "#8a94a6" } };
      const defs = [
        ["短期", s.bupiao.short, "#1b2436", 1.0],
        ["中期", s.bupiao.mid, "#d4a017", 1.0],
        ["中长期", s.bupiao.midlong, "#b05bd8", 1.0],
        ["长期", s.bupiao.long, "#e5343f", 1.8],
      ];
      indSeries = defs.map(([n, d, c, w], idx) => ({
        name: n, type: "line", data: d, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false,
        lineStyle: { width: w, color: c },
        markLine: idx === 3 ? {
          symbol: "none", silent: true,
          label: { formatter: "{c}", fontSize: 9, color: "#aab4c6" },
          lineStyle: { color: "#dfe5ef", type: "dashed", width: 1 },
          data: [{ yAxis: 75 }, { yAxis: 20 }],
        } : undefined,
      }));
    } else {
      indSeries = [
        { name: "K", type: "line", data: s.k, xAxisIndex: 2, yAxisIndex: 2,
          showSymbol: false, lineStyle: { width: 1, color: "#1b2436" } },
        { name: "D", type: "line", data: s.d, xAxisIndex: 2, yAxisIndex: 2,
          showSymbol: false, lineStyle: { width: 1, color: "#d4a017" } },
        { name: "J", type: "line", data: s.j, xAxisIndex: 2, yAxisIndex: 2,
          showSymbol: false, lineStyle: { width: 1.2, color: "#e5343f" },
          markLine: { symbol: "none", silent: true,
            label: { formatter: "{c}", fontSize: 9, color: "#aab4c6" },
            lineStyle: { color: "#dfe5ef", type: "dashed", width: 1 },
            data: [{ yAxis: 80 }, { yAxis: 20 }] } },
      ];
    }

    const option = {
      animation: false,
      backgroundColor: "#ffffff",
      tooltip: { trigger: "axis", axisPointer: { type: "cross" },
        backgroundColor: "rgba(27,36,54,.92)", borderWidth: 0,
        textStyle: { color: "#fff", fontSize: 12 } },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 62, right: 20, top: 12, height: "46%" },
        { left: 62, right: 20, top: "61%", height: "11%" },
        { left: 62, right: 20, top: "76%", height: "18%" },
      ],
      xAxis: [
        { type: "category", data: s.dates, gridIndex: 0, boundaryGap: true,
          axisLabel: { show: false }, axisTick: { show: false },
          axisLine: { lineStyle: { color: "#dde3ee" } } },
        { type: "category", data: s.dates, gridIndex: 1, boundaryGap: true,
          axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } },
        { type: "category", data: s.dates, gridIndex: 2, boundaryGap: true,
          axisLabel: { fontSize: 10, color: "#8a94a6" }, axisTick: { show: false },
          axisLine: { lineStyle: { color: "#dde3ee" } } },
      ],
      yAxis: [
        { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: "#f1f4f9" } },
          axisLabel: { fontSize: 11, color: "#8a94a6" } },
        { scale: true, gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } },
        indY,
      ],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1, 2], start: 55, end: 100 }],
      series: [
        { name: "K线", type: "candlestick", data: s.ohlc, xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: { color: up, color0: down, borderColor: up, borderColor0: down },
          markLine: { symbol: "none", silent: true, label: { show: false },
            lineStyle: { color: "#2f6bff", type: "dashed", width: 1 },
            data: [{ xAxis: s.selected }] } },
        { name: "白线", type: "line", data: s.white, xAxisIndex: 0, yAxisIndex: 0,
          showSymbol: false, lineStyle: { width: 1.2, color: "#1b2436" } },
        { name: "黄线", type: "line", data: s.yellow, xAxisIndex: 0, yAxisIndex: 0,
          showSymbol: false, connectNulls: false, lineStyle: { width: 1.6, color: "#d4a017" } },
        { name: "成交量", type: "bar", data: volData, xAxisIndex: 1, yAxisIndex: 1, barWidth: "55%" },
        { name: "量均5", type: "line", data: volMa5, xAxisIndex: 1, yAxisIndex: 1,
          showSymbol: false, lineStyle: { width: 1, color: "#f0a020" } },
        ...indSeries,
      ],
    };
    chartInstance.setOption(option);
    window.addEventListener("resize", resizeChart);
  }

  function resizeChart() {
    if (chartInstance) chartInstance.resize();
  }

  function closeChart() {
    $("chartModal").hidden = true;
    window.removeEventListener("resize", resizeChart);
    if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
  }

  /* ---------- 历史 ---------- */
  function openHistory() {
    $("historyModal").hidden = false;
    $("historyMeta").textContent = "";
    loadHistoryList();
  }

  function closeHistoryModal() {
    $("historyModal").hidden = true;
  }

  function loadHistoryList() {
    $("historyMeta").textContent = "";
    $("historyBody").innerHTML = '<div class="history-item">加载中…</div>';
    api("/api/history").then((d) => {
      const recs = d.records || [];
      if (!recs.length) {
        $("historyBody").innerHTML = '<div class="history-item">还没有历史记录，先选一次股。</div>';
        return;
      }
      $("historyBody").innerHTML = recs.map((r) =>
        '<div class="history-item" data-id="' + esc(r.id) + '">' +
        '<div><div class="h-date">' + fmtMarketDate(String(r.date)) + '</div>' +
        '<div class="h-sub">' + esc(r.strategy || "") + '</div></div>' +
        '<div class="h-sub">' + r.count + ' 只 · ' + (r.generated_at || "").slice(11, 16) + '</div>' +
        '</div>'
      ).join("");
      $("historyBody").querySelectorAll(".history-item").forEach((el) => {
        el.addEventListener("click", () => loadHistoryDetail(el.dataset.id));
      });
    }).catch((e) => { $("historyBody").textContent = e.message; });
  }

  function retCell(v) {
    if (v === null || v === undefined) return "--";
    const cls = v > 0 ? "ret-up" : (v < 0 ? "ret-down" : "");
    return '<span class="' + cls + '">' + (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%</span>";
  }

  function loadHistoryDetail(id) {
    $("historyBody").innerHTML = '<div class="history-item">加载中…</div>';
    api("/api/history?id=" + encodeURIComponent(id)).then((d) => {
      const rec = d.record || {};
      const items = d.items || [];
      const sum = d.summary || {};
      let html = '<button class="history-back" id="btnHistBack">← 返回列表</button>';
      html += '<div class="summary-chips">';
      [["r1", "1日"], ["r3", "3日"], ["r5", "5日"], ["r10", "10日"]].forEach(([k, label]) => {
        const s = sum[k] || {};
        if (s.avg === null || s.avg === undefined) {
          html += '<div class="summary-chip">' + label + '：--</div>';
        } else {
          const cls = s.avg > 0 ? "ret-up" : "ret-down";
          html += '<div class="summary-chip">' + label + '：<b class="' + cls + '">' +
            (s.avg > 0 ? "+" : "") + s.avg + '%</b> 胜率 ' + s.win + '%</div>';
        }
      });
      html += '</div>';
      html += '<table class="hist-table"><thead><tr><th>代码 / 名称</th><th>入选价</th><th>1日</th><th>3日</th><th>5日</th><th>10日</th></tr></thead><tbody>';
      items.forEach((it) => {
        html += '<tr><td><b>' + esc(it.name || "") + '</b> <span class="code">' + esc(it.code) + '</span></td>' +
          '<td>' + fmtPrice(it.price) + '</td>' +
          '<td>' + retCell(it.r1) + '</td><td>' + retCell(it.r3) + '</td>' +
          '<td>' + retCell(it.r5) + '</td><td>' + retCell(it.r10) + '</td></tr>';
      });
      html += '</tbody></table>';
      $("historyBody").innerHTML = html;
      $("historyMeta").textContent = fmtMarketDate(String(rec.date || "")) + " · " +
        ((rec.strategy && rec.strategy.name) || "") + " · " + (rec.count || 0) + " 只";
      $("btnHistBack").addEventListener("click", loadHistoryList);
    }).catch((e) => { $("historyBody").textContent = e.message; });
  }

  /* ---------- 战法参数 ---------- */
  const PARAM_LABELS = {
    j_max: "J 值上限", j_min: "J 值下限", pct_abs_max: "涨跌幅绝对值上限 (%)",
    max_distance: "距白/黄线上限 (%)", body_ratio: "红砖 / 绿砖 比例（0.667 = 2/3）",
    level: "75 位置线", deep: "下探深度", dip_min: "跌破最少天数", dip_max: "跌破最多天数",
    shrink_peak: "缩量 / 前高量 上限", shrink_ma5: "缩量 / 5日均量 上限",
    vol_expand_min: "前期放量倍数", near_line: "回踩距离上限 (%)",
    pct_max: "涨幅上限 (%)", pct_min_main: "主板跌幅下限 (%)",
    pct_min_growth: "双创跌幅下限 (%)", amp_max_main: "主板振幅上限 (%)",
    amp_max_growth: "双创振幅上限 (%)",
  };

  function currentMeta() {
    return (state.strategyList || []).find((s) => s.key === state.strategyKey) || null;
  }

  function renderParamFields() {
    const box = $("paramFields");
    if (!box) return;
    const meta = currentMeta();
    if (!meta || !meta.params) {
      box.innerHTML = '<div class="field-hint">暂无参数</div>';
      return;
    }
    box.innerHTML = Object.keys(meta.params).map((k) => {
      const raw = meta.params[k];
      const v = Number.isInteger(raw) ? raw : Number(raw.toFixed(4));
      const step = Number.isInteger(raw) ? "1" : "0.01";
      return '<div class="field"><label>' + esc(PARAM_LABELS[k] || k) + '</label>' +
        '<input type="number" step="' + step + '" data-param="' + esc(k) + '" value="' + v + '"></div>';
    }).join("");
  }

  function collectParams() {
    const out = {};
    const box = $("paramFields");
    if (!box) return out;
    box.querySelectorAll("input[data-param]").forEach((inp) => {
      const v = parseFloat(inp.value);
      if (!isNaN(v)) out[inp.dataset.param] = v;
    });
    return out;
  }

  /* ---------- 卖出评分 ---------- */
  let sellChartInstance = null;

  function openSell() {
    $("sellModal").hidden = false;
    $("sellResult").hidden = true;
    $("sellMeta").textContent = "";
    $("sellName").textContent = "卖出评分";
    $("sellChart").innerHTML = "";
    $("sellCode").focus();
  }

  function closeSell() {
    $("sellModal").hidden = true;
    if (sellChartInstance) { sellChartInstance.dispose(); sellChartInstance = null; }
  }

  function runSell() {
    const code = ($("sellCode").value || "").trim();
    if (!/^\d{6}$/.test(code)) { toast("请输入 6 位股票代码"); return; }
    $("sellMeta").textContent = "计算中…";
    api("/api/sell?code=" + encodeURIComponent(code)).then((d) => {
      if (!d.ok) throw new Error(d.error || "评分失败");
      renderSell(d);
    }).catch((e) => {
      $("sellMeta").textContent = "";
      showModal("评分失败", e.message);
    });
  }

  function renderSell(d) {
    const s = d.series;
    $("sellName").textContent = (d.name || "") + " " + d.code;
    $("sellMeta").textContent = "现价 " + fmtPrice(s.price) + " · " +
      (s.dates[s.dates.length - 1] || "");
    $("sellResult").hidden = false;
    const scoreEl = $("sellScore");
    scoreEl.textContent = d.score;
    scoreEl.className = "sell-score " + d.level;
    const v = $("sellVerdict");
    v.textContent = d.verdict;
    v.className = "sell-verdict " + d.level;

    const cats = d.categories || [];
    $("sellCats").innerHTML = cats.map((c) => {
      const on = c.score > 0;
      const body = on
        ? c.items.map((i) => esc(i.text)).join("<br>")
        : "未触发";
      return '<div class="sell-cat ' + (on ? "on" : "off") + '">' +
        '<div class="sell-cat-head"><span>' + esc(c.name) + "</span><b>" +
        (on ? "+" + c.score : "—") + "</b></div>" +
        '<div class="sell-cat-items">' + body + "</div></div>";
    }).join("");

    const mark = $("sellBandMark");
    if (mark) mark.style.left = Math.min(99, Math.max(1, d.score)) + "%";

    renderSellChart(s, d.markers || []);
  }

  function renderSellChart(s, markers) {
    if (!window.echarts) return;
    if (sellChartInstance) { sellChartInstance.dispose(); sellChartInstance = null; }
    sellChartInstance = echarts.init($("sellChart"));
    const up = "#e5343f", down = "#0a9e6b";
    const volData = s.volumes.map((v, i) => ({
      value: v,
      itemStyle: { color: (s.ohlc[i][1] >= s.ohlc[i][0]) ? up : down },
    }));
    const markData = markers.map((m) => ({
      value: [m.date, m.price],
      name: m.reason || m.type,
    }));
    const series = [
      { name: "K线", type: "candlestick", data: s.ohlc, xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: up, color0: down, borderColor: up, borderColor0: down } },
      { name: "白线", type: "line", data: s.white, xAxisIndex: 0, yAxisIndex: 0,
        showSymbol: false, lineStyle: { width: 1.2, color: "#1b2436" } },
      { name: "黄线", type: "line", data: s.yellow, xAxisIndex: 0, yAxisIndex: 0,
        showSymbol: false, connectNulls: false, lineStyle: { width: 1.6, color: "#d4a017" } },
      { name: "成交量", type: "bar", data: volData, xAxisIndex: 1, yAxisIndex: 1, barWidth: "55%" },
    ];
    if (markData.length) {
      series.push({
        name: "卖点", type: "scatter", data: markData, xAxisIndex: 0, yAxisIndex: 0,
        symbol: "pin", symbolSize: 38,
        itemStyle: { color: "#e5343f" },
        label: { show: true, formatter: "S", color: "#fff", fontSize: 11, fontWeight: "bold" },
        tooltip: { formatter: (p) => p.data.name },
      });
    }
    sellChartInstance.setOption({
      animation: false,
      backgroundColor: "#ffffff",
      tooltip: { trigger: "axis", axisPointer: { type: "cross" },
        backgroundColor: "rgba(27,36,54,.92)", borderWidth: 0,
        textStyle: { color: "#fff", fontSize: 12 } },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 62, right: 20, top: 12, height: "62%" },
        { left: 62, right: 20, top: "78%", height: "16%" },
      ],
      xAxis: [
        { type: "category", data: s.dates, gridIndex: 0, boundaryGap: true,
          axisLabel: { show: false }, axisTick: { show: false },
          axisLine: { lineStyle: { color: "#dde3ee" } } },
        { type: "category", data: s.dates, gridIndex: 1, boundaryGap: true,
          axisLabel: { fontSize: 10, color: "#8a94a6" }, axisTick: { show: false },
          axisLine: { lineStyle: { color: "#dde3ee" } } },
      ],
      yAxis: [
        { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: "#f1f4f9" } },
          axisLabel: { fontSize: 11, color: "#8a94a6" } },
        { scale: true, gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } },
      ],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1], start: 55, end: 100 }],
      series: series,
    });
    window.addEventListener("resize", resizeSellChart);
  }

  function resizeSellChart() {
    if (sellChartInstance) sellChartInstance.resize();
  }

  /* ---------- 交易语录 ---------- */
  const QUOTES = [
    "截断亏损，让利润奔跑。",
    "趋势是你的朋友。",
    "市场永远是对的，错的只有自己。",
    "会买的是徒弟，会卖的是师傅，会空仓的是祖师爷。",
    "宁可错过，不可做错。",
    "不要预测市场，要跟随市场。",
    "在别人贪婪时恐惧，在别人恐惧时贪婪。",
    "成交量是价格的影子。",
    "空仓也是一种操作。",
    "纪律比判断更重要。",
    "保住本金，永远是第一位的。",
    "不抄底，不逃顶，只做中间一段。",
    "频繁交易是散户最大的敌人。",
    "上涨看支撑，下跌看压力。",
    "风险来自你不知道自己在做什么。",
    "慢就是快，少即是多。",
  ];
  let quoteIdx = Math.floor(Math.random() * QUOTES.length);
  let quoteRotateTimer = null;

  function startQuotes() {
    const box = $("quoteLine");
    const text = $("quoteText");
    if (!box || !text) return;
    text.textContent = QUOTES[quoteIdx];
    if (quoteRotateTimer) clearInterval(quoteRotateTimer);
    quoteRotateTimer = setInterval(() => {
      box.classList.add("fade");
      setTimeout(() => {
        quoteIdx = (quoteIdx + 1) % QUOTES.length;
        text.textContent = QUOTES[quoteIdx];
        box.classList.remove("fade");
      }, 560);
    }, 60000);
  }

  /* ---------- 交易打卡 ---------- */
  const CHECKIN_KEY = "picker_checkin_v1";
  let calMonth = new Date();
  let calTrading = new Set();
  let calSelected = "";

  function checkinLoad() {
    try { return JSON.parse(localStorage.getItem(CHECKIN_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function checkinSave(data) {
    try { localStorage.setItem(CHECKIN_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function dkey(d) {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function fmtPnlShort(v) {
    const a = Math.abs(v);
    if (a >= 10000) return (v > 0 ? "+" : "-") + (a / 10000).toFixed(1) + "万";
    return (v > 0 ? "+" : "") + Math.round(v);
  }
  function isTradeDay(d) {
    const n = parseInt(dkey(d).replace(/-/g, ""), 10);
    if (calTrading.size) return calTrading.has(n);
    return d.getDay() !== 0 && d.getDay() !== 6;
  }

  function openCheckin() {
    $("checkinModal").hidden = false;
    const now = new Date();
    calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    calSelected = dkey(now);
    $("calPnl").value = "";
    loadCalendar();
  }
  function closeCheckin() { $("checkinModal").hidden = true; }

  async function loadCalendar() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth() + 1;
    const key = y + "-" + String(m).padStart(2, "0");
    $("calTitle").textContent = y + "年" + m + "月";
    try {
      const r = await api("/api/calendar?month=" + key);
      calTrading = new Set(r.days || []);
    } catch (e) { calTrading = new Set(); }
    renderCalendar();
    if (calSelected) selectCalDate(calSelected);
  }

  function renderCalendar() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const total = new Date(y, m + 1, 0).getDate();
    const data = checkinLoad();
    const todayKey = dkey(new Date());
    let html = "";
    for (let i = 0; i < offset; i++) html += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= total; d++) {
      const dt = new Date(y, m, d);
      const key = dkey(dt);
      const trade = isTradeDay(dt);
      const rec = data[key];
      const cls = ["cal-cell"];
      if (!trade) cls.push("weekend");
      if (key === todayKey) cls.push("today");
      if (key === calSelected) cls.push("selected");
      let inner = '<div class="d">' + d + "</div>";
      if (rec && rec.pnl != null) {
        inner += '<div class="p ' + (rec.pnl >= 0 ? "up" : "down") + '">' + fmtPnlShort(rec.pnl) + "</div>";
      }
      if (rec && rec.checked) inner += '<span class="ck"></span>';
      html += '<div class="' + cls.join(" ") + '" data-date="' + key + '">' + inner + "</div>";
    }
    $("calGrid").innerHTML = html;
    $("calGrid").querySelectorAll(".cal-cell[data-date]").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.classList.contains("weekend")) { toast("休市日不用打卡"); return; }
        selectCalDate(el.dataset.date);
      });
    });
    renderSummary();
  }

  function selectCalDate(key) {
    calSelected = key;
    const d = new Date(key + "T00:00:00");
    $("calDate").textContent = d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
    const rec = checkinLoad()[key] || {};
    $("calPnl").value = rec.pnl != null ? rec.pnl : "";
    renderCalendar();
  }

  function calcStreak(data) {
    const d = new Date();
    if (!(data[dkey(d)] && data[dkey(d)].checked)) d.setDate(d.getDate() - 1);
    let n = 0;
    for (let i = 0; i < 500; i++) {
      if (d.getDay() === 0 || d.getDay() === 6) { d.setDate(d.getDate() - 1); continue; }
      const r = data[dkey(d)];
      if (r && r.checked) { n++; d.setDate(d.getDate() - 1); } else break;
    }
    return n;
  }

  function renderSummary() {
    const data = checkinLoad();
    const prefix = calMonth.getFullYear() + "-" + String(calMonth.getMonth() + 1).padStart(2, "0");
    let sum = 0, wins = 0, losses = 0, recorded = 0;
    Object.keys(data).forEach((k) => {
      if (!k.startsWith(prefix)) return;
      const r = data[k] || {};
      if (r.checked) recorded++;
      if (typeof r.pnl === "number") {
        sum += r.pnl;
        if (r.pnl > 0) wins++; else if (r.pnl < 0) losses++;
      }
    });
    const total = Object.keys(data).filter((k) => data[k] && data[k].checked).length;
    const rate = wins + losses ? Math.round((wins * 100) / (wins + losses)) : 0;
    const sumCls = sum >= 0 ? "red" : "green";
    $("checkinSummary").innerHTML =
      '<div class="sum-chip ' + sumCls + '">本月盈亏 <b>' + (sum >= 0 ? "+" : "") + sum.toFixed(2) + "</b></div>" +
      '<div class="sum-chip">本月打卡 <b>' + recorded + "</b> 天</div>" +
      '<div class="sum-chip">胜率 <b>' + rate + "%</b></div>" +
      '<div class="sum-chip">连续打卡 <b>' + calcStreak(data) + "</b> 天</div>";
    $("checkinMeta").textContent = "累计打卡 " + total + " 天";
  }

  function savePnl() {
    if (!calSelected) { toast("先选个日期"); return; }
    const raw = $("calPnl").value.trim();
    const data = checkinLoad();
    if (raw === "") {
      data[calSelected] = { checked: true };
    } else {
      const v = parseFloat(raw);
      if (isNaN(v)) { toast("请输入数字"); return; }
      data[calSelected] = { checked: true, pnl: Math.round(v * 100) / 100 };
    }
    checkinSave(data);
    renderCalendar();
    toast("已保存");
  }

  function delPnl() {
    if (!calSelected) return;
    const data = checkinLoad();
    delete data[calSelected];
    checkinSave(data);
    $("calPnl").value = "";
    renderCalendar();
    toast("已删除");
  }

  function checkinToday() {
    const now = new Date();
    if (now.getDay() === 0 || now.getDay() === 6) { toast("今天休市，不用打卡"); return; }
    const key = dkey(now);
    if (calMonth.getFullYear() !== now.getFullYear() || calMonth.getMonth() !== now.getMonth()) {
      calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      calSelected = key;
      loadCalendar();
    } else {
      selectCalDate(key);
    }
    const data = checkinLoad();
    data[key] = Object.assign({ checked: true }, data[key] || {});
    checkinSave(data);
    renderCalendar();
    toast("今日已打卡");
  }

  function shiftCal(delta) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
    calSelected = "";
    loadCalendar();
  }

  /* ---------- 0AMV 活跃市值 ---------- */
  let amvChart = null;

  async function loadAmv() {
    try {
      const d = await api("/api/amv?days=120");
      if (!d.ok) {
        $("amvCard").hidden = false;
        $("amvSub").textContent = d.error || "暂无数据";
        return;
      }
      renderAmv(d);
    } catch (e) { /* 指标加载失败不影响选股 */ }
  }

  function renderAmv(d) {
    $("amvCard").hidden = false;
    $("amvValue").textContent = Number(d.value).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
    const chg = $("amvChg");
    chg.textContent = (d.chg >= 0 ? "+" : "") + Number(d.chg).toFixed(2) + "%";
    chg.className = "amv-chg " + (d.chg >= 0 ? "up" : "down");
    let sub = "更新 " + d.last_date + " · 日K + EMA12 · 滚轮缩放 · 沪深成交额 10 日平滑 ÷ 1e7（通达信指数日线）";
    if (d.stale_days > 1) sub += " · 数据滞后 " + d.stale_days + " 天";
    $("amvSub").textContent = sub;

    if (amvChart) { amvChart.dispose(); amvChart = null; }
    amvChart = echarts.init($("amvChart"));
    const rows = d.series || [];
    const dates = rows.map((x) => x.date);
    const values = rows.map((x) => x.value);
    const ohlc = rows.map((x) => [x.open, x.value, x.low, x.high]);
    const emas = rows.map((x) => x.ema);
    const chgMap = {};
    rows.forEach((x) => { chgMap[x.date] = x.chg; });

    let tactic = "ok";
    for (let i = 1; i < rows.length; i++) {
      const c = Number(rows[i].chg || 0);
      const p = Number(rows[i - 1].chg || 0);
      if (c <= -2.3) tactic = "cut";
      else if (c >= 4 || c + p >= 4) tactic = "ok";
    }
    const ruleEl = $("amvRuleStatus");
    if (ruleEl) {
      ruleEl.textContent = tactic === "cut" ? "少妇战法：逐步减仓" : "少妇战法：适用期";
      ruleEl.className = "amv-rule-status " + tactic;
    }
    const fmt = (v) => Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
    const rangeFor = (start, end) => {
      const n = values.length;
      const s = Math.max(0, Math.floor((n * start) / 100));
      const e = Math.min(n, Math.ceil((n * end) / 100));
      const seg = values.slice(s, Math.max(s + 1, e));
      const mn = Math.min(...seg);
      const mx = Math.max(...seg);
      const pad = (mx - mn) * 0.08 || mx * 0.005;
      return [mn - pad, mx + pad];
    };
    const initialStart = 40;
    const initRange = rangeFor(initialStart, 100);
    amvChart.setOption({
      animation: false,
      grid: { left: 8, right: 12, top: 10, bottom: 30, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(27,36,54,.92)", borderWidth: 0,
        textStyle: { color: "#fff", fontSize: 12 },
        formatter: (ps) => {
          const v = ps[0].data;
          const date = ps[0].axisValue;
          const chg = Number(chgMap[date] || 0);
          const color = chg >= 0 ? "#ff7a7a" : "#4ade80";
          return date + "<br/>开 " + fmt(v[0]) + "　收 " + fmt(v[1]) +
            "<br/>高 " + fmt(v[3]) + "　低 " + fmt(v[2]) +
            '<br/><span style="color:' + color + '">涨跌幅 ' +
            (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%</span>";
        },
      },
      xAxis: {
        type: "category", data: dates, boundaryGap: true,
        axisLabel: { fontSize: 10, color: "#9aa5b8", interval: Math.max(1, Math.floor(dates.length / 6)) },
        axisTick: { show: false }, axisLine: { lineStyle: { color: "#e3e9f3" } },
      },
      yAxis: {
        min: initRange[0], max: initRange[1],
        splitLine: { lineStyle: { color: "#f1f4f9" } },
        axisLabel: {
          fontSize: 10, color: "#9aa5b8",
          formatter: (v) => (v >= 10000 ? (v / 10000).toFixed(1) + "万" : v),
        },
      },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, start: initialStart, end: 100,
          zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false },
        { type: "slider", xAxisIndex: 0, start: initialStart, end: 100,
          height: 12, bottom: 2, borderColor: "transparent",
          backgroundColor: "#f1f5ff", fillerColor: "rgba(47,107,255,.15)",
          handleStyle: { color: "#2f6bff" }, textStyle: { fontSize: 9, color: "#9aa5b8" } },
      ],
      series: [{
        name: "0AMV", type: "candlestick", data: ohlc, barMaxWidth: 10,
        itemStyle: {
          color: "#e5343f", color0: "#0a9e6b",
          borderColor: "#e5343f", borderColor0: "#0a9e6b",
        },
      }, {
        name: "EMA12", type: "line", data: emas,
        showSymbol: false, smooth: true, z: 3,
        lineStyle: { width: 1.5, color: "#e6b800" },
      }],
    });
    amvChart.on("datazoom", () => {
      const dz = (amvChart.getOption().dataZoom || [])[0] || {};
      const r = rangeFor(Number(dz.start || 0), Number(dz.end || 100));
      amvChart.setOption({ yAxis: { min: r[0], max: r[1] } });
    });
  }

  window.addEventListener("resize", () => { if (amvChart) amvChart.resize(); });

  /* ---------- 启动 ---------- */
  async function init() {
    bind();
    startQuotes();
    updateMarketClock();
    setInterval(updateMarketClock, 15000);
    try {
      const s = await api("/api/state");
      state.cfg = s.config;
      state.tdx = s.tdx || {};
      state.strategy = s.strategy;
      state.remote = !!s.remote;
      state.canScan = s.can_scan !== false;
      state.canWrite = s.can_write !== false;
      state.boardsMeta = s.boards || {};
      state.boardStats = s.board_stats || {};
      state.strategyList = s.strategy_list || [];
      state.strategyKey = (s.strategy && s.strategy.key) ||
        (s.result && s.result.strategy && s.result.strategy.key) ||
        (s.config && s.config.strategy_key) || "zhuanxing";
      try {
        const qs = new URLSearchParams(location.search);
        const sk2 = qs.get("strategy");
        if (sk2 && state.strategyList.some((x) => x.key === sk2)) state.strategyKey = sk2;
      } catch (e) { /* ignore */ }
      state.scan = s.scan || { running: false };
      state.result = s.result || null;
      state.share = s.share || {};
      state.sort = loadSort();
      try {
        const params = new URLSearchParams(location.search);
        const sk = params.get("sort");
        if (sk) {
          state.sort.key = sk;
          state.sort.dir = params.get("dir") === "asc" ? 1 : -1;
        }
      } catch (e) { /* ignore */ }

      initBoards();
      applyMode();
      renderAll();
      if (state.share && state.share.running) $("btnShare").textContent = "分享中";
      if (location.hash === "#share" && !state.remote) openShare();
      try {
        const q = new URLSearchParams(location.search);
        if (q.get("chart")) setTimeout(() => openChart(q.get("chart")), 400);
        if (q.get("history")) {
          const hv = q.get("history");
          setTimeout(() => { openHistory(); if (hv !== "1") loadHistoryDetail(hv); }, 400);
        }
        if (q.get("sell")) {
          setTimeout(() => { openSell(); $("sellCode").value = q.get("sell"); runSell(); }, 400);
        }
        if (q.get("checkin")) setTimeout(openCheckin, 400);
      } catch (e) { /* ignore */ }
      if (location.hash === "#settings") openDrawer();
      if (location.hash === "#params") {
        openDrawer();
        setTimeout(() => {
          const el = $("paramFields");
          if (el) el.scrollIntoView({ block: "center" });
        }, 300);
      }

      if (state.scan.running) {
        setScanning(true);
        updateProgress(state.scan);
        pollScan();
      }
      scheduleQuotes();
      loadAmv();
    } catch (e) {
      showModal("无法连接选股服务", "请确认后台程序仍在运行。\n" + e.message);
    }
  }

  init();
})();

