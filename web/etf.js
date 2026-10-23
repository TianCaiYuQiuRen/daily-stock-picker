/* ETF 选股页 */
(function () {
  const $ = (id) => document.getElementById(id);
  const CATS = [
    ["all", "全部"],
    ["pure", "纯血"],
    ["mixed", "混血"],
    ["index", "股指"],
  ];
  const state = { category: "all", items: [], busy: false, data: null };

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function fmtAmt(v) {
    if (!v) return "--";
    if (v >= 1e8) return (v / 1e8).toFixed(2) + "亿";
    if (v >= 1e4) return (v / 1e4).toFixed(0) + "万";
    return String(Math.round(v));
  }
  function signed(v, digits) {
    const n = Number(v || 0);
    return (n > 0 ? "+" : "") + n.toFixed(digits);
  }

  function renderCats() {
    $("etfCats").innerHTML = CATS.map(([k, label]) =>
      '<button class="strategy-chip' + (state.category === k ? " active" : "") +
      '" data-cat="' + k + '">' + label + "</button>"
    ).join("");
    $("etfCats").querySelectorAll("button[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.busy) return;
        state.category = btn.dataset.cat;
        renderCats();
        scan();
      });
    });
  }

  function render() {
    const d = state.data || {};
    $("etfTotal").textContent = d.total == null ? "--" : d.total;
    $("etfMatched").textContent = d.matched == null ? "--" : d.matched;
    $("etfTime").textContent = d.elapsed == null ? "--" : d.elapsed + "s";
    if (d.market_date) {
      const s = String(d.market_date);
      $("etfMeta").textContent = "周线数据 " + s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) +
        " · 更新 " + (d.generated_at || "").slice(11, 16) + " · 按名称/跟踪指数归类 · 悬停看周K / 右键切日K";
    }

    const items = state.items || [];
    if (!items.length) {
      $("etfBody").innerHTML = '<tr><td colspan="10" class="etf-empty">没有符合条件的 ETF</td></tr>';
      return;
    }
    $("etfBody").innerHTML = items.map((it, i) => {
      const up = Number(it.pct) >= 0;
      const wup = Number(it.weekly_pct) >= 0;
      return '<tr data-code="' + esc(it.code) + '" data-name="' + esc(it.name) + '">' +
        '<td class="rank">' + (i + 1) + "</td>" +
        '<td class="code">' + esc(it.code) + "</td>" +
        '<td class="name">' + esc(it.name) + "</td>" +
        '<td class="num price">' + Number(it.price || 0).toFixed(3) + "</td>" +
        '<td class="num"><span class="pct ' + (up ? "up" : "down") + '">' +
        signed(it.pct, 2) + "%</span></td>" +
        '<td class="num ' + (wup ? "up" : "down") + '">' + signed(it.weekly_pct, 2) + "%</td>" +
        '<td class="num">' + Number(it.j || 0).toFixed(2) + "</td>" +
        '<td><span class="etf-kind ' + it.kind + '">' + esc(it.kind_label) + "</span></td>" +
        '<td class="etf-sector">' + esc((it.sectors || []).join(" + ") || "-") + "</td>" +
        '<td class="num">' + fmtAmt(it.amount) + "</td>" +
        "</tr>";
    }).join("");
    bindRows();
  }

  /* ---------- 悬停 K 线 ---------- */
  let chartInst = null;
  let chartCode = "";
  let chartName = "";
  let chartPeriod = "week";
  let hoverTimer = null;
  const chartCache = new Map();

  function bindRows() {
    $("etfBody").querySelectorAll("tr[data-code]").forEach((tr) => {
      tr.addEventListener("mouseenter", () => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => openEtfChart(tr.dataset.code, tr.dataset.name, "week"), 120);
      });
      tr.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const next = (chartCode === tr.dataset.code && chartPeriod === "week") ? "day" : "week";
        openEtfChart(tr.dataset.code, tr.dataset.name, next, true);
      });
    });
  }

  async function openEtfChart(code, name, period, force) {
    if (!code) return;
    $("etfChartPanel").hidden = false;
    $("etfChartName").textContent = (name || "") + " " + code;
    $("etfChartPeriod").textContent = period === "day" ? "日K" : "周K";

    if (!force && chartInst && chartCode === code && chartPeriod === period) return;
    chartCode = code;
    chartName = name || "";
    chartPeriod = period;
    const key = code + ":" + period;
    const cached = chartCache.get(key);
    if (cached) { renderEtfChart(cached); return; }

    $("etfChartMeta").textContent = "加载中…";
    try {
      const res = await fetch("/api/etf/chart?code=" + encodeURIComponent(code) + "&period=" + period);
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "加载失败");
      chartCache.set(key, d);
      if (chartCode === code && chartPeriod === period) renderEtfChart(d);
    } catch (e) {
      $("etfChartMeta").textContent = e.message;
    }
  }

  function renderEtfChart(d) {
    const s = d.series;
    $("etfChartName").textContent = (d.name || "") + " " + d.code;
    $("etfChartPeriod").textContent = d.period === "day" ? "日K" : "周K";
    $("etfChartMeta").textContent = (d.period === "day" ? "日K" : "周K") + " · " +
      (s.dates[s.dates.length - 1] || "");

    if (chartInst) { chartInst.dispose(); chartInst = null; }
    chartInst = echarts.init($("etfChartBox"));
    const up = "#e5343f", down = "#0a9e6b";
    const volData = s.volumes.map((v, i) => ({
      value: v,
      itemStyle: { color: s.ohlc[i][1] >= s.ohlc[i][0] ? up : down },
    }));
    chartInst.setOption({
      animation: false,
      backgroundColor: "#fff",
      tooltip: {
        trigger: "axis", axisPointer: { type: "cross" },
        backgroundColor: "rgba(27,36,54,.92)", borderWidth: 0,
        textStyle: { color: "#fff", fontSize: 11 },
        formatter: (ps) => {
          const date = ps[0].axisValue;
          const map = {};
          ps.forEach((p) => { map[p.seriesName] = p.data; });
          const out = [date];
          const candle = map["K线"];
          const idx = ps[0].dataIndex;
          const row = (s.ohlc || [])[idx];
          if (row) {
            out.push("开 " + Number(row[0]).toFixed(3) + "　收 " + Number(row[1]).toFixed(3));
            out.push("高 " + Number(row[3]).toFixed(3) + "　低 " + Number(row[2]).toFixed(3));
            const closes = s.ohlc.map((x) => x[1]);
            const close = closes[idx];
            const prev = idx > 0 ? closes[idx - 1] : close;
            const barRet = prev ? (close / prev - 1) * 100 : 0;
            let startPct = 0;
            try { startPct = Number((chartInst.getOption().dataZoom || [])[0].start) || 0; } catch (e) { /* ignore */ }
            const si = Math.max(0, Math.min(closes.length - 1, Math.floor(closes.length * startPct / 100)));
            const base = closes[si] || close;
            const rangeRet = base ? (close / base - 1) * 100 : 0;
            const pct = (v) => (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
            out.push("收益率 " + pct(barRet) + "　可见区间 " + pct(rangeRet));
          }
          ["白线", "黄线", "K", "D", "J"].forEach((n) => {
            if (map[n] != null) out.push(n + " " + Number(map[n]).toFixed(2));
          });
          const volRaw = map["成交量"];
          const vol = volRaw && typeof volRaw === "object" ? volRaw.value : volRaw;
          if (vol != null) out.push("成交量 " + fmtAmt(vol));
          return out.join("<br/>");
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 54, right: 14, top: 8, height: "48%" },
        { left: 54, right: 14, top: "61%", height: "10%" },
        { left: 54, right: 14, top: "74%", height: "18%" },
      ],
      xAxis: [
        { type: "category", data: s.dates, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: "#dde3ee" } } },
        { type: "category", data: s.dates, gridIndex: 1, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { show: false } },
        { type: "category", data: s.dates, gridIndex: 2, axisLabel: { fontSize: 9, color: "#8a94a6" }, axisTick: { show: false }, axisLine: { lineStyle: { color: "#dde3ee" } } },
      ],
      yAxis: [
        { scale: true, gridIndex: 0, splitLine: { lineStyle: { color: "#f1f4f9" } }, axisLabel: { fontSize: 10, color: "#8a94a6" } },
        { scale: true, gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } },
        { scale: true, gridIndex: 2, splitLine: { lineStyle: { color: "#f7f9fc" } }, axisLabel: { fontSize: 9, color: "#8a94a6" } },
      ],
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1, 2], start: 50, end: 100 }],
      series: [
        { name: "K线", type: "candlestick", data: s.ohlc, xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: { color: up, color0: down, borderColor: up, borderColor0: down } },
        { name: "白线", type: "line", data: s.white, xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, lineStyle: { width: 1.2, color: "#1b2436" } },
        { name: "黄线", type: "line", data: s.yellow, xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 1.4, color: "#d4a017" } },
        { name: "成交量", type: "bar", data: volData, xAxisIndex: 1, yAxisIndex: 1, barWidth: "55%" },
        { name: "K", type: "line", data: s.k, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: "#1b2436" } },
        { name: "D", type: "line", data: s.d, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: "#d4a017" } },
        { name: "J", type: "line", data: s.j, xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: "#e5343f" } },
      ],
    });
  }

  async function scan(force) {
    if (state.busy) return;
    state.busy = true;
    $("btnEtfScan").disabled = true;
    $("btnEtfScan").textContent = "筛选中…";
    $("etfBody").innerHTML = '<tr><td colspan="10" class="etf-empty">正在筛选，约需 10 秒…</td></tr>';
    try {
      const url = "/api/etf/scan?category=" + encodeURIComponent(state.category) +
        (force ? "&refresh=1" : "");
      const res = await fetch(url);
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "筛选失败");
      state.data = d;
      state.items = d.items || [];
      render();
    } catch (e) {
      $("etfBody").innerHTML = '<tr><td colspan="10" class="etf-empty">' + esc(e.message) + "</td></tr>";
      $("etfMeta").textContent = "筛选失败";
    } finally {
      state.busy = false;
      $("btnEtfScan").disabled = false;
      $("btnEtfScan").textContent = "重新筛选";
    }
  }

  renderCats();
  $("btnEtfScan").addEventListener("click", () => scan(true));
  $("etfChartClose").addEventListener("click", () => { $("etfChartPanel").hidden = true; });
  $("etfChartPanel").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!chartCode) return;
    const next = chartPeriod === "week" ? "day" : "week";
    openEtfChart(chartCode, chartName, next, true);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("etfChartPanel").hidden = true;
  });
  window.addEventListener("resize", () => { if (chartInst) chartInst.resize(); });

  const qs = new URLSearchParams(location.search);
  if (qs.get("chart")) {
    setTimeout(() => openEtfChart(qs.get("chart"), "", qs.get("period") || "week", true), 600);
  }
  scan(false);
})();

