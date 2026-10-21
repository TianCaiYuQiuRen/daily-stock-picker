/* =====================================================================
   K线训练营 · 训练场 / 数据统计
   ===================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const INITIAL_CAPITAL = 1000000;
  const STATS_KEY = "kline_camp_stats_v1";
  const IND_KEY = "kline_camp_indicator_v1";
  const SIZE_KEY = "kline_camp_size_v1";
  const UP = "#ef4444";
  const DOWN = "#0aa678";
  const MA_COLORS = ["#ffd166", "#ff8fab", "#9d8cff", "#5ad1c8"];
  const DEFAULT_INDICATOR = {
    ma: false,
    maPeriods: [5, 10, 20, 60],
    yw: true,
    ema: [10, 10],
    yellowPeriods: [14, 28, 57, 114],
    sub: "brick",
    brick: { range: 4, smooth1: 4, smooth2: 6, smooth3: 6, threshold: 4 },
    kdj: { n: 9, m1: 3, m2: 3, over: 80, under: 20 },
    bupiao: { short: 3, mid: 10, midlong: 20, long: 21, level: 75 },
  };
  const PERIOD_LABEL = {
    "1m": "1分钟", "5m": "5分钟", "15m": "15分钟", "30m": "30分钟", "60m": "60分钟",
    day: "日线", week: "周线", month: "月线",
  };
  const PERIOD_ORDER = ["1m", "5m", "15m", "30m", "60m", "day", "week", "month"];

  const state = {
    view: "train",
    period: "day",
    initial: 60,
    session: null,
    visible: 0,
    ind: null,
    indicator: loadIndicator(),
    labelsReal: null,
    autoTimer: null,
    speed: 420,
    side: "buy",
    frac: loadFraction(),
    cash: INITIAL_CAPITAL,
    shares: 0,
    avgCost: 0,
    trades: [],
    equity: INITIAL_CAPITAL,
    equityCurve: [INITIAL_CAPITAL],
    peak: INITIAL_CAPITAL,
    maxDD: 0,
    finished: false,
    revealed: false,
    recorded: false,
    loading: false,
    trainChart: null,
    statsChart: null,
    tickEls: [],
    stats: loadStats(),
    patterns: [],
    periods: [],
    patternFilter: "all",
    patternSearch: "",
  };

  /* ---------------------------------------------------------------
     基础工具
  --------------------------------------------------------------- */
  function fmtMoney(v, digits) {
    const n = Number(v || 0);
    return "¥" + n.toLocaleString("zh-CN", {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0,
    });
  }
  function fmtNum(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "--";
    return Number(v).toLocaleString("zh-CN", {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0,
    });
  }
  function fmtPct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "--";
    const n = Number(v);
    return (n > 0 ? "+" : "") + n.toFixed(digits === undefined ? 2 : digits) + "%";
  }
  function fmtVol(v) {
    const n = Number(v || 0);
    if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
    if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
    return Math.round(n).toString();
  }
  function pctClass(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  function toast(text, ms) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms || 2800);
  }

  async function api(path, opts) {
    const init = Object.assign({ headers: {} }, opts || {});
    if (init.body && typeof init.body !== "string") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(init.body);
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    init.signal = ctl.signal;
    try {
      const resp = await fetch(path, init);
      let data = {};
      try { data = await resp.json(); } catch (e) { data = {}; }
      if (!resp.ok) {
        const err = new Error(data.error || ("请求失败（" + resp.status + "）"));
        err.data = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function defaultStats() {
    return { version: 1, sessions: [], quiz: { total: 0, correct: 0, streak: 0, best: 0 } };
  }
  function loadStats() {
    try {
      const raw = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
      if (!raw || typeof raw !== "object") return defaultStats();
      const out = Object.assign(defaultStats(), raw);
      if (!Array.isArray(out.sessions)) out.sessions = [];
      out.quiz = Object.assign(defaultStats().quiz, out.quiz || {});
      return out;
    } catch (e) {
      return defaultStats();
    }
  }
  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(state.stats)); } catch (e) { /* ignore */ }
  }

  function cloneIndicator(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }
  function loadIndicator() {
    const out = cloneIndicator(DEFAULT_INDICATOR);
    try {
      const saved = JSON.parse(localStorage.getItem(IND_KEY) || "null");
      if (saved && typeof saved === "object") {
        out.ma = !!saved.ma;
        out.yw = !!saved.yw;
        out.sub = ["none", "brick", "kdj", "bupiao"].includes(saved.sub) ? saved.sub : out.sub;
        if (Array.isArray(saved.maPeriods)) {
          out.maPeriods = out.maPeriods.map((v, i) => clampNum(saved.maPeriods[i], 2, 250, v));
        }
        if (Array.isArray(saved.ema)) {
          out.ema = out.ema.map((v, i) => clampNum(saved.ema[i], 2, 80, v));
        }
        if (Array.isArray(saved.yellowPeriods)) {
          out.yellowPeriods = out.yellowPeriods.map((v, i) => clampNum(saved.yellowPeriods[i], 2, 250, v));
        }
        ["brick", "kdj", "bupiao"].forEach((k) => {
          if (saved[k] && typeof saved[k] === "object") {
            Object.keys(out[k]).forEach((f) => {
              const c = out[k][f];
              const min = f === "threshold" || f === "level" ? 0 : f === "over" ? 50 : f === "under" ? 0 : 1;
              const max = f === "threshold" ? 100 : f === "level" ? 100 : 250;
              out[k][f] = clampNum(saved[k][f], min, max, c);
            });
          }
        });
        // 主图参数必须是整数
        out.maPeriods = out.maPeriods.map((v) => Math.round(v));
        out.ema = out.ema.map((v) => Math.round(v));
        out.yellowPeriods = out.yellowPeriods.map((v) => Math.round(v));
        Object.keys(out.brick).forEach((k) => { out.brick[k] = k === "threshold" ? Number(out.brick[k]) : Math.round(out.brick[k]); });
        Object.keys(out.kdj).forEach((k) => { out.kdj[k] = Number(out.kdj[k]); });
        Object.keys(out.bupiao).forEach((k) => { out.bupiao[k] = Math.round(Number(out.bupiao[k])); });
      }
    } catch (e) { /* ignore */ }
    return out;
  }
  function saveIndicator() {
    try { localStorage.setItem(IND_KEY, JSON.stringify(state.indicator)); } catch (e) { /* ignore */ }
  }
  function loadFraction() {
    try {
      const n = Number(localStorage.getItem(SIZE_KEY));
      if (isFinite(n) && n >= 0.05 && n <= 1) return n;
    } catch (e) { /* ignore */ }
    return 0.5;
  }
  function saveFraction() {
    try { localStorage.setItem(SIZE_KEY, String(state.frac)); } catch (e) { /* ignore */ }
  }
  function refreshHero() {
    const sessions = state.stats.sessions || [];
    const today = new Date().toDateString();
    const todayCount = sessions.filter((s) => new Date(s.ts).toDateString() === today).length;
    const trades = sessions.reduce((a, s) => a + (s.trades || 0), 0);
    const wins = sessions.reduce((a, s) => a + (s.wins || 0), 0);
    $("heroToday").textContent = todayCount;
    $("heroSessions").textContent = sessions.length;
    $("heroWinRate").textContent = trades ? (wins / trades * 100).toFixed(1) + "%" : "--";
  }

  /* ---------------------------------------------------------------
     导航
  --------------------------------------------------------------- */
  function switchView(view, updateHash) {
    if (!["train", "stats", "pattern"].includes(view)) view = "train";
    state.view = view;
    ["train", "stats", "pattern"].forEach((v) => {
      $("view-" + v).hidden = v !== view;
      const btn = document.querySelector('#mainNav button[data-view="' + v + '"]');
      if (btn) btn.classList.toggle("active", v === view);
    });
    if (view === "stats") renderStats();
    if (view === "pattern") {
      if (window.KPattern) window.KPattern.activate();
    }
    if (view !== "train") closeIndicatorPanel();
    if (updateHash !== false) {
      const hash = view === "train" ? "" : "#" + view;
      if (location.hash !== hash) history.replaceState(null, "", location.pathname + hash);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => { if (state.trainChart) state.trainChart.resize(); }, 60);
  }

  /* ---------------------------------------------------------------
     指标计算（与 core/indicators.py / chart_series.py 同公式）
  --------------------------------------------------------------- */
  function maSeries(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  function emaSeries(values, n) {
    if (!values.length) return [];
    const k = 2 / (n + 1);
    const out = [Number(values[0])];
    for (let i = 1; i < values.length; i++) {
      out.push(out[out.length - 1] + k * (values[i] - out[out.length - 1]));
    }
    return out;
  }
  function smaTdx(values, n, m) {
    const out = [];
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (prev === null) prev = Number(values[i]);
      else prev = (m * values[i] + (n - m) * prev) / n;
      out.push(prev);
    }
    return out;
  }
  function rollingMax(values, n) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      let v = values[i];
      for (let j = Math.max(0, i - n + 1); j <= i; j++) if (values[j] > v) v = values[j];
      out.push(v);
    }
    return out;
  }
  function rollingMin(values, n) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      let v = values[i];
      for (let j = Math.max(0, i - n + 1); j <= i; j++) if (values[j] < v) v = values[j];
      out.push(v);
    }
    return out;
  }
  function divSafe(a, b) { return b ? a / b : 0; }

  function computeIndicatorSeries(lead, bars) {
    const all = lead.concat(bars);
    const closes = all.map((b) => b.c);
    const highs = all.map((b) => b.h);
    const lows = all.map((b) => b.l);
    const vols = all.map((b) => b.v || 0);
    const P = state.indicator;
    const out = {
      offset: lead.length,
      ma: [],
      white: null,
      yellow: null,
      brick: null,
      k: null, d: null, j: null,
      bupiao: null,
      vma5: maSeries(vols, 5),
    };

    if (P.ma) {
      out.ma = P.maPeriods.map((n) => maSeries(closes, n));
    }
    if (P.yw) {
      out.white = emaSeries(emaSeries(closes, P.ema[0]), P.ema[1]);
      const mas = P.yellowPeriods.map((n) => maSeries(closes, n));
      out.yellow = mas[0].map((_, i) => {
        if (mas.some((a) => a[i] === null)) return null;
        return mas.reduce((s, a) => s + a[i], 0) / mas.length;
      });
    }

    if (P.sub === "brick") {
      const p = P.brick;
      const hh = rollingMax(highs, p.range);
      const ll = rollingMin(lows, p.range);
      const var1 = [];
      const var3 = [];
      for (let i = 0; i < closes.length; i++) {
        var1.push(divSafe(hh[i] - closes[i], hh[i] - ll[i]) * 100 - 90);
        var3.push(divSafe(closes[i] - ll[i], hh[i] - ll[i]) * 100);
      }
      const var2 = smaTdx(var1, p.smooth1, 1).map((v) => v + 100);
      const var4 = smaTdx(var3, p.smooth2, 1);
      const var5 = smaTdx(var4, p.smooth3, 1).map((v) => v + 100);
      out.brick = var5.map((v, i) => (v - var2[i]) > p.threshold ? (v - var2[i]) - p.threshold : 0);
    } else if (P.sub === "kdj") {
      const p = P.kdj;
      const hh = rollingMax(highs, p.n);
      const ll = rollingMin(lows, p.n);
      const rsv = [];
      let prev = 50;
      for (let i = 0; i < closes.length; i++) {
        if (hh[i] === ll[i]) rsv.push(prev);
        else { prev = divSafe(closes[i] - ll[i], hh[i] - ll[i]) * 100; rsv.push(prev); }
      }
      out.k = smaTdx(rsv, p.m1, 1);
      out.d = smaTdx(out.k, p.m2, 1);
      out.j = out.k.map((v, i) => 3 * v - 2 * out.d[i]);
    } else if (P.sub === "bupiao") {
      const p = P.bupiao;
      const line = (n) => {
        const hh = rollingMax(closes, n);
        const ll = rollingMin(lows, n);
        return closes.map((c, i) => divSafe(c - ll[i], hh[i] - ll[i]) * 100);
      };
      out.bupiao = {
        short: line(p.short),
        mid: line(p.mid),
        midlong: line(p.midlong),
        long: line(p.long),
      };
    }
    return out;
  }

  function recomputeIndicators() {
    if (!state.session) { state.ind = null; return null; }
    state.ind = computeIndicatorSeries(state.session.lead || [], state.session.bars.slice(0, state.visible));
    return state.ind;
  }

  function valueAt(arr, i) {
    if (!arr || i < 0 || i >= arr.length) return null;
    const v = arr[i];
    return v === null || v === undefined || !isFinite(v) ? null : v;
  }
  function indValue(arr) {
    return valueAt(arr, state.ind ? state.ind.offset + state.visible - 1 : -1);
  }
  function fmtInd(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "--";
    return Number(v).toFixed(digits === undefined ? 2 : digits);
  }

  /* ---------------------------------------------------------------
     训练图
  --------------------------------------------------------------- */
  function initTrainChart() {
    if (!state.trainChart) {
      state.trainChart = echarts.init($("trainChart"), null, { renderer: "canvas" });
    }
  }

  function axisLabel(value) {
    value = String(value);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) return value.slice(5, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5);
    return value;
  }

  function trainOption() {
    const s = state.session;
    const n = state.visible;
    const leadLen = s.lead.length;
    const bars = s.bars.slice(0, n);
    const labels = state.labelsReal
      ? state.labelsReal.slice(0, n)
      : bars.map((_, i) => String(i + 1));
    const off = leadLen;
    const end = off + n;
    const slice = (arr) => (arr ? arr.slice(off, end) : []);
    const ind = state.indicator;
    const hasSub = ind.sub !== "none" && !!state.ind;
    const last = bars[bars.length - 1];
    const candle = bars.map((b) => [b.o, b.c, b.l, b.h]);
    const vol = bars.map((b) => ({
      value: b.v,
      itemStyle: { color: b.c >= b.o ? "rgba(239,68,68,.55)" : "rgba(10,166,120,.55)" },
    }));
    const markers = state.trades.filter((t) => t.bar <= n).map((t) => ({
      name: t.side,
      coord: [t.bar - 1, t.price],
      value: t.side === "buy" ? "B" : "S",
      itemStyle: { color: t.side === "buy" ? UP : DOWN, borderColor: "#fff", borderWidth: 1 },
      label: { show: true, formatter: t.side === "buy" ? "B" : "S", color: "#fff", fontSize: 9, fontWeight: 700 },
    }));
    const axisColor = "#6f7f9b";
    const grids = hasSub ? [
      { left: 16, right: 62, top: 18, height: "48%" },
      { left: 16, right: 62, top: "69%", height: "8%" },
      { left: 16, right: 62, top: "80%", height: "15%" },
    ] : [
      { left: 16, right: 62, top: 18, height: "63%" },
      { left: 16, right: 62, top: "83%", height: "10%" },
    ];
    function catAxis(gridIndex, showLabels) {
      return {
        type: "category", data: labels, boundaryGap: true, gridIndex: gridIndex,
        axisLine: { lineStyle: { color: "rgba(130,150,185,.2)" } },
        axisTick: { show: false },
        axisLabel: {
          show: showLabels, color: axisColor, fontSize: 9, margin: 8,
          interval: Math.max(0, Math.ceil(n / 7) - 1),
          formatter: axisLabel,
        },
        splitLine: { show: false },
        axisPointer: { label: { show: showLabels } },
      };
    }
    const xAxes = [catAxis(0, false), catAxis(1, !hasSub)];
    if (hasSub) xAxes.push(catAxis(2, true));
    const yAxes = [
      {
        scale: true, position: "right", gridIndex: 0,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: {
          color: axisColor, fontSize: 9, margin: 8,
          formatter: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(v < 10 ? 2 : 1)),
        },
        splitLine: { lineStyle: { color: "rgba(130,150,185,.10)", type: "dashed" } },
      },
      {
        scale: true, gridIndex: 1, position: "right",
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
        splitLine: { show: false },
      },
    ];
    if (hasSub) {
      yAxes.push({
        scale: true, gridIndex: 2, position: "right",
        min: ind.sub === "bupiao" ? 0 : undefined,
        max: ind.sub === "bupiao" ? 100 : undefined,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 8, margin: 7, formatter: (v) => Math.round(v) },
        splitLine: { lineStyle: { color: "rgba(130,150,185,.08)", type: "dashed" } },
      });
    }

    const series = [{
      name: "K线", type: "candlestick", data: candle,
      itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN, borderWidth: 1 },
      markPoint: {
        symbol: "circle", symbolSize: 18, data: markers,
        label: { show: true, color: "#fff", fontSize: 9, fontWeight: 700 },
      },
      markLine: {
        silent: true, symbol: "none",
        data: last ? [{
          yAxis: last.c,
          lineStyle: { color: "rgba(141,167,220,.5)", type: "dashed", width: 1 },
          label: {
            show: true, position: "end", color: "#9fb4dc", fontSize: 9,
            formatter: last.c.toFixed(2), backgroundColor: "rgba(20,31,52,.9)", padding: [2, 4], borderRadius: 3,
          },
        }] : [],
      },
    }];

    if (ind.ma) {
      ind.maPeriods.forEach((p, i) => {
        series.push({
          name: "MA" + p, type: "line", data: slice(state.ind.ma[i]), smooth: false, symbol: "none",
          lineStyle: { width: 1, color: MA_COLORS[i], opacity: .9 }, itemStyle: { color: MA_COLORS[i] },
        });
      });
    }
    if (ind.yw) {
      if (state.ind.white) {
        series.push({ name: "白线", type: "line", data: slice(state.ind.white), symbol: "none",
          lineStyle: { width: 1.15, color: "#f5f8ff", opacity: .9 }, itemStyle: { color: "#f5f8ff" } });
      }
      if (state.ind.yellow) {
        series.push({ name: "黄线", type: "line", data: slice(state.ind.yellow), symbol: "none",
          lineStyle: { width: 1.15, color: "#ffd166", opacity: .95 }, itemStyle: { color: "#ffd166" } });
      }
    }
    series.push({
      name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vol,
      barWidth: "55%", itemStyle: { borderRadius: [1, 1, 0, 0] },
    });
    series.push({
      name: "量均5", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: slice(state.ind.vma5),
      symbol: "none", lineStyle: { width: 1, color: "rgba(160,185,230,.55)" }, itemStyle: { color: "#a0b9e6" },
    });

    if (hasSub && ind.sub === "brick") {
      const full = state.ind.brick || [];
      const data = [];
      for (let i = off; i < end; i++) {
        const v = full[i] || 0;
        const prev = i > 0 ? (full[i - 1] || 0) : 0;
        let color = "#50617d";
        if (v > 0 && v >= prev) color = UP;
        else if (v < prev) color = DOWN;
        data.push({ value: Number(v.toFixed(2)), itemStyle: { color: color } });
      }
      series.push({
        name: "砖形图", type: "bar", xAxisIndex: 2, yAxisIndex: 2, data: data,
        barWidth: "56%", itemStyle: { borderRadius: [1, 1, 0, 0] },
      });
    } else if (hasSub && ind.sub === "kdj") {
      series.push({ name: "K", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: slice(state.ind.k),
        symbol: "none", lineStyle: { width: 1.2, color: "#ffd166" }, itemStyle: { color: "#ffd166" } });
      series.push({ name: "D", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: slice(state.ind.d),
        symbol: "none", lineStyle: { width: 1.2, color: "#8fb1ff" }, itemStyle: { color: "#8fb1ff" } });
      series.push({ name: "J", type: "line", xAxisIndex: 2, yAxisIndex: 2, data: slice(state.ind.j),
        symbol: "none", lineStyle: { width: 1.2, color: "#ff8fab" }, itemStyle: { color: "#ff8fab" },
        markLine: {
          silent: true, symbol: "none",
          data: [
            { yAxis: ind.kdj.over, lineStyle: { color: "rgba(255,143,171,.35)", type: "dashed" },
              label: { show: true, position: "end", formatter: String(ind.kdj.over), color: "#b98499", fontSize: 8 } },
            { yAxis: ind.kdj.under, lineStyle: { color: "rgba(143,177,255,.28)", type: "dashed" },
              label: { show: true, position: "end", formatter: String(ind.kdj.under), color: "#7f92b5", fontSize: 8 } },
          ],
        },
      });
    } else if (hasSub && ind.sub === "bupiao") {
      const bp = state.ind.bupiao || { short: [], mid: [], midlong: [], long: [] };
      const specs = [
        ["短期", bp.short, "#ffd166"],
        ["中期", bp.mid, "#ff8fab"],
        ["中长期", bp.midlong, "#9d8cff"],
        ["长期", bp.long, "#5ad1c8"],
      ];
      specs.forEach((sp, i) => {
        series.push({
          name: "补票" + sp[0], type: "line", xAxisIndex: 2, yAxisIndex: 2, data: slice(sp[1]),
          symbol: "none", lineStyle: { width: i === 0 ? 1.4 : 1, color: sp[2], opacity: .95 }, itemStyle: { color: sp[2] },
        });
      });
      series[series.length - 4].markLine = {
        silent: true, symbol: "none",
        data: [{ yAxis: ind.bupiao.level,
          lineStyle: { color: "rgba(255,209,102,.35)", type: "dashed" },
          label: { show: true, position: "end", formatter: String(ind.bupiao.level), color: "#b7a46e", fontSize: 8 } }],
      };
    }

    const subNames = { brick: "砖形图", kdj: "KDJ", bupiao: "补票四线" };
    const graphic = hasSub ? [{
      type: "text", left: 19, top: "80.6%",
      style: { text: subNames[ind.sub] || "副图", fill: "#71819d", font: "9px -apple-system, sans-serif" },
    }] : [];

    return {
      animation: false,
      backgroundColor: "transparent",
      textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif" },
      graphic: graphic,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", crossStyle: { color: "#59677e" }, lineStyle: { color: "#59677e", type: "dashed" } },
        backgroundColor: "rgba(15,24,42,.96)",
        borderColor: "rgba(130,157,205,.3)",
        borderWidth: 1,
        padding: [9, 11],
        textStyle: { color: "#dce5f6", fontSize: 11 },
        formatter: function (params) {
          if (!params || !params.length) return "";
          const kp = params.find((p) => p.seriesName === "K线") || params[0];
          const idx = kp.dataIndex;
          const b = bars[idx];
          if (!b) return "";
          const prev = idx > 0 ? bars[idx - 1].c : b.o;
          const chg = prev ? (b.c / prev - 1) * 100 : 0;
          const date = labels[idx] || ("第" + (idx + 1) + "根");
          const cls = chg >= 0 ? "#ff7a83" : "#38d9a9";
          return '<div style="font-size:10px;color:#8797b2;margin-bottom:5px">' + esc(date) + "</div>" +
            '<div style="display:grid;grid-template-columns:auto auto;gap:2px 13px;font-family:monospace">' +
            "<span>开</span><b style='color:#e8eefb'>" + b.o.toFixed(2) + "</b>" +
            "<span>高</span><b style='color:#ff7a83'>" + b.h.toFixed(2) + "</b>" +
            "<span>低</span><b style='color:#38d9a9'>" + b.l.toFixed(2) + "</b>" +
            "<span>收</span><b style='color:" + cls + "'>" + b.c.toFixed(2) + " (" + (chg > 0 ? "+" : "") + chg.toFixed(2) + "%)</b>" +
            "<span>量</span><b style='color:#c3cee1'>" + fmtVol(b.v) + "</b>" +
            "</div>" + tooltipIndicatorHtml(idx);
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: grids,
      xAxis: xAxes,
      yAxis: yAxes,
      series: series,
    };
  }

  function tooltipIndicatorHtml(idx) {
    if (!state.ind) return "";
    const off = state.ind.offset;
    const i = off + idx;
    const ind = state.indicator;
    const rows = [];
    if (ind.ma) {
      ind.maPeriods.forEach((p, j) => {
        const v = valueAt(state.ind.ma[j], i);
        if (v !== null) rows.push("MA" + p + " " + fmtInd(v));
      });
    }
    if (ind.yw) {
      const w = valueAt(state.ind.white, i);
      const y = valueAt(state.ind.yellow, i);
      if (w !== null) rows.push("白 " + fmtInd(w));
      if (y !== null) rows.push("黄 " + fmtInd(y));
    }
    if (ind.sub === "brick") {
      const v = valueAt(state.ind.brick, i);
      const pv = valueAt(state.ind.brick, i - 1);
      if (v !== null) rows.push("砖 " + fmtInd(v) + (pv !== null ? " (" + (v >= pv ? "+" : "") + fmtInd(v - pv) + ")" : ""));
    } else if (ind.sub === "kdj") {
      const k = valueAt(state.ind.k, i), d = valueAt(state.ind.d, i), j = valueAt(state.ind.j, i);
      if (k !== null) rows.push("K " + fmtInd(k) + "  D " + fmtInd(d) + "  J " + fmtInd(j));
    } else if (ind.sub === "bupiao") {
      const bp = state.ind.bupiao;
      if (bp) rows.push("补 " + ["short", "mid", "midlong", "long"].map((f, j) =>
        ["短", "中", "中长", "长"][j] + " " + fmtInd(valueAt(bp[f], i), 0)).join("  "));
    }
    if (!rows.length) return "";
    return '<div style="border-top:1px solid rgba(130,157,205,.2);margin-top:6px;padding-top:5px;font-family:monospace;font-size:9px;color:#9fb0cb;line-height:1.6">' +
      rows.map(esc).join("<br>") + "</div>";
  }

  function renderTrainChart() {
    if (!state.session) return;
    initTrainChart();
    recomputeIndicators();
    const opt = trainOption();
    state.trainChart.setOption(opt, true);
    $("chartLoading").hidden = true;
    $("chartError").hidden = true;
    renderIndicatorStrip();
    renderIndicatorValues();
  }

  function currentIndicatorIndex() {
    return state.ind ? state.ind.offset + state.visible - 1 : -1;
  }

  function renderIndicatorStrip() {
    const el = $("indicatorStrip");
    if (!el) return;
    const ind = state.indicator;
    const chunks = [];
    if (state.ind && (ind.ma || ind.yw || ind.sub !== "none")) {
      chunks.push('<span class="ind-strip-label">指标</span>');
      if (ind.ma) {
        ind.maPeriods.forEach((p, i) => {
          const v = indValue(state.ind.ma[i]);
          chunks.push('<span class="ind-strip-chip">MA' + p + " <b>" + fmtInd(v) + "</b></span>");
        });
      }
      if (ind.yw) {
        const w = indValue(state.ind.white);
        const y = indValue(state.ind.yellow);
        chunks.push('<span class="ind-strip-chip">白 <b>' + fmtInd(w) + "</b></span>");
        chunks.push('<span class="ind-strip-chip">黄 <b>' + fmtInd(y) + "</b></span>");
      }
      if (ind.sub === "brick") {
        const v = indValue(state.ind.brick);
        const i = currentIndicatorIndex();
        const pv = valueAt(state.ind.brick, i - 1);
        const cls = v !== null && pv !== null && v >= pv ? "up" : v !== null && pv !== null ? "down" : "neutral";
        chunks.push('<span class="ind-strip-sep"></span>');
        chunks.push('<span class="ind-strip-chip ' + cls + '">砖 <b>' + fmtInd(v) + "</b></span>");
      } else if (ind.sub === "kdj") {
        chunks.push('<span class="ind-strip-sep"></span>');
        chunks.push('<span class="ind-strip-chip">K <b>' + fmtInd(indValue(state.ind.k)) + "</b></span>");
        chunks.push('<span class="ind-strip-chip">D <b>' + fmtInd(indValue(state.ind.d)) + "</b></span>");
        chunks.push('<span class="ind-strip-chip">J <b>' + fmtInd(indValue(state.ind.j)) + "</b></span>");
      } else if (ind.sub === "bupiao" && state.ind.bupiao) {
        const bp = state.ind.bupiao;
        chunks.push('<span class="ind-strip-sep"></span>');
        [["短", bp.short], ["中", bp.mid], ["中长", bp.midlong], ["长", bp.long]].forEach((sp) => {
          chunks.push('<span class="ind-strip-chip">' + sp[0] + " <b>" + fmtInd(indValue(sp[1]), 0) + "</b></span>");
        });
      }
    }
    if (chunks.length <= 1) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = chunks.join("");
  }

  function renderIndicatorValues() {
    const el = $("indValues");
    const hint = $("indValueHint");
    if (!el) return;
    const ind = state.indicator;
    if (!state.ind || !state.session) {
      el.innerHTML = '<div class="ind-value-empty">等待训练数据…</div>';
      if (hint) hint.textContent = "--";
      return;
    }
    if (hint) hint.textContent = "第 " + state.visible + " / 200 根";
    const groups = [];
    if (ind.ma) {
      groups.push('<div class="ind-value-group"><h5>均线</h5>' + ind.maPeriods.map((p, i) =>
        '<div class="ind-value-row"><span>MA' + p + "</span><b>" + fmtInd(indValue(state.ind.ma[i])) + "</b></div>").join("") + "</div>");
    }
    if (ind.yw) {
      groups.push('<div class="ind-value-group"><h5>黄白线</h5>' +
        '<div class="ind-value-row"><span>白线</span><b>' + fmtInd(indValue(state.ind.white)) + "</b></div>" +
        '<div class="ind-value-row"><span>黄线</span><b>' + fmtInd(indValue(state.ind.yellow)) + "</b></div></div>");
    }
    if (ind.sub === "brick") {
      groups.push('<div class="ind-value-group"><h5>砖形图</h5>' +
        '<div class="ind-value-row"><span>当前砖值</span><b>' + fmtInd(indValue(state.ind.brick)) + "</b></div></div>");
    } else if (ind.sub === "kdj") {
      groups.push('<div class="ind-value-group"><h5>KDJ(' + ind.kdj.n + "," + ind.kdj.m1 + "," + ind.kdj.m2 + ")</h5>" +
        '<div class="ind-value-row"><span>K</span><b>' + fmtInd(indValue(state.ind.k)) + "</b></div>" +
        '<div class="ind-value-row"><span>D</span><b>' + fmtInd(indValue(state.ind.d)) + "</b></div>" +
        '<div class="ind-value-row"><span>J</span><b>' + fmtInd(indValue(state.ind.j)) + "</b></div></div>");
    } else if (ind.sub === "bupiao" && state.ind.bupiao) {
      const bp = state.ind.bupiao;
      groups.push('<div class="ind-value-group"><h5>补票四线</h5>' +
        [["短期", bp.short], ["中期", bp.mid], ["中长期", bp.midlong], ["长期", bp.long]].map((sp) =>
          '<div class="ind-value-row"><span>' + sp[0] + "</span><b>" + fmtInd(indValue(sp[1]), 0) + "</b></div>").join("") + "</div>");
    }
    el.innerHTML = groups.length ? groups.join("") : '<div class="ind-value-empty">主图和副图指标都未启用</div>';
  }

  /* ---------------------------------------------------------------
     指标设置面板
  --------------------------------------------------------------- */
  function intField(label, path, value, min, max, step) {
    return '<label>' + label + '<input type="number" data-param="' + path + '" value="' + value +
      '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '"></label>';
  }

  function renderSubParams() {
    const box = $("indParams");
    if (!box) return;
    const ind = state.indicator;
    let html = "";
    if (ind.sub === "none") {
      html = '<div class="ind-empty">未启用副图指标，可在上方选择砖形图 / KDJ / 补票四线</div>';
    } else if (ind.sub === "brick") {
      html = '<div class="ind-param-grid">' +
        intField("高低周期", "brick.range", ind.brick.range, 2, 30) +
        intField("平滑1", "brick.smooth1", ind.brick.smooth1, 1, 30) +
        intField("平滑2", "brick.smooth2", ind.brick.smooth2, 1, 30) +
        intField("二次平滑", "brick.smooth3", ind.brick.smooth3, 1, 30) +
        intField("显示阈值", "brick.threshold", ind.brick.threshold, 0, 100, 0.1) +
        "</div>";
    } else if (ind.sub === "kdj") {
      html = '<div class="ind-param-grid">' +
        intField("周期 N", "kdj.n", ind.kdj.n, 2, 60) +
        intField("平滑 M1", "kdj.m1", ind.kdj.m1, 1, 20) +
        intField("平滑 M2", "kdj.m2", ind.kdj.m2, 1, 20) +
        intField("超买线", "kdj.over", ind.kdj.over, 50, 200) +
        intField("超卖线", "kdj.under", ind.kdj.under, 0, 50) +
        "</div>";
    } else {
      html = '<div class="ind-param-grid">' +
        intField("短期", "bupiao.short", ind.bupiao.short, 2, 120) +
        intField("中期", "bupiao.mid", ind.bupiao.mid, 2, 120) +
        intField("中长期", "bupiao.midlong", ind.bupiao.midlong, 2, 120) +
        intField("长期", "bupiao.long", ind.bupiao.long, 2, 120) +
        intField("关键位", "bupiao.level", ind.bupiao.level, 1, 100) +
        "</div>";
    }
    box.innerHTML = html;
  }

  function syncIndicatorControls() {
    const ind = state.indicator;
    if (!$("indMA")) return;
    $("indMA").checked = ind.ma;
    $("indYW").checked = ind.yw;
    ind.maPeriods.forEach((v, i) => { $("indMa" + i).value = v; });
    $("indEma1").value = ind.ema[0];
    $("indEma2").value = ind.ema[1];
    ind.yellowPeriods.forEach((v, i) => { $("indYellow" + i).value = v; });
    document.querySelectorAll("#subTabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.sub === ind.sub);
    });
    $("maParams").classList.toggle("disabled", !ind.ma);
    $("ywParams").classList.toggle("disabled", !ind.yw);
    document.querySelectorAll("#maParams input").forEach((x) => { x.disabled = !ind.ma; });
    document.querySelectorAll("#ywParams input").forEach((x) => { x.disabled = !ind.yw; });
    renderSubParams();
    renderIndicatorValues();
  }

  function openIndicatorPanel() {
    $("indPanel").hidden = false;
    $("btnIndicator").classList.add("active");
    syncIndicatorControls();
  }
  function closeIndicatorPanel() {
    const panel = $("indPanel");
    if (panel) panel.hidden = true;
    const btn = $("btnIndicator");
    if (btn) btn.classList.remove("active");
  }

  function setSubIndicator(sub) {
    state.indicator.sub = ["none", "brick", "kdj", "bupiao"].includes(sub) ? sub : "none";
    saveIndicator();
    syncIndicatorControls();
    renderTrainChart();
  }

  function applyMainParam(kind, index, value) {
    if (kind === "ma") state.indicator.maPeriods[index] = Math.round(clampNum(value, 2, 250, state.indicator.maPeriods[index]));
    else if (kind === "ema") state.indicator.ema[index] = Math.round(clampNum(value, 2, 80, state.indicator.ema[index]));
    else if (kind === "yellow") state.indicator.yellowPeriods[index] = Math.round(clampNum(value, 2, 250, state.indicator.yellowPeriods[index]));
    saveIndicator();
    renderTrainChart();
  }

  function applySubParam(path, value) {
    const parts = path.split(".");
    if (parts.length !== 2) return;
    const group = state.indicator[parts[0]];
    if (!group || !(parts[1] in group)) return;
    const key = parts[1];
    const isThreshold = key === "threshold" || key === "level";
    const min = (key === "over") ? 50 : (key === "under" || isThreshold) ? 0 : 1;
    const max = (key === "over") ? 200 : (key === "threshold") ? 100 : (key === "level") ? 100 : 250;
    const fallback = group[key];
    group[key] = isThreshold ? clampNum(value, min, max, fallback) : Math.round(clampNum(value, min, max, fallback));
    saveIndicator();
    renderTrainChart();
  }

  function bindIndicatorPanel() {
    $("btnIndicator").addEventListener("click", () => {
      if ($("indPanel").hidden) openIndicatorPanel();
      else closeIndicatorPanel();
    });
    $("btnIndClose").addEventListener("click", closeIndicatorPanel);
    $("btnIndApply").addEventListener("click", closeIndicatorPanel);
    $("btnIndReset").addEventListener("click", () => {
      state.indicator = cloneIndicator(DEFAULT_INDICATOR);
      saveIndicator();
      syncIndicatorControls();
      renderTrainChart();
      toast("指标参数已恢复默认");
    });
    $("indMA").addEventListener("change", (e) => {
      state.indicator.ma = e.target.checked;
      saveIndicator();
      syncIndicatorControls();
      renderTrainChart();
    });
    $("indYW").addEventListener("change", (e) => {
      state.indicator.yw = e.target.checked;
      saveIndicator();
      syncIndicatorControls();
      renderTrainChart();
    });
    for (let i = 0; i < 4; i++) {
      $("indMa" + i).addEventListener("input", (e) => {
        if (e.target.value === "") return;
        applyMainParam("ma", i, e.target.value);
      });
      $("indYellow" + i).addEventListener("input", (e) => {
        if (e.target.value === "") return;
        applyMainParam("yellow", i, e.target.value);
      });
    }
    [1, 2].forEach((idx, i) => {
      $("indEma" + idx).addEventListener("input", (e) => {
        if (e.target.value === "") return;
        applyMainParam("ema", i, e.target.value);
      });
    });
    $("subTabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-sub]");
      if (b) setSubIndicator(b.dataset.sub);
    });
    $("indParams").addEventListener("input", (e) => {
      const input = e.target.closest("input[data-param]");
      if (!input || input.value === "") return;
      applySubParam(input.dataset.param, input.value);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("indPanel").hidden) {
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input") return;
        closeIndicatorPanel();
      }
    });
  }

  /* ---------------------------------------------------------------
     训练流程
  --------------------------------------------------------------- */
  async function startSession() {
    if (state.loading) return;
    stopAuto();
    state.loading = true;
    $("chartLoading").hidden = false;
    $("chartError").hidden = true;
    $("trainResult").hidden = true;
    $("chartLoading").querySelector("b").textContent = "正在截取历史K线…";
    try {
      const data = await api("/api/training/session?period=" + encodeURIComponent(state.period) +
        "&initial=" + encodeURIComponent(state.initial));
      state.session = data;
      state.visible = Math.max(20, Math.min(200, data.initial || 60));
      state.labelsReal = null;
      state.ind = null;
      state.finished = false;
      state.revealed = false;
      state.recorded = false;
      state._revealInfo = null;
      state.cash = INITIAL_CAPITAL;
      state.shares = 0;
      state.avgCost = 0;
      state.trades = [];
      state.equity = INITIAL_CAPITAL;
      state.equityCurve = [INITIAL_CAPITAL];
      state.peak = INITIAL_CAPITAL;
      state.maxDD = 0;
      state.period = data.period;
      $("trainPeriodBadge").textContent = data.period_label;
      $("trainSource").textContent = "数据来源：" + (data.source || "真实历史行情");
      $("trainState").textContent = "进行中";
      $("trainState").classList.remove("done");
      $("trainCounter").textContent = "第 " + state.visible + " / " + data.total + " 根";
      $("patternHintResult").hidden = true;
      $("patternHintEmpty").hidden = false;
      document.querySelectorAll("#periodChips button").forEach((b) => {
        b.classList.toggle("active", b.dataset.period === state.period);
      });
      document.querySelectorAll("#initialChips button").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.init) === state.initial);
      });
      syncSizeControls();
      buildTicks();
      recomputeIndicators();
      updateTrainUI();
      renderTrainChart();
      updateAccountUI();
    } catch (err) {
      $("chartLoading").hidden = true;
      $("chartError").hidden = false;
      $("chartErrorText").textContent = err.message || "未知错误";
    } finally {
      state.loading = false;
    }
  }

  function buildTicks() {
    const box = $("progressTicks");
    box.innerHTML = "";
    state.tickEls = [];
    for (let i = 0; i < 200; i++) {
      const el = document.createElement("i");
      box.appendChild(el);
      state.tickEls.push(el);
    }
  }

  function syncProgress() {
    const pct = state.visible / 200 * 100;
    $("progressFill").style.width = pct.toFixed(2) + "%";
    $("progressText").textContent = state.visible + " / 200";
    for (let i = 0; i < state.tickEls.length; i++) {
      const el = state.tickEls[i];
      el.className = i < state.visible - 1 ? "seen" : i === state.visible - 1 ? "current" : "";
    }
  }

  function updateTrainUI() {
    if (!state.session) return;
    $("trainCounter").textContent = "第 " + state.visible + " / 200 根";
    $("btnStep").disabled = state.finished || state.visible >= 200;
    $("btnReveal").disabled = state.finished;
    syncProgress();
    if (state.finished) {
      $("trainState").textContent = "已结束";
      $("trainState").classList.add("done");
      $("autoLabel").textContent = "自动播放";
      $("btnAuto").classList.remove("playing");
    }
    renderIndicatorStrip();
    renderIndicatorValues();
  }

  function currentBar() {
    return state.session && state.visible > 0 ? state.session.bars[state.visible - 1] : null;
  }

  function updateAccountUI() {
    const b = currentBar();
    const price = b ? b.c : 0;
    state.equity = state.cash + state.shares * price;
    if (state.equity > state.peak) state.peak = state.equity;
    if (state.peak > 0) {
      state.maxDD = Math.max(state.maxDD, (state.peak - state.equity) / state.peak * 100);
    }
    const ret = (state.equity / INITIAL_CAPITAL - 1) * 100;
    $("equityVal").textContent = fmtMoney(state.equity);
    const pnl = $("sessionPnl");
    pnl.textContent = fmtPct(ret);
    pnl.className = "session-pnl " + pctClass(ret);
    $("cashVal").textContent = fmtMoney(state.cash);
    $("posVal").textContent = fmtMoney(state.shares * price);
    $("sharesVal").textContent = fmtNum(state.shares) + " 股";
    $("costVal").textContent = state.shares ? fmtNum(state.avgCost, 2) : "--";
    const st = $("tradeStatus");
    st.textContent = state.shares ? "持仓 " + state.shares + " 股" : "空仓";
    st.classList.toggle("holding", !!state.shares);

    const closed = state.trades.filter((t) => t.side === "sell");
    const wins = closed.filter((t) => t.pnl > 0).length;
    $("liveTrades").textContent = closed.length;
    $("liveWinRate").textContent = closed.length ? (wins / closed.length * 100).toFixed(0) + "%" : "--";
    const gp = closed.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const gl = Math.abs(closed.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
    $("livePF").textContent = !closed.length ? "--" : gl ? (gp / gl).toFixed(2) : "∞";
    $("liveDD").textContent = state.maxDD.toFixed(2) + "%";
    $("liveDD").className = state.maxDD > 10 ? "down" : "";

    const btn = $("btnTrade");
    btn.textContent = (state.side === "buy" ? "买入 " : "卖出 ") + fracLabel(state.frac);
    btn.className = "trade-btn " + state.side;
    const noCash = state.cash < price * 100;
    btn.disabled = state.finished || (state.side === "buy" ? noCash : !state.shares);
  }

  function fracLabel(f) {
    if (f >= 0.999) return "全仓";
    if (Math.abs(f - 0.75) < 0.006) return "75%";
    if (Math.abs(f - 0.6667) < 0.006) return "2/3仓";
    if (Math.abs(f - 0.5) < 0.006) return "半仓";
    if (Math.abs(f - 0.3333) < 0.006) return "1/3仓";
    if (Math.abs(f - 0.25) < 0.006) return "1/4仓";
    if (Math.abs(f - 0.1) < 0.006) return "10%";
    return Math.round(f * 100) + "%";
  }

  function syncSizeControls() {
    const pct = Math.round(state.frac * 100);
    const pctEl = $("sizePct");
    const range = $("sizeRange");
    if (pctEl) pctEl.textContent = pct + "%";
    if (range) range.value = pct;
    document.querySelectorAll("#sizeBtns button").forEach((b) => {
      b.classList.toggle("active", Math.abs(Number(b.dataset.frac) - state.frac) < 0.006);
    });
  }

  function setFraction(f) {
    state.frac = Math.max(0.05, Math.min(1, Number(f) || 0.5));
    saveFraction();
    syncSizeControls();
    updateAccountUI();
  }

  function advance() {
    if (!state.session || state.finished) return;
    if (state.visible >= 200) { finish("end"); return; }
    state.visible += 1;
    updateAccountUI();
    state.equityCurve.push(state.equity);
    renderTrainChart();
    updateTrainUI();
    if (state.visible >= 200) finish("end");
  }

  function buy(frac) {
    if (!state.session || state.finished) return;
    const price = currentBar().c;
    const budget = state.cash * (frac >= 1 ? 0.999 : frac);
    let shares = Math.floor(budget / (price * 100)) * 100;
    const feeFor = (gross) => Math.max(5, gross * 0.00025);
    while (shares > 0 && shares * price + feeFor(shares * price) > state.cash) shares -= 100;
    if (shares < 100) { toast("可用资金不足一手（100股）"); return; }
    const gross = shares * price;
    const fee = feeFor(gross);
    state.cash -= gross + fee;
    state.avgCost = (state.avgCost * state.shares + gross + fee) / (state.shares + shares);
    state.shares += shares;
    state.trades.push({ side: "buy", bar: state.visible, price: price, shares: shares, fee: fee });
    updateAccountUI();
    state.equityCurve.push(state.equity);
    renderTrainChart();
    toast("买入 " + shares + " 股 @ " + price.toFixed(2));
  }

  function sell(frac) {
    if (!state.session || state.finished) return;
    if (!state.shares) { toast("当前没有持仓"); return; }
    const price = currentBar().c;
    let qty = frac >= 1 ? state.shares : Math.floor(state.shares * frac / 100) * 100;
    if (qty < 100) qty = Math.min(100, state.shares);
    if (qty > state.shares) qty = state.shares;
    const gross = qty * price;
    const fee = Math.max(5, gross * 0.00025);
    const stamp = gross * 0.0005;
    const proceeds = gross - fee - stamp;
    const cost = state.avgCost * qty;
    const pnl = proceeds - cost;
    const pnlPct = state.avgCost ? (price / state.avgCost - 1) * 100 : 0;
    state.cash += proceeds;
    state.shares -= qty;
    if (state.shares === 0) state.avgCost = 0;
    state.trades.push({
      side: "sell", bar: state.visible, price: price, shares: qty,
      fee: fee + stamp, pnl: pnl, pnlPct: pnlPct,
    });
    updateAccountUI();
    state.equityCurve.push(state.equity);
    renderTrainChart();
    toast("卖出 " + qty + " 股，本笔 " + (pnl >= 0 ? "+" : "") + fmtMoney(pnl, 0));
  }

  function stopAuto() {
    if (state.autoTimer) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
    const btn = $("btnAuto");
    if (btn) btn.classList.remove("playing");
    const label = $("autoLabel");
    if (label) label.textContent = "自动播放";
  }

  function toggleAuto() {
    if (state.finished) return;
    if (state.autoTimer) { stopAuto(); return; }
    state.autoTimer = setInterval(() => {
      if (state.finished || state.visible >= 200) { stopAuto(); return; }
      advance();
    }, state.speed);
    $("btnAuto").classList.add("playing");
    $("autoLabel").textContent = "暂停";
  }

  function settlePosition() {
    if (!state.shares) return false;
    const price = currentBar().c;
    const qty = state.shares;
    const gross = qty * price;
    const fee = Math.max(5, gross * 0.00025);
    const stamp = gross * 0.0005;
    const proceeds = gross - fee - stamp;
    const cost = state.avgCost * qty;
    state.cash += proceeds;
    state.shares = 0;
    state.avgCost = 0;
    state.trades.push({
      side: "sell", bar: state.visible, price: price, shares: qty,
      fee: fee + stamp, pnl: proceeds - cost,
      pnlPct: cost ? (proceeds / cost - 1) * 100 : 0, forced: true,
    });
    return true;
  }

  async function finish(reason) {
    if (!state.session || state.finished) return;
    state.finished = true;
    stopAuto();
    const settled = settlePosition();
    updateAccountUI();
    state.equityCurve.push(state.equity);
    $("chartLoading").hidden = true;
    let reveal = null;
    if (!state.revealed) {
      $("trainState").textContent = "揭晓中…";
      try {
        reveal = await api("/api/training/reveal?id=" + encodeURIComponent(state.session.id));
        if (reveal && reveal.ok) {
          state.labelsReal = reveal.labels || null;
          state.revealed = true;
        }
      } catch (err) {
        toast("答案获取失败：" + err.message);
      }
    }
    if (state.revealed && !state._revealInfo && reveal) state._revealInfo = reveal;
    recordSession(reason);
    renderTrainChart();
    updateTrainUI();
    showResultCard(reason, settled);
    refreshHero();
  }

  function recordSession(reason) {
    if (state.recorded) return;
    state.recorded = true;
    const ret = (state.equity / INITIAL_CAPITAL - 1) * 100;
    const closed = state.trades.filter((t) => t.side === "sell");
    const wins = closed.filter((t) => t.pnl > 0).length;
    const gp = closed.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
    const gl = Math.abs(closed.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
    const info = state._revealInfo || null;
    const rec = {
      id: state.session.id,
      ts: new Date().toISOString(),
      period: state.session.period,
      period_label: state.session.period_label || PERIOD_LABEL[state.session.period],
      initial: state.initial,
      visible: state.visible,
      returnPct: Number(ret.toFixed(3)),
      trades: closed.length,
      wins: wins,
      losses: closed.length - wins,
      winRate: closed.length ? Number((wins / closed.length * 100).toFixed(2)) : 0,
      profitFactor: gl ? Number((gp / gl).toFixed(3)) : (gp > 0 ? 99 : 0),
      maxDD: Number(state.maxDD.toFixed(3)),
      code: info ? info.code : null,
      name: info ? info.name : null,
      startDate: info ? info.start_date : null,
      endDate: info ? info.end_date : null,
      completed: reason === "end",
      reason: reason,
      equityCurve: sampleCurve(),
    };
    state.stats.sessions.unshift(rec);
    if (state.stats.sessions.length > 300) state.stats.sessions.length = 300;
    saveStats();
  }

  function sampleCurve() {
    const arr = state.equityCurve || [INITIAL_CAPITAL];
    if (arr.length <= 60) return arr.map((v) => Number(v.toFixed(0)));
    const out = [];
    for (let i = 0; i < 60; i++) {
      const idx = Math.round(i * (arr.length - 1) / 59);
      out.push(Number(arr[idx].toFixed(0)));
    }
    return out;
  }

  function gradeFor(ret) {
    if (ret >= 15) return { g: "S", cls: "" };
    if (ret >= 7) return { g: "A", cls: "" };
    if (ret >= 1) return { g: "B", cls: "grade-b" };
    if (ret >= -4) return { g: "C", cls: "grade-b" };
    return { g: "D", cls: "grade-c" };
  }

  function showResultCard(reason, settled) {
    const ret = (state.equity / INITIAL_CAPITAL - 1) * 100;
    const closed = state.trades.filter((t) => t.side === "sell");
    const wins = closed.filter((t) => t.pnl > 0).length;
    const grade = gradeFor(ret);
    const info = state._revealInfo;
    $("resKicker").textContent = reason === "end" ? "200 根K线 · 本局结束" : "提前揭晓 · 本局结束";
    $("resTitle").textContent = ret >= 7 ? "这一局节奏不错" : ret >= 1 ? "小有收获，继续保持" : ret >= -4 ? "结果一般，复盘一下" : "亏损也是训练的一部分";
    $("resStock").innerHTML = info
      ? esc(info.name || "未知") + " <code>" + esc(info.code || "") + "</code> · " + esc(info.period_label || "")
      : "标的暂未揭晓";
    $("resDates").textContent = info
      ? (info.start_date || "") + "  →  " + (info.end_date || "")
      : "本局未取得答案，稍后可重试";
    const gradeEl = $("resGrade");
    gradeEl.textContent = grade.g;
    gradeEl.className = "result-grade " + grade.cls;
    const items = [
      ["收益率", fmtPct(ret), pctClass(ret)],
      ["交易次数", closed.length + " 笔", ""],
      ["胜率", closed.length ? (wins / closed.length * 100).toFixed(0) + "%" : "--", ""],
      ["最大回撤", state.maxDD.toFixed(2) + "%", ""],
    ];
    $("resMetrics").innerHTML = items.map((it) =>
      '<div class="result-metric"><small>' + it[0] + '</small><b class="' + it[2] + '">' + it[1] + "</b></div>"
    ).join("");
    $("trainResult").querySelector(".result-tip").textContent = settled
      ? "结束时未平仓仓位已按最后收盘价自动结算（含交易费用）。答案只在本局结束后显示。"
      : "答案只在本局结束后显示；每次新题都会重新随机抽取。";
    $("trainResult").hidden = false;
  }

  function resetResultState() {
    $("trainResult").hidden = true;
    state._revealInfo = null;
  }

  async function showPatternHint() {
    if (!state.session) return;
    const box = $("patternHintResult");
    const empty = $("patternHintEmpty");
    empty.hidden = true;
    box.hidden = false;
    box.innerHTML = '<div class="hint-meta">正在分析当前可见走势…</div>';
    try {
      const data = await api("/api/pattern/analyze", {
        method: "POST",
        body: { bars: state.session.bars.slice(0, state.visible) },
      });
      if (!data.ok) throw new Error(data.error || "分析失败");
      const dirCls = data.bias_dir === "bullish" ? "up" : data.bias_dir === "bearish" ? "down" : "neutral";
      const matches = (data.matches || []).slice(0, 3);
      box.innerHTML =
        '<div class="hint-bias-row">' +
        '<span class="hint-bias ' + dirCls + '">' + esc(data.bias) + "</span>" +
        '<span class="hint-meta">' + esc(data.trend.phase) + " · 匹配度 " + data.confidence.toFixed(0) + "%</span>" +
        '<span class="hint-meta">仅用 ' + state.visible + " 根可见K线</span></div>" +
        '<div class="hint-matches">' + matches.map((m) =>
          '<div class="hint-match"><div style="flex:1"><div style="display:flex;gap:8px;align-items:center">' +
          '<span class="hm-name">' + esc(m.name) + '</span>' +
          '<span class="hm-bar"><i style="width:' + Math.min(100, m.score) + '%"></i></span>' +
          '<span class="hm-score">' + m.score.toFixed(0) + "</span></div>" +
          '<div class="hint-evidence">' + esc((m.evidence || []).slice(0, 2).join("；")) + "</div></div></div>"
        ).join("") + "</div>";
    } catch (err) {
      box.innerHTML = '<div class="hint-meta">分析失败：' + esc(err.message) + "</div>";
    }
  }

  /* ---------------------------------------------------------------
     图表交互 & 键盘
  --------------------------------------------------------------- */
  function bindTraining() {
    bindIndicatorPanel();
    $("periodChips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-period]");
      if (!b) return;
      state.period = b.dataset.period;
      document.querySelectorAll("#periodChips button").forEach((x) => x.classList.toggle("active", x === b));
      startSession();
    });
    $("initialChips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-init]");
      if (!b) return;
      state.initial = Number(b.dataset.init);
      document.querySelectorAll("#initialChips button").forEach((x) => x.classList.toggle("active", x === b));
      startSession();
    });
    $("btnNew").addEventListener("click", startSession);
    $("btnRetry").addEventListener("click", startSession);
    $("btnStep").addEventListener("click", advance);
    $("btnAuto").addEventListener("click", toggleAuto);
    $("speedGroup").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-speed]");
      if (!b) return;
      state.speed = Number(b.dataset.speed);
      document.querySelectorAll("#speedGroup button").forEach((x) => x.classList.toggle("active", x === b));
      if (state.autoTimer) { stopAuto(); toggleAuto(); }
    });
    $("tradeSide").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-side]");
      if (!b) return;
      state.side = b.dataset.side;
      document.querySelectorAll("#tradeSide button").forEach((x) => x.classList.toggle("active", x === b));
      updateAccountUI();
    });
    $("sizeBtns").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-frac]");
      if (!b) return;
      setFraction(Number(b.dataset.frac));
    });
    $("sizeRange").addEventListener("input", (e) => {
      setFraction(Number(e.target.value) / 100);
    });
    $("btnTrade").addEventListener("click", () => {
      if (state.side === "buy") buy(state.frac);
      else sell(state.frac);
    });
    $("btnReveal").addEventListener("click", () => finish("reveal"));
    $("btnPatternHint").addEventListener("click", showPatternHint);
    $("btnCloseResult").addEventListener("click", () => { $("trainResult").hidden = true; });
    $("btnAgain").addEventListener("click", () => { resetResultState(); startSession(); });
    document.addEventListener("keydown", (e) => {
      if (state.view !== "train") return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      if (e.code === "Space") {
        if (state.finished) return;
        e.preventDefault();
        advance();
      } else if (e.key === "b" || e.key === "B") {
        if (!state.finished) buy(state.frac);
      } else if (e.key === "s" || e.key === "S") {
        if (!state.finished) sell(state.frac);
      }
    });
    window.addEventListener("resize", debounce(() => {
      if (state.trainChart) state.trainChart.resize();
      if (state.statsChart) state.statsChart.resize();
    }, 120));
  }

  /* ---------------------------------------------------------------
     数据统计
  --------------------------------------------------------------- */
  function renderStats() {
    const sessions = state.stats.sessions || [];
    const total = sessions.length;
    const allTrades = sessions.reduce((a, s) => a + (s.trades || 0), 0);
    const allWins = sessions.reduce((a, s) => a + (s.wins || 0), 0);
    const avgRet = total ? sessions.reduce((a, s) => a + s.returnPct, 0) / total : null;
    const gp = sessions.reduce((a, s) => a + Math.max(0, s.returnPct), 0);
    const gl = Math.abs(sessions.reduce((a, s) => a + Math.min(0, s.returnPct), 0));
    const avgDD = total ? sessions.reduce((a, s) => a + s.maxDD, 0) / total : null;

    const cards = [
      ["累计训练", total ? total + " 局" : "--", "", "从第一局开始积累"],
      ["累计交易", allTrades ? allTrades + " 笔" : "--", "", "已完成买卖"],
      ["综合胜率", allTrades ? (allWins / allTrades * 100).toFixed(1) + "%" : "--", "", "按已平仓交易"],
      ["平均收益率", avgRet === null ? "--" : fmtPct(avgRet), avgRet > 0 ? "up" : avgRet < 0 ? "down" : "", "每局平均"],
      ["收益盈亏比", gl ? (gp / gl).toFixed(2) : (gp ? "∞" : "--"), "", "盈利局 / 亏损局"],
      ["平均最大回撤", avgDD === null ? "--" : avgDD.toFixed(2) + "%", "", "风险控制参考"],
    ];
    $("statsSummary").innerHTML = cards.map((c) =>
      '<div class="summary-card"><small>' + c[0] + '</small><b class="' + c[2] + '">' + c[1] + "</b><span>" + c[3] + "</span></div>"
    ).join("");

    renderEquityCurve(sessions);
    renderPeriodBreakdown(sessions);
    renderSessionTable(sessions);
    $("recordCount").textContent = "共 " + total + " 局";
    refreshHero();
  }

  function renderEquityCurve(sessions) {
    if (!state.statsChart) state.statsChart = echarts.init($("equityChart"), null, { renderer: "canvas" });
    if (!sessions.length) {
      state.statsChart.setOption({
        animation: false,
        graphic: [{ type: "text", left: "center", top: "middle",
          style: { text: "还没有训练记录\n完成一局后这里会出现净值曲线", fill: "#9aa4b8", fontSize: 12, lineHeight: 20, textAlign: "center" } }],
        xAxis: { show: false }, yAxis: { show: false }, series: [],
      }, true);
      return;
    }
    const chrono = sessions.slice().reverse();
    let equity = INITIAL_CAPITAL;
    const data = [equity];
    const labels = ["开始"];
    chrono.forEach((s, i) => {
      equity *= 1 + s.returnPct / 100;
      data.push(Number(equity.toFixed(0)));
      labels.push("第" + (i + 1) + "局");
    });
    const up = data[data.length - 1] >= INITIAL_CAPITAL;
    const color = up ? "#2f6bff" : "#0aa678";
    state.statsChart.setOption({
      animation: true,
      animationDuration: 500,
      grid: { left: 12, right: 20, top: 22, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis", backgroundColor: "rgba(17,26,46,.95)", borderWidth: 0,
        textStyle: { color: "#e7edf8", fontSize: 11 },
        formatter: (p) => p[0].axisValue + "<br/><b>¥" + Number(p[0].value).toLocaleString("zh-CN") + "</b>",
      },
      xAxis: {
        type: "category", data: labels, boundaryGap: false,
        axisLine: { lineStyle: { color: "#e3e8f1" } }, axisTick: { show: false },
        axisLabel: { color: "#9aa4b8", fontSize: 9, interval: Math.max(0, Math.ceil(labels.length / 8) - 1) },
      },
      yAxis: {
        type: "value", scale: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: "#9aa4b8", fontSize: 9, formatter: (v) => "¥" + Math.round(v).toLocaleString("zh-CN") },
        splitLine: { lineStyle: { color: "#eef1f7", type: "dashed" } },
      },
      series: [{
        type: "line", data: data, smooth: true, symbol: "circle", symbolSize: 4, showSymbol: data.length < 30,
        lineStyle: { width: 2.2, color: color },
        itemStyle: { color: color, borderColor: "#fff", borderWidth: 1 },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: up ? "rgba(47,107,255,.18)" : "rgba(10,166,120,.15)" },
                         { offset: 1, color: "rgba(255,255,255,0)" }],
          },
        },
        markLine: {
          silent: true, symbol: "none",
          data: [{ yAxis: INITIAL_CAPITAL, lineStyle: { color: "#d3dae6", type: "dashed" }, label: { show: false } }],
        },
      }],
    }, true);
  }

  function renderPeriodBreakdown(sessions) {
    const groups = {};
    sessions.forEach((s) => {
      const k = s.period || "day";
      if (!groups[k]) groups[k] = { count: 0, ret: 0, trades: 0, wins: 0 };
      groups[k].count++;
      groups[k].ret += s.returnPct || 0;
      groups[k].trades += s.trades || 0;
      groups[k].wins += s.wins || 0;
    });
    const keys = PERIOD_ORDER.filter((k) => groups[k]);
    if (!keys.length) {
      $("periodBreakdown").innerHTML = '<div class="empty-state" style="padding:22px 6px"><p>完成不同周期的训练后，这里会对比表现。</p></div>';
      return;
    }
    const maxAbs = Math.max(1, ...keys.map((k) => Math.abs(groups[k].ret / groups[k].count)));
    $("periodBreakdown").innerHTML = keys.map((k) => {
      const g = groups[k];
      const avg = g.ret / g.count;
      const width = Math.min(100, Math.abs(avg) / maxAbs * 100);
      return '<div class="pb-row"><span class="pb-label">' + (PERIOD_LABEL[k] || k) + "</span>" +
        '<div class="pb-track"><i class="' + (avg < 0 ? "neg" : "") + '" style="width:' + width.toFixed(1) + '%"></i></div>' +
        '<span class="pb-value ' + pctClass(avg) + '">' + fmtPct(avg) + "<small>" + g.count + " 局 · 胜率 " +
        (g.trades ? (g.wins / g.trades * 100).toFixed(0) + "%" : "--") + "</small></span></div>";
    }).join("");
  }

  function renderSessionTable(sessions) {
    if (!sessions.length) {
      $("statsTable").innerHTML = '<div class="empty-state"><b>还没有训练记录</b><p>去训练场走完一局 200 根K线，这里会自动记录成绩。</p></div>';
      return;
    }
    const rows = sessions.slice(0, 80).map((s) => {
      const ts = new Date(s.ts);
      const date = isNaN(ts) ? "--" : (ts.getMonth() + 1) + "/" + ts.getDate() + " " +
        String(ts.getHours()).padStart(2, "0") + ":" + String(ts.getMinutes()).padStart(2, "0");
      const name = s.name ? '<span class="stock-name">' + esc(s.name) + '</span><span class="stock-code">' + esc(s.code) + "</span>"
        : '<span class="tag blind">双盲未揭晓</span>';
      return "<tr>" +
        '<td class="num">' + date + "</td>" +
        "<td>" + (PERIOD_LABEL[s.period] || s.period) + "</td>" +
        "<td>" + name + "</td>" +
        '<td class="num ' + pctClass(s.returnPct) + '">' + fmtPct(s.returnPct) + "</td>" +
        '<td class="num">' + (s.trades || 0) + "</td>" +
        '<td class="num">' + (s.trades ? (s.winRate || 0).toFixed(0) + "%" : "--") + "</td>" +
        '<td class="num">' + (s.profitFactor >= 99 ? "∞" : (s.profitFactor || 0).toFixed(2)) + "</td>" +
        '<td class="num">' + (s.maxDD || 0).toFixed(2) + "%</td>" +
        "<td>" + (s.completed ? '<span class="tag">完整200根</span>' : '<span class="tag">提前结束</span>') + "</td>" +
        "</tr>";
    }).join("");
    $("statsTable").innerHTML = '<table class="stats-table"><thead><tr>' +
      "<th>时间</th><th>周期</th><th>标的</th><th>收益率</th><th>交易</th><th>胜率</th><th>盈亏比</th><th>回撤</th><th>状态</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
  }

  function exportStats() {
    const sessions = state.stats.sessions || [];
    if (!sessions.length) { toast("还没有可以导出的记录"); return; }
    const header = ["时间", "周期", "股票代码", "股票名称", "收益率%", "交易次数", "胜率%", "盈亏比", "最大回撤%", "是否完整", "开始日期", "结束日期"];
    const lines = [header.join(",")];
    sessions.forEach((s) => {
      const row = [
        new Date(s.ts).toLocaleString("zh-CN"), PERIOD_LABEL[s.period] || s.period,
        s.code || "", s.name || "", s.returnPct, s.trades, s.winRate, s.profitFactor, s.maxDD,
        s.completed ? "是" : "否", s.startDate || "", s.endDate || "",
      ].map((v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"');
      lines.push(row.join(","));
    });
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "K线训练成绩_" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function resetStats() {
    if (!state.stats.sessions.length && !state.stats.quiz.total) { toast("没有需要清空的记录"); return; }
    if (!confirm("确定清空全部训练记录和形态测验成绩吗？此操作不可恢复。")) return;
    state.stats = defaultStats();
    saveStats();
    renderStats();
    refreshHero();
    toast("记录已清空");
  }

  /* ---------------------------------------------------------------
     启动
  --------------------------------------------------------------- */
  function boot() {
    bindTraining();
    syncIndicatorControls();
    refreshHero();
    $("btnExportStats").addEventListener("click", exportStats);
    $("btnResetStats").addEventListener("click", resetStats);
    document.querySelectorAll("#mainNav button").forEach((b) => {
      b.addEventListener("click", () => switchView(b.dataset.view));
    });
    const hash = (location.hash || "").replace("#", "").split("/")[0];
    if (["stats", "pattern"].includes(hash)) switchView(hash, false);
    startSession();
    if (window.KPattern) window.KPattern.activate();
  }

  window.KTrain = {
    $, api, toast, state, esc, fmtMoney, fmtNum, fmtPct, fmtVol, pctClass, debounce,
    saveStats, refreshHero, switchView, switchToStats: () => switchView("stats"),
    PERIOD_LABEL, PERIOD_ORDER, axisLabel,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
