/* =====================================================================
   K线训练营 · 形态图鉴 / 形态测验 / 截图分析
   ===================================================================== */
(function () {
  "use strict";
  const K = window.KTrain;
  const { $, api, toast, state, esc, fmtPct, fmtVol, pctClass, debounce } = K;
  const UP = "#ef4444";
  const DOWN = "#0aa678";

  const patternState = {
    tab: "atlas",
    loaded: false,
    loading: false,
    quiz: { period: "day", data: null, answered: false, loading: false, chart: null, zoomChart: null, number: 0 },
    shot: {
      images: [], activeId: null, mode: "cn", chart: null,
      drag: null, display: null,
    },
  };

  const DIR_TEXT = { bullish: "偏多", bearish: "偏空", neutral: "中性" };

  function dirText(d) { return DIR_TEXT[d] || "中性"; }
  function dirClass(d) { return d === "bullish" ? "bullish" : d === "bearish" ? "bearish" : "neutral"; }

  /* =================================================================
     形态图鉴
  ================================================================= */
  async function ensurePatterns() {
    if (patternState.loaded || patternState.loading) return;
    patternState.loading = true;
    $("atlasGrid").innerHTML = '<div class="atlas-empty">正在加载形态图鉴…</div>';
    try {
      const data = await api("/api/patterns");
      state.patterns = data.patterns || [];
      state.periods = data.periods || [];
      patternState.loaded = true;
      renderAtlas();
    } catch (err) {
      $("atlasGrid").innerHTML = "";
      $("atlasEmpty").hidden = false;
      $("atlasEmpty").textContent = "形态图鉴加载失败：" + err.message;
    } finally {
      patternState.loading = false;
    }
  }

  function renderAtlas() {
    const q = state.patternSearch.trim().toLowerCase();
    const filter = state.patternFilter;
    const list = (state.patterns || []).filter((p) => {
      if (filter !== "all" && p.category !== filter) return false;
      if (!q) return true;
      return (p.name + p.desc + p.category + p.key + (p.chapter || "")).toLowerCase().includes(q);
    });
    $("atlasEmpty").hidden = list.length > 0;
    $("atlasGrid").innerHTML = list.map((p) =>
      '<article class="atlas-card" data-key="' + esc(p.key) + '" tabindex="0">' +
      '<canvas class="atlas-canvas" data-key="' + esc(p.key) + '"></canvas>' +
      '<div class="atlas-body">' +
      '<div class="atlas-top"><span class="atlas-name">' + esc(p.name) + '</span>' +
      '<span class="atlas-cat" title="' + esc(p.chapter || "") + '">' +
      esc((p.chapter || "").split(" ")[0] || p.category) + "</span></div>" +
      '<p class="atlas-desc">' + esc(p.desc) + "</p>" +
      '<div class="atlas-foot"><span class="dir-pill ' + dirClass(p.direction) + '">' + dirText(p.direction) + "</span>" +
      '<span class="atlas-more">查看识别要点 →</span></div></div></article>'
    ).join("");
    requestAnimationFrame(() => {
      document.querySelectorAll("#atlasGrid .atlas-canvas").forEach((cv) => {
        drawPattern(cv, cv.dataset.key, false);
      });
    });
  }

  function patternSeries(key, n) {
    n = n || 50;
    const seed = hashStr(key);
    const rnd = mulberry32(seed);
    let points = null;
    switch (key) {
      case "double_bottom":
        points = [[0, 1.09], [.14, 1.02], [.26, 1.055], [.43, .955], [.54, 1.005], [.68, .96], [.82, 1.035], [1, 1.12]];
        break;
      case "double_top":
        points = [[0, .91], [.14, .98], [.26, .945], [.43, 1.045], [.54, .995], [.68, 1.04], [.82, .965], [1, .88]];
        break;
      case "head_shoulders_bottom":
        points = [[0, 1.08], [.12, 1.01], [.22, 1.055], [.36, .93], [.5, 1.005], [.61, .985], [.76, 1.035], [.88, 1.06], [1, 1.16]];
        break;
      case "head_shoulders_top":
        points = [[0, .91], [.12, .99], [.22, .945], [.36, 1.07], [.5, .995], [.61, 1.015], [.76, .965], [.88, .94], [1, .84]];
        break;
      case "ascending_triangle":
        points = [[0, .99], [.18, 1.03], [.34, .995], [.52, 1.03], [.68, 1.005], [.82, 1.028], [1, 1.12]];
        break;
      case "descending_triangle":
        points = [[0, 1.01], [.18, .97], [.34, 1.005], [.52, .97], [.68, .995], [.82, .972], [1, .88]];
        break;
      case "symmetrical_triangle":
        points = [[0, .94], [.2, 1.05], [.4, .975], [.6, 1.03], [.76, .995], [.9, 1.015], [1, 1.09]];
        break;
      case "bull_flag":
        points = [[0, .88], [.18, .9], [.38, 1.12], [.52, 1.06], [.65, 1.075], [.78, 1.045], [1, 1.18]];
        break;
      case "bear_flag":
        points = [[0, 1.12], [.18, 1.1], [.38, .88], [.52, .94], [.65, .925], [.78, .955], [1, .82]];
        break;
      case "rectangle":
        points = [[0, .98], [.16, 1.04], [.32, .975], [.48, 1.045], [.64, .98], [.8, 1.04], [1, 1.075]];
        break;
      case "cup_handle":
        points = [[0, 1.06], [.15, 1.015], [.35, .92], [.5, .905], [.66, .965], [.78, 1.045], [.87, 1.005], [1, 1.14]];
        break;
      case "rounding_bottom":
        points = [[0, 1.06], [.16, .99], [.34, .93], [.5, .915], [.66, .94], [.82, 1.0], [1, 1.1]];
        break;
      case "breakout":
        points = [[0, .98], [.25, .985], [.5, .975], [.7, .99], [.82, .98], [.9, 1.05], [1, 1.15]];
        break;
      default:
        points = null;
    }

    // K线组合：先构造趋势，再覆盖最后几根
    const bars = [];
    let price = 100 * (0.98 + rnd() * 0.04);
    if (points) {
      const vals = interpolate(points, n);
      for (let i = 0; i < n; i++) {
        const target = 100 * vals[i] * (1 + (rnd() - 0.5) * 0.008);
        const o = price;
        const c = i === 0 ? target : target;
        const h = Math.max(o, c) * (1 + rnd() * 0.009 + 0.003);
        const l = Math.min(o, c) * (1 - rnd() * 0.009 - 0.003);
        bars.push({ o, c, h, l });
        price = c;
      }
      return bars;
    }

    const decay = key === "hammer" || key === "bullish_engulfing" || key === "morning_star" ||
      key === "piercing" || key === "tweezer_bottom" || key === "three_soldiers" ? -1 :
      key === "shooting_star" || key === "bearish_engulfing" || key === "evening_star" ||
      key === "dark_cloud" || key === "tweezer_top" || key === "three_crows" ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const drift = decay * (i / n) * 0.035;
      const wave = Math.sin(i / 5.2) * 0.007;
      const target = 100 * (1 + drift + wave + (rnd() - 0.5) * 0.006);
      const o = i === 0 ? target : price;
      const c = target;
      const h = Math.max(o, c) * (1 + rnd() * 0.005 + 0.0015);
      const l = Math.min(o, c) * (1 - rnd() * 0.005 - 0.0015);
      bars.push({ o, c, h, l });
      price = c;
    }
    const p = bars[bars.length - 1].c;
    function setLast(k, o, c, h, l) {
      if (bars.length < k) return;
      bars[bars.length - k] = { o, c, h: Math.max(o, c, h), l: Math.min(o, c, l) };
    }
    switch (key) {
      case "hammer":
        setLast(1, p, p * 1.006, p * 1.008, p * 0.955);
        break;
      case "shooting_star":
        setLast(1, p, p * 0.994, p * 1.045, p * 0.992);
        break;
      case "doji":
        setLast(1, p, p * 1.0003, p * 1.018, p * 0.982);
        break;
      case "bullish_engulfing":
        setLast(2, p * 1.02, p * 0.99, p * 1.026, p * 0.986);
        setLast(1, p * 0.985, p * 1.025, p * 1.03, p * 0.98);
        break;
      case "bearish_engulfing":
        setLast(2, p * 0.98, p * 1.01, p * 1.014, p * 0.974);
        setLast(1, p * 1.015, p * 0.975, p * 1.02, p * 0.97);
        break;
      case "morning_star":
        setLast(3, p * 1.03, p * 0.985, p * 1.034, p * 0.98);
        setLast(2, p * 0.978, p * 0.982, p * 0.987, p * 0.971);
        setLast(1, p * 0.975, p * 1.018, p * 1.022, p * 0.972);
        break;
      case "evening_star":
        setLast(3, p * 0.97, p * 1.015, p * 1.02, p * 0.966);
        setLast(2, p * 1.022, p * 1.018, p * 1.03, p * 1.013);
        setLast(1, p * 1.02, p * 0.982, p * 1.025, p * 0.975);
        break;
      case "three_soldiers":
        setLast(3, p * 0.97, p * 0.99, p * 0.995, p * 0.965);
        setLast(2, p * 0.985, p * 1.01, p * 1.015, p * 0.98);
        setLast(1, p * 1.005, p * 1.035, p * 1.04, p * 1.0);
        break;
      case "three_crows":
        setLast(3, p * 1.03, p * 1.01, p * 1.035, p * 1.005);
        setLast(2, p * 1.015, p * 0.99, p * 1.02, p * 0.985);
        setLast(1, p * 0.995, p * 0.965, p * 0.998, p * 0.96);
        break;
      case "harami":
        setLast(2, p * 1.045, p * 0.982, p * 1.05, p * 0.976);
        setLast(1, p * 0.995, p * 1.012, p * 1.018, p * 0.99);
        break;
      case "piercing":
        setLast(2, p * 1.035, p * 0.975, p * 1.04, p * 0.97);
        setLast(1, p * 0.968, p * 1.018, p * 1.023, p * 0.963);
        break;
      case "dark_cloud":
        setLast(2, p * 0.965, p * 1.025, p * 1.03, p * 0.96);
        setLast(1, p * 1.03, p * 0.982, p * 1.036, p * 0.977);
        break;
      case "tweezer_bottom":
        setLast(2, p * 1.005, p * 0.97, p * 1.01, p * 0.955);
        setLast(1, p * 0.972, p * 1.005, p * 1.01, p * 0.9552);
        break;
      case "tweezer_top":
        setLast(2, p * 0.995, p * 1.03, p * 1.045, p * 0.99);
        setLast(1, p * 1.028, p * 0.995, p * 1.0452, p * 0.99);
        break;
    }
    return bars;
  }

  function interpolate(points, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let a = points[0], b = points[points.length - 1];
      for (let j = 0; j < points.length - 1; j++) {
        if (t >= points[j][0] && t <= points[j + 1][0]) { a = points[j]; b = points[j + 1]; break; }
      }
      const f = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
      out.push(a[1] + (b[1] - a[1]) * f);
    }
    return out;
  }

  function drawPattern(canvas, key, big) {
    const rect = canvas.getBoundingClientRect();
    let cssW = rect.width || (big ? 360 : 260);
    let cssH = rect.height || (big ? 165 : 128);
    if (cssW < 20) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = big ? "#fbfcff" : "#fbfcff";
    ctx.fillRect(0, 0, cssW, cssH);
    // 网格
    ctx.strokeStyle = "rgba(140,160,195,.13)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = cssH * i / 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke();
    }
    const bars = patternSeries(key, big ? 62 : 48);
    let hi = -Infinity, lo = Infinity;
    bars.forEach((b) => { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); });
    const padTop = cssH * 0.12, padBottom = cssH * 0.12, padX = cssW * 0.045;
    const plotW = cssW - padX * 2, plotH = cssH - padTop - padBottom;
    const yOf = (v) => padTop + (hi - v) / (hi - lo) * plotH;
    const step = plotW / bars.length;
    const cw = Math.max(1.4, Math.min(big ? 5 : 3.4, step * 0.58));
    // 右侧高亮
    const grad = ctx.createLinearGradient(cssW * 0.7, 0, cssW, 0);
    grad.addColorStop(0, "rgba(47,107,255,0)");
    grad.addColorStop(1, "rgba(47,107,255,.055)");
    ctx.fillStyle = grad;
    ctx.fillRect(cssW * 0.7, 0, cssW * 0.3, cssH);
    bars.forEach((b, i) => {
      const x = padX + step * i + step / 2;
      const bull = b.c >= b.o;
      ctx.strokeStyle = bull ? UP : DOWN;
      ctx.fillStyle = bull ? UP : DOWN;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(b.h));
      ctx.lineTo(x, yOf(b.l));
      ctx.stroke();
      const y1 = yOf(Math.max(b.o, b.c));
      const y2 = yOf(Math.min(b.o, b.c));
      const bh = Math.max(1.2, y2 - y1);
      ctx.fillRect(x - cw / 2, y1, cw, bh);
    });
    ctx.fillStyle = "rgba(120,135,160,.45)";
    ctx.font = "8px -apple-system, sans-serif";
    ctx.fillText("形态示意", padX, 14);
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function openPattern(key) {
    const p = (state.patterns || []).find((x) => x.key === key);
    if (!p) return;
    $("modalCat").textContent = p.category;
    $("modalName").textContent = p.name;
    $("modalChapter").textContent = p.chapter || "";
    $("modalChapterText").textContent = p.chapter || "第4–6、12章";
    $("modalTarget").textContent = p.target || "按形态高度/旗杆高度估算，需等突破确认";
    $("modalVolume").textContent = p.volume || "突破时放量更可靠";
    const dEl = $("modalDirection");
    dEl.textContent = dirText(p.direction);
    dEl.className = "direction-pill " + dirClass(p.direction);
    $("modalDesc").textContent = p.desc;
    $("modalPoints").innerHTML = (p.points || []).map((x) => "<li>" + esc(x) + "</li>").join("");
    $("modalEntry").textContent = p.entry || "等待形态确认后再行动";
    $("modalInvalid").textContent = p.invalid || "形态失败时及时止损";
    $("patternModal").hidden = false;
    requestAnimationFrame(() => drawPattern($("modalThumb"), key, true));
  }

  function bindAtlas() {
    $("atlasFilters").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-filter]");
      if (!b) return;
      state.patternFilter = b.dataset.filter;
      document.querySelectorAll("#atlasFilters button").forEach((x) => x.classList.toggle("active", x === b));
      renderAtlas();
    });
    $("atlasSearch").addEventListener("input", debounce((e) => {
      state.patternSearch = e.target.value || "";
      renderAtlas();
    }, 120));
    $("atlasGrid").addEventListener("click", (e) => {
      const card = e.target.closest(".atlas-card");
      if (card) openPattern(card.dataset.key);
    });
    $("atlasGrid").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const card = e.target.closest(".atlas-card");
      if (card) openPattern(card.dataset.key);
    });
    $("btnClosePattern").addEventListener("click", () => { $("patternModal").hidden = true; });
    $("patternModal").addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) $("patternModal").hidden = true;
    });
    $("btnMurphyNotes").addEventListener("click", () => { $("murphyModal").hidden = false; });
    $("btnCloseMurphy").addEventListener("click", () => { $("murphyModal").hidden = true; });
    $("murphyModal").addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) $("murphyModal").hidden = true;
    });
  }

  /* =================================================================
     形态测验
  ================================================================= */
  function quizStats() {
    if (!state.stats.quiz) state.stats.quiz = { total: 0, correct: 0, streak: 0, best: 0 };
    return state.stats.quiz;
  }

  function updateQuizScoreUI() {
    const q = quizStats();
    const acc = q.total ? (q.correct / q.total * 100).toFixed(0) + "%" : "--";
    $("quizAccuracy").textContent = acc;
    $("quizStreak").textContent = q.streak;
    $("psTotal").textContent = q.total;
    $("psCorrect").textContent = q.correct;
    $("psBest").textContent = q.best;
  }

  async function loadQuiz() {
    if (patternState.quiz.loading) return;
    patternState.quiz.loading = true;
    patternState.quiz.answered = false;
    patternState.quiz.data = null;
    $("quizLoading").hidden = false;
    $("quizFeedback").hidden = true;
    $("quizOptions").innerHTML = "";
    $("btnNextQuiz").disabled = true;
    $("quizHint").textContent = "蓝框是本题范围，右侧是同一区域的放大图；左侧K线只作趋势背景。";
    try {
      const data = await api("/api/training/quiz?period=" + encodeURIComponent(patternState.quiz.period));
      patternState.quiz.data = data;
      $("quizLoading").hidden = true;
      const focus = Math.min(Number(data.focus) || 55, (data.bars || []).length);
      $("quizFocusLabel").textContent = "最后 " + focus + " 根";
      $("quizHint").textContent = data.hint || "只看蓝框内的K线，左侧只作趋势背景。";
      renderQuizChart(data.bars || [], focus);
      renderQuizZoom(data.bars || [], focus);
      renderQuizOptions(data.options || []);
      patternState.quiz.number = quizStats().total + 1;
      $("quizProgressText").textContent = "第 " + patternState.quiz.number + " 题";
      $("btnNextQuiz").disabled = true;
      updateQuizScoreUI();
      if (patternState.tab === "quiz") setTimeout(() => {
        if (patternState.quiz.chart) patternState.quiz.chart.resize();
        if (patternState.quiz.zoomChart) patternState.quiz.zoomChart.resize();
      }, 80);
    } catch (err) {
      $("quizLoading").hidden = true;
      $("quizOptions").innerHTML = "";
      $("quizFeedback").hidden = false;
      $("quizFeedback").innerHTML = '<div class="feedback-head"><span class="no">出题失败</span></div><p>' +
        esc(err.message || "请稍后重试") + "</p>";
      $("btnNextQuiz").disabled = false;
    } finally {
      patternState.quiz.loading = false;
    }
  }

  function renderQuizChart(bars, focus) {
    const el = $("quizChart");
    if (!patternState.quiz.chart) {
      patternState.quiz.chart = echarts.init(el, null, { renderer: "canvas" });
    }
    const n = bars.length;
    const f = Math.min(Math.max(1, Number(focus) || 55), n);
    const start = n - f;
    const labels = bars.map((_, i) => String(i + 1));
    const candle = bars.map((b) => [b.o, b.c, b.l, b.h]);
    const vols = bars.map((b) => ({ value: b.v, itemStyle: { color: b.c >= b.o ? "rgba(239,68,68,.5)" : "rgba(10,166,120,.5)" } }));
    const last = bars[bars.length - 1];
    const lineData = [];
    if (last) lineData.push({ yAxis: last.c, lineStyle: { color: "rgba(150,170,200,.4)", type: "dashed" }, label: { show: false } });
    lineData.push({ xAxis: labels[start], lineStyle: { color: "rgba(138,174,255,.75)", type: "dashed", width: 1 }, label: { show: false } });
    patternState.quiz.chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: [
        { left: 14, right: 58, top: 14, height: "63%" },
        { left: 14, right: 58, top: "78%", height: "12%" },
      ],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", lineStyle: { color: "#5d6d87", type: "dashed" } },
        backgroundColor: "rgba(14,22,39,.96)", borderWidth: 0,
        textStyle: { color: "#dbe5f6", fontSize: 11 },
        formatter: (ps) => {
          if (!ps || !ps.length) return "";
          const b = bars[ps[0].dataIndex];
          if (!b) return "";
          return "开 " + b.o.toFixed(2) + "　高 " + b.h.toFixed(2) + "<br/>低 " + b.l.toFixed(2) + "　收 " + b.c.toFixed(2);
        },
      },
      xAxis: [
        { type: "category", data: labels, boundaryGap: true, axisLine: { lineStyle: { color: "rgba(130,150,180,.22)" } }, axisLabel: { show: false }, axisTick: { show: false } },
        { type: "category", data: labels, boundaryGap: true, gridIndex: 1, axisLine: { lineStyle: { color: "rgba(130,150,180,.18)" } }, axisLabel: { show: false }, axisTick: { show: false } },
      ],
      yAxis: [
        { scale: true, position: "right", axisLabel: { color: "#70809a", fontSize: 9 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "rgba(130,150,180,.1)", type: "dashed" } } },
        { scale: true, gridIndex: 1, position: "right", axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      ],
      graphic: [{
        type: "text", left: 18, top: 3,
        style: { text: "蓝框 = 题目区域", fill: "#7f96c0", font: "9px -apple-system, sans-serif" },
      }],
      series: [
        {
          type: "candlestick", data: candle, itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN, borderWidth: 1 },
          markLine: { silent: true, symbol: "none", data: lineData },
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(72,118,255,.12)", borderColor: "rgba(115,155,255,.55)", borderWidth: 1 },
            label: { show: true, position: "insideTop", color: "#9abaff", fontSize: 9, formatter: "题目区域" },
            data: [[{ xAxis: labels[start] }, { xAxis: labels[n - 1] }]],
          },
        },
        { type: "line", data: bars.map((b, i) => {
          if (i < 4) return null;
          let s = 0; for (let j = i - 4; j <= i; j++) s += bars[j].c;
          return s / 5;
        }), symbol: "none", lineStyle: { width: 1, color: "rgba(255,209,102,.65)" } },
        { type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vols, barWidth: "52%" },
      ],
    }, true);
  }

  function renderQuizZoom(bars, focus) {
    const n = bars.length;
    const f = Math.min(Math.max(1, Number(focus) || 55), n);
    const zoomBars = bars.slice(n - f);
    const el = $("quizZoom");
    if (!patternState.quiz.zoomChart) {
      patternState.quiz.zoomChart = echarts.init(el, null, { renderer: "canvas" });
    }
    const last = zoomBars[zoomBars.length - 1];
    patternState.quiz.zoomChart.setOption({
      animation: false,
      backgroundColor: "transparent",
      grid: { left: 5, right: 5, top: 8, bottom: 6 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(14,22,39,.96)", borderWidth: 0,
        textStyle: { color: "#dbe5f6", fontSize: 10 },
        formatter: (ps) => {
          if (!ps || !ps.length) return "";
          const b = zoomBars[ps[0].dataIndex];
          return b ? "开 " + b.o.toFixed(2) + " 高 " + b.h.toFixed(2) + "<br/>低 " + b.l.toFixed(2) + " 收 " + b.c.toFixed(2) : "";
        },
      },
      xAxis: { type: "category", data: zoomBars.map((_, i) => i + 1), boundaryGap: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } },
      yAxis: { scale: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
      series: [{
        type: "candlestick", data: zoomBars.map((b) => [b.o, b.c, b.l, b.h]),
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN, borderWidth: 1 },
        markLine: last ? { silent: true, symbol: "none", data: [{ yAxis: last.c, lineStyle: { color: "rgba(150,170,200,.4)", type: "dashed" }, label: { show: false } }] } : undefined,
      }],
    }, true);
  }

  function renderQuizOptions(options) {
    const letters = ["A", "B", "C", "D", "E", "F"];
    $("quizOptions").innerHTML = options.map((o, i) =>
      '<button class="quiz-option" data-key="' + esc(o.key) + '">' +
      '<span class="opt-index">' + (letters[i] || i + 1) + '</span>' +
      '<span class="opt-name">' + esc(o.name) + "</span></button>"
    ).join("");
    $("quizOptions").querySelectorAll(".quiz-option").forEach((btn) => {
      btn.addEventListener("click", () => answerQuiz(btn.dataset.key, btn));
    });
  }

  async function answerQuiz(key, btn) {
    if (patternState.quiz.answered || !patternState.quiz.data) return;
    patternState.quiz.answered = true;
    const all = $("quizOptions").querySelectorAll(".quiz-option");
    all.forEach((b) => { b.disabled = true; });
    btn.style.opacity = ".7";
    try {
      const res = await api("/api/training/quiz/answer", {
        method: "POST",
        body: { id: patternState.quiz.data.id, choice: key },
      });
      const answer = res.answer || {};
      all.forEach((b) => {
        if (b.dataset.key === answer.key) b.classList.add("correct");
        else if (b.dataset.key === key && !res.correct) b.classList.add("wrong");
      });
      const q = quizStats();
      q.total += 1;
      if (res.correct) {
        q.correct += 1;
        q.streak = (q.streak || 0) + 1;
        q.best = Math.max(q.best || 0, q.streak);
      } else {
        q.streak = 0;
      }
      K.saveStats();
      updateQuizScoreUI();
      $("btnNextQuiz").disabled = false;
      const stock = res.stock || {};
      const a = res.answer || {};
      const trend = (res.analysis || {}).trend || {};
      $("quizFeedback").hidden = false;
      $("quizFeedback").innerHTML =
        '<div class="feedback-head"><span class="' + (res.correct ? "ok" : "no") + '">' +
        (res.correct ? "✓ 判断正确" : "✕ 再想想") + "</span>" +
        '<span style="font-weight:400;font-size:10px;color:var(--faint)">正确答案：' + esc(a.name) + "</span></div>" +
        "<p><b>" + esc(a.category || "") + "</b> · " + esc(a.desc || "") + "</p>" +
        "<p><b>识别要点：</b>" + (a.points || []).slice(0, 2).map(esc).join("；") + "</p>" +
        "<p><b>确认 / 失效：</b>" + esc(a.entry || "") + "；若" + esc(a.invalid || "形态破坏") + "。</p>" +
        "<p><b>书中章节：</b>" + esc(a.chapter || "") + "；<b>测算目标：</b>" + esc(a.target || "") +
        "；<b>量能：</b>" + esc(a.volume || "") + "</p>" +
        '<p style="font-size:9px;color:var(--faint)">案例：' + esc(stock.name || "") + " " + esc(stock.code || "") +
        " · " + esc(stock.start_date || "") + " → " + esc(stock.end_date || "") + " · " + esc(stock.period || "") + "</p>" +
        '<div class="feedback-tags">' +
        '<span>趋势：' + esc(trend.phase || "--") + "</span>" +
        '<span>倾向：' + esc((res.analysis || {}).bias || "--") + "</span>" +
        '<span>匹配度：' + Number((res.analysis || {}).confidence || 0).toFixed(0) + "%</span>" +
        "</div>";
    } catch (err) {
      $("quizFeedback").hidden = false;
      $("quizFeedback").innerHTML = '<div class="feedback-head"><span class="no">提交失败</span></div><p>' + esc(err.message) + "</p>";
      patternState.quiz.answered = false;
    }
  }

  function bindQuiz() {
    $("quizOptions").addEventListener("click", () => { /* handled per-button */ });
    $("btnNextQuiz").addEventListener("click", loadQuiz);
    $("quizPeriod").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-p]");
      if (!b) return;
      patternState.quiz.period = b.dataset.p;
      document.querySelectorAll("#quizPeriod button").forEach((x) => x.classList.toggle("active", x === b));
      loadQuiz();
    });
  }

  /* =================================================================
     截图分析
  ================================================================= */
  function shotActive() {
    return patternState.shot.images.find((x) => x.id === patternState.shot.activeId) || null;
  }

  async function addShotFiles(files) {
    const arr = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!arr.length) return;
    if (patternState.shot.images.length >= 8) { toast("最多同时分析 8 张截图"); return; }
    for (const file of arr.slice(0, 8 - patternState.shot.images.length)) {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      if (!img) { URL.revokeObjectURL(url); continue; }
      const id = "img_" + Math.random().toString(36).slice(2, 9);
      const item = {
        id, name: file.name || "截图", url, img,
        crop: { x: 0.03, y: 0.03, w: 0.94, h: 0.94 },
        result: null, status: "new",
      };
      patternState.shot.images.push(item);
      if (!patternState.shot.activeId) patternState.shot.activeId = id;
    }
    $("shotDrop").hidden = true;
    $("shotWorkspace").hidden = false;
    renderShotThumbs();
    const active = shotActive();
    if (active) {
      try {
        const crop = autoDetectCrop(active.img);
        if (crop) active.crop = crop;
      } catch (e) { /* ignore */ }
      await selectShot(active.id);
    }
  }

  function loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function selectShot(id) {
    patternState.shot.activeId = id;
    renderShotThumbs();
    const item = shotActive();
    if (!item) return;
    $("shotRebuild").hidden = true;
    renderShotResult(item);
    requestAnimationFrame(() => renderShotCanvas());
  }

  function renderShotThumbs() {
    const box = $("shotThumbs");
    box.innerHTML = patternState.shot.images.map((it) =>
      '<button class="shot-thumb ' + (it.id === patternState.shot.activeId ? "active" : "") + '" data-id="' + it.id + '" title="' + esc(it.name) + '">' +
      '<img src="' + it.url + '" alt="">' +
      '<span class="thumb-state ' + (it.status === "done" ? "done" : it.status === "fail" ? "fail" : "") + '"></span></button>'
    ).join("");
    box.querySelectorAll(".shot-thumb").forEach((b) => {
      b.addEventListener("click", () => selectShot(b.dataset.id));
    });
  }

  function renderShotCanvas() {
    const item = shotActive();
    if (!item || !$("shotWorkspace") || $("shotWorkspace").hidden) return;
    const canvas = $("shotCanvas");
    const stage = $("shotStage");
    const availW = Math.max(280, stage.clientWidth - 4);
    const availH = 600;
    let scale = Math.min(availW / item.img.naturalWidth, availH / item.img.naturalHeight);
    scale = Math.min(scale, 1.4);
    const cssW = Math.max(160, Math.round(item.img.naturalWidth * scale));
    const cssH = Math.max(120, Math.round(item.img.naturalHeight * scale));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.drawImage(item.img, 0, 0, cssW, cssH);
    patternState.shot.display = { w: cssW, h: cssH };
    drawDetectedBoxes(ctx, item, cssW, cssH);
    positionCrop(item, canvas, cssW, cssH);
    if (patternState.shot.chart) patternState.shot.chart.resize();
  }

  function drawDetectedBoxes(ctx, item, cssW, cssH) {
    if (!item.result || !item.result.extract) return;
    const ex = item.result.extract;
    if (!ex.boxes || !ex.boxes.length) return;
    const cw = item.crop.w * cssW, ch = item.crop.h * cssH;
    const ox = item.crop.x * cssW, oy = item.crop.y * cssH;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(90,225,200,.9)";
    ctx.fillStyle = "rgba(90,225,200,.10)";
    ex.boxes.forEach((b) => {
      const x = ox + b.x * cw;
      const y = oy + b.y * ch;
      const w = b.w * cw;
      const h = b.h * ch;
      if (w < 1 || h < 1) return;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + .5, y + .5, Math.max(1, w - 1), Math.max(1, h - 1));
    });
    ctx.restore();
  }

  function positionCrop(item, canvas, cssW, cssH) {
    const crop = $("shotCrop");
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    const c = item.crop;
    crop.style.left = (ox + c.x * cssW) + "px";
    crop.style.top = (oy + c.y * cssH) + "px";
    crop.style.width = (c.w * cssW) + "px";
    crop.style.height = (c.h * cssH) + "px";
  }

  function bindCrop() {
    const crop = $("shotCrop");
    crop.addEventListener("pointerdown", (e) => {
      if (!shotActive()) return;
      const handle = e.target.closest(".crop-handle");
      patternState.shot.drag = {
        mode: handle ? handle.className.split(" ").filter((c) => ["nw", "ne", "sw", "se"].includes(c))[0] : "move",
        startX: e.clientX, startY: e.clientY,
        crop: Object.assign({}, shotActive().crop),
        w: patternState.shot.display ? patternState.shot.display.w : 1,
        h: patternState.shot.display ? patternState.shot.display.h : 1,
      };
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener("pointermove", (e) => {
      const d = patternState.shot.drag;
      if (!d) return;
      const dx = (e.clientX - d.startX) / d.w;
      const dy = (e.clientY - d.startY) / d.h;
      let { x, y, w, h } = d.crop;
      const min = 0.06;
      if (d.mode === "move") {
        x = clamp(x + dx, 0, 1 - w);
        y = clamp(y + dy, 0, 1 - h);
      } else {
        if (d.mode.includes("w")) {
          const nx = clamp(x + dx, 0, x + w - min);
          w = w + (x - nx); x = nx;
        }
        if (d.mode.includes("e")) {
          w = clamp(w + dx, min, 1 - x);
        }
        if (d.mode.includes("n")) {
          const ny = clamp(y + dy, 0, y + h - min);
          h = h + (y - ny); y = ny;
        }
        if (d.mode.includes("s")) {
          h = clamp(h + dy, min, 1 - y);
        }
      }
      const item = shotActive();
      if (item) {
        item.crop = { x: x, y: y, w: w, h: h };
        positionCrop(item, $("shotCanvas"), d.w, d.h);
        // 移动框选后旧的识别结果不再可靠
        if (item.status === "done") {
          item.status = "new";
          renderShotThumbs();
        }
      }
    });
    window.addEventListener("pointerup", () => {
      const had = !!patternState.shot.drag;
      patternState.shot.drag = null;
      if (!had) return;
      const item = shotActive();
      if (item && item.status === "new") {
        item.result = null;
        renderShotResult(item);
        renderShotCanvas();
      }
    });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function autoCropActive() {
    const item = shotActive();
    if (!item) return;
    try {
      const crop = autoDetectCrop(item.img);
      if (!crop) { toast("没有找到明显的K线区域，请手动框选"); return; }
      item.crop = crop;
      item.status = "new";
      item.result = null;
      renderShotThumbs();
      renderShotCanvas();
      renderShotResult(item);
      toast("已自动框选价格K线区域");
    } catch (e) {
      toast("自动框选失败，请手动框选");
    }
  }

  function autoDetectCrop(img) {
    const maxW = 1000;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.max(3, Math.round(img.naturalWidth * scale));
    const h = Math.max(3, Math.round(img.naturalHeight * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const rowCounts = new Uint32Array(h);
    const colCounts = new Uint32Array(w);
    const mode = patternState.shot.mode;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!isChartColor(data[i], data[i + 1], data[i + 2])) continue;
        // 忽略过暗的像素（深色背景上的阴影）
        if (data[i] + data[i + 1] + data[i + 2] < 130) continue;
        rowCounts[y]++; colCounts[x]++;
      }
    }
    const threshold = Math.max(3, w * 0.002);
    const bands = [];
    let start = -1, gap = 0, sum = 0;
    for (let y = 0; y < h; y++) {
      if (rowCounts[y] >= threshold) {
        if (start < 0) { start = y; sum = 0; }
        gap = 0; sum += rowCounts[y];
      } else if (start >= 0) {
        gap++;
        if (gap > 5) {
          bands.push({ y0: start, y1: y - gap, sum });
          start = -1;
        }
      }
    }
    if (start >= 0) bands.push({ y0: start, y1: h - 1, sum });
    const valid = bands.filter((b) => (b.y1 - b.y0) > h * 0.07 && b.sum > threshold * 4);
    if (!valid.length) return null;
    let bestScore = 0;
    valid.forEach((b) => {
      b.h = b.y1 - b.y0;
      b.score = b.sum * Math.min(1.8, b.h / (h * 0.35));
      bestScore = Math.max(bestScore, b.score);
    });
    // 价格图通常在成交量和指标上方：在得分不差太多的候选里取最靠上的
    const candidates = valid.filter((b) => b.score >= bestScore * 0.45).sort((a, b) => a.y0 - b.y0);
    const band = candidates[0] || valid.sort((a, b) => b.score - a.score)[0];
    const xs = [];
    for (let x = 0; x < w; x++) if (colCounts[x] > 1) xs.push(x);
    if (xs.length < 10) return null;
    const x0 = xs[Math.floor(xs.length * 0.015)];
    const x1 = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.985))];
    const padX = w * 0.012, padY = h * 0.008;
    return {
      x: Math.max(0, (x0 - padX) / w),
      y: Math.max(0, (band.y0 - padY) / h),
      w: Math.min(1, (x1 - x0 + padX * 2) / w),
      h: Math.min(1, (band.h + padY * 2) / h),
    };
  }

  function isChartColor(r, g, b) {
    const red = r > 78 && r - g > 24 && r - b > 18 && r > g * 1.16;
    const green = g > 62 && g - r > 20 && g - b > 7 && g > r * 1.12;
    // 通达信经典配色常用「红涨 + 青色跌」，一并识别青色/蓝绿色K线
    const cyan = Math.max(g, b) > 95 && Math.max(g, b) - r > 30 &&
      Math.abs(g - b) < 80 && Math.min(g, b) > 60;
    return red || green || cyan;
  }

  function extractCandles(img, crop, mode) {
    const sx = crop.x * img.naturalWidth;
    const sy = crop.y * img.naturalHeight;
    const sw = Math.max(12, crop.w * img.naturalWidth);
    const sh = Math.max(12, crop.h * img.naturalHeight);
    const maxW = 1500;
    const sc = Math.min(1, maxW / sw);
    const w = Math.max(12, Math.round(sw * sc));
    const h = Math.max(12, Math.round(sh * sc));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (isChartColor(data[i], data[i + 1], data[i + 2]) &&
            data[i] + data[i + 1] + data[i + 2] > 120) {
          mask[y * w + x] = 1;
        }
      }
    }
    // 只保留竖直连续 >=4px 的像素，滤掉均线与指标线
    const valid = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (!mask[y * w + x]) { y++; continue; }
        const s = y;
        while (y < h && mask[y * w + x]) y++;
        if (y - s >= 4) {
          for (let yy = s; yy < y; yy++) valid[yy * w + x] = 1;
        }
      }
    }
    const groups = [];
    const colHas = new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (valid[y * w + x]) { colHas[x] = 1; break; }
      }
    }
    let gs = -1;
    for (let x = 0; x <= w; x++) {
      const has = x < w && colHas[x];
      if (has && gs < 0) gs = x;
      if ((!has || x === w) && gs >= 0) {
        const ge = x - 1;
        if (ge - gs + 1 <= 28) {
          const comp = componentStats(valid, w, h, gs, ge, mode, data);
          if (comp) groups.push(comp);
        }
        gs = -1;
      }
    }
    if (groups.length < 8) {
      throw new Error("没有识别到足够的K线柱体。请只框住价格K线区域，避开成交量、指标副图和文字；也可以换一张更清晰的截图。");
    }
    groups.sort((a, b) => a.cx - b.cx);
    // 按横向间距聚类，剔除右侧文字/图例
    const gaps = [];
    for (let i = 1; i < groups.length; i++) {
      const g = groups[i].cx - groups[i - 1].cx;
      if (g > 0) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 5;
    const splitGap = Math.max(6, medianGap * 3.6);
    let clusters = [], cur = [groups[0]];
    for (let i = 1; i < groups.length; i++) {
      if (groups[i].cx - groups[i - 1].cx > splitGap) { clusters.push(cur); cur = []; }
      cur.push(groups[i]);
    }
    clusters.push(cur);
    clusters.sort((a, b) => b.length - a.length);
    let use = clusters[0] || groups;
    if (use.length > 320) use = use.slice(-320);
    // 去掉中心过近的重复柱体
    const dedup = [];
    use.forEach((c) => {
      const last = dedup[dedup.length - 1];
      if (last && c.cx - last.cx < Math.max(1.2, medianGap * 0.28)) {
        if (c.area > last.area) dedup[dedup.length - 1] = c;
      } else dedup.push(c);
    });
    use = dedup;
    if (use.length < 12) {
      throw new Error("还原出的K线太少（不足 12 根）。请把框选范围缩到价格K线主体，避开左右两侧的空白与文字。");
    }
    const bars = [];
    const boxes = [];
    // 截图像素没有真实价格轴，这里映射为“图内相对价格”：
    // 纵轴底部 100、顶部 150，保留形态但避免把像素高度误当成真实涨跌幅。
    const p = (y) => 100 + (h - y) / h * 50;
    use.forEach((c) => {
      let high = p(c.y0), low = p(c.y1);
      let bodyTop = c.bodyTop >= 0 ? p(c.bodyTop) : p((c.y0 + c.y1) / 2);
      let bodyBottom = c.bodyBottom >= 0 ? p(c.bodyBottom) : p((c.y0 + c.y1) / 2);
      if (bodyBottom > bodyTop) { const t = bodyTop; bodyTop = bodyBottom; bodyBottom = t; }
      const isDoji = Math.abs(c.bodyBottom - c.bodyTop) < 1.8;
      const bull = mode === "cn" ? c.red >= c.green : c.green >= c.red;
      let o, cl;
      if (isDoji) { o = cl = (bodyTop + bodyBottom) / 2; }
      else if (bull) { cl = bodyTop; o = bodyBottom; }
      else { o = bodyTop; cl = bodyBottom; }
      bars.push({ o: round3(o), h: round3(Math.max(high, o, cl)), l: round3(Math.min(low, o, cl)), c: round3(cl), v: 0 });
      boxes.push({ x: c.x0 / w, y: c.y0 / h, w: (c.x1 - c.x0 + 1) / w, h: (c.y1 - c.y0 + 1) / h });
    });
    return {
      bars,
      boxes,
      meta: { width: w, height: h, count: bars.length, medianGap: medianGap },
    };
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  function columnHas(valid, w, h, x) {
    for (let y = 0; y < h; y++) if (valid[y * w + x]) return true;
    return false;
  }

  function componentStats(valid, w, h, x0, x1, mode, pixels) {
    let y0 = h, y1 = -1, area = 0, red = 0, green = 0;
    const rows = new Map();
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < h; y++) {
        if (!valid[y * w + x]) continue;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        area++;
      }
    }
    if (y1 < 0 || y1 - y0 < 3) return null;
    const gw = x1 - x0 + 1;
    for (let yy = 0; yy < h; yy++) {
      let minx = 1e9, maxx = -1, cnt = 0;
      for (let xx = 0; xx < gw; xx++) {
        if (!valid[yy * w + x0 + xx]) continue;
        const idx = (yy * w + x0 + xx) * 4;
        const rr = pixels[idx], gg = pixels[idx + 1], bb = pixels[idx + 2];
        if (isChartColor(rr, gg, bb)) {
          const redPx = rr > 78 && rr - gg > 24 && rr - bb > 18 && rr > gg * 1.16;
          if (redPx) red++; else green++;
        }
        if (xx < minx) minx = xx;
        if (xx > maxx) maxx = xx;
        cnt++;
      }
      if (cnt) rows.set(yy, { w: maxx - minx + 1, cnt });
    }
    let bodyTop = -1, bodyBottom = -1;
    const thresh = Math.max(2, gw * 0.5);
    rows.forEach((r, y) => {
      if (r.w >= thresh) {
        if (bodyTop < 0) bodyTop = y;
        bodyBottom = y;
      }
    });
    if (bodyTop < 0) {
      const mid = Math.round((y0 + y1) / 2);
      bodyTop = bodyBottom = mid;
    }
    return {
      x0, x1, y0, y1, area, red, green,
      cx: (x0 + x1) / 2,
      bodyTop, bodyBottom,
    };
  }

  async function analyzeShot() {
    const item = shotActive();
    if (!item) return;
    const box = $("shotResult");
    box.innerHTML = '<div class="shot-loading"><span class="spinner"></span><b>正在还原K线并匹配形态…</b></div>';
    try {
      const extract = extractCandles(item.img, item.crop, patternState.shot.mode);
      if (!extract.bars.length) throw new Error("没有还原出K线");
      const data = await api("/api/pattern/analyze", {
        method: "POST",
        body: { bars: extract.bars },
      });
      if (!data.ok) throw new Error(data.error || "形态分析失败");
      item.result = { analysis: data, extract, error: null };
      item.status = "done";
      renderShotThumbs();
      renderShotResult(item);
      renderShotCanvas();
      renderShotRebuild(extract.bars);
    } catch (err) {
      item.result = { error: err.message || "识别失败" };
      item.status = "fail";
      renderShotThumbs();
      renderShotResult(item);
    }
  }

  function renderShotResult(item) {
    const box = $("shotResult");
    const rebuild = $("shotRebuild");
    if (!item) return;
    if (!item.result) {
      rebuild.hidden = true;
      box.innerHTML = '<div class="shot-result-empty"><div class="result-empty-icon">⌁</div><b>等待识别</b>' +
        "<p>框好价格K线区域后点击「识别并分析」，系统会从像素中还原 OHLC，再匹配技术形态。</p>" +
        "<ul><li>截图越清晰，识别越准确</li><li>只框价格K线，避开成交量副图和文字</li><li>识别结果可在下方重建图中核对</li></ul></div>";
      return;
    }
    if (item.result.error) {
      rebuild.hidden = true;
      box.innerHTML = '<div class="shot-err"><b>没有识别成功</b>' + esc(item.result.error) +
        "<br><br>建议：只框价格K线区域；不要包含成交量副图、指标线标题；截图尽量清晰、不要压缩过度。</div>";
      return;
    }
    const d = item.result.analysis;
    const last = d.levels ? d.levels.last : 0;
    const sup = d.levels ? ((d.levels.support / last - 1) * 100) : 0;
    const res = d.levels ? ((d.levels.resistance / last - 1) * 100) : 0;
    const dirCls = d.bias_dir === "bullish" ? "bullish" : d.bias_dir === "bearish" ? "bearish" : "neutral";
    const matches = (d.matches || []).slice(0, 5);
    box.innerHTML = '<div class="shot-result-data">' +
      '<div class="shot-bias-box"><div><div class="shot-bias-label">综合判断</div><div class="shot-bias-value ' + dirCls + '">' + esc(d.bias) + "</div></div>" +
      '<div class="shot-conf"><b>' + Number(d.confidence || 0).toFixed(0) + '%</b><small>形态匹配度</small></div></div>' +
      '<div class="shot-trend"><span>趋势：' + esc(d.trend.phase) + "</span><span>区间：" + Number(d.trend.range || 0).toFixed(1) + "%</span><span>识别 " + (item.result.extract.bars.length) + " 根</span><span>量能：" + esc((d.volume && d.volume.text) || "--") + "</span></div>" +
      '<div class="shot-match-list">' + matches.map((m) =>
        '<div class="shot-match"><div class="shot-match-top"><span class="shot-match-name">' + esc(m.name) +
        ' <em class="shot-dir ' + dirClass(m.direction) + '">' + dirText(m.direction) + "</em><small class=\"shot-chapter\">" + esc((m.chapter || "").split(" ")[0] || "") + "</small></span><span class=\"shot-match-score\">" + m.score.toFixed(0) + "</span></div>" +
        '<div class="shot-match-bar"><i style="width:' + Math.min(100, m.score) + '%"></i></div>' +
        '<div class="shot-match-ev">' + esc((m.evidence || []).slice(0, 2).join("；")) + "</div></div>"
      ).join("") + "</div>" +
      '<div class="shot-levels"><div><small>图内相对支撑</small><b>' + fmtPct(sup) + "</b></div><div><small>图内相对压力</small><b>" + fmtPct(res) + "</b></div></div>" +
      '<div class="shot-note">' + esc(d.source || "") + "。" + esc(d.note || "") + " 价格轴按截图纵向比例还原，涨跌幅为图内相对值，仅用于比较形态，不代表真实价位。</div>" +
      "</div>";
    rebuild.hidden = false;
    $("shotBarsCount").textContent = item.result.extract.bars.length + " 根";
    renderShotRebuild(item.result.extract.bars);
  }

  function renderShotRebuild(bars) {
    const el = $("shotRebuildChart");
    if (!patternState.shot.chart) patternState.shot.chart = echarts.init(el, null, { renderer: "canvas" });
    const candle = bars.map((b) => [b.o, b.c, b.l, b.h]);
    patternState.shot.chart.setOption({
      animation: false,
      grid: { left: 12, right: 18, top: 12, bottom: 20, containLabel: true },
      tooltip: {
        trigger: "axis", backgroundColor: "rgba(17,26,46,.95)", borderWidth: 0,
        textStyle: { color: "#e7edf8", fontSize: 10 },
        formatter: (p) => {
          const b = bars[p[0].dataIndex];
          return "第" + (p[0].dataIndex + 1) + "根<br/>开 " + b.o.toFixed(2) + "　收 " + b.c.toFixed(2) + "<br/>高 " + b.h.toFixed(2) + "　低 " + b.l.toFixed(2);
        },
      },
      xAxis: {
        type: "category", data: bars.map((_, i) => i + 1), boundaryGap: true,
        axisLine: { lineStyle: { color: "#e4e9f2" } }, axisTick: { show: false },
        axisLabel: { color: "#9aa4b8", fontSize: 8, interval: Math.max(0, Math.ceil(bars.length / 8) - 1) },
      },
      yAxis: {
        scale: true, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: "#eef1f7", type: "dashed" } },
      },
      series: [{
        type: "candlestick", data: candle,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN, borderWidth: 1 },
      }, {
        type: "line", symbol: "none", lineStyle: { width: 1, color: "rgba(47,107,255,.5)" },
        data: bars.map((b, i) => {
          if (i < 4) return null;
          let s = 0; for (let j = i - 4; j <= i; j++) s += bars[j].c;
          return s / 5;
        }),
      }],
    }, true);
    requestAnimationFrame(() => patternState.shot.chart.resize());
  }

  function bindShot() {
    $("btnPickImage").addEventListener("click", () => $("shotFile").click());
    $("btnAddMore").addEventListener("click", () => $("shotFile").click());
    $("shotFile").addEventListener("change", (e) => {
      addShotFiles(e.target.files);
      e.target.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) => {
      $("shotDrop").addEventListener(ev, (e) => {
        e.preventDefault();
        $("shotDrop").classList.add("dragging");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      $("shotDrop").addEventListener(ev, (e) => {
        e.preventDefault();
        $("shotDrop").classList.remove("dragging");
      });
    });
    $("shotDrop").addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files) addShotFiles(e.dataTransfer.files);
    });
    document.addEventListener("paste", (e) => {
      if (state.view !== "pattern" || patternState.tab !== "shot") return;
      const files = [];
      Array.from(e.clipboardData?.items || []).forEach((it) => {
        if (it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      });
      if (files.length) { addShotFiles(files); e.preventDefault(); }
    });
    $("colorToggle").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b) return;
      patternState.shot.mode = b.dataset.mode;
      document.querySelectorAll("#colorToggle button").forEach((x) => x.classList.toggle("active", x === b));
      const item = shotActive();
      if (item && item.result) {
        item.result = null; item.status = "new";
        renderShotThumbs(); renderShotResult(item); renderShotCanvas();
      }
    });
    $("btnAutoCrop").addEventListener("click", autoCropActive);
    $("btnResetCrop").addEventListener("click", () => {
      const item = shotActive();
      if (!item) return;
      item.crop = { x: 0.02, y: 0.02, w: 0.96, h: 0.96 };
      item.status = "new"; item.result = null;
      renderShotThumbs(); renderShotCanvas(); renderShotResult(item);
    });
    $("btnAnalyzeShot").addEventListener("click", analyzeShot);
    bindCrop();
    window.addEventListener("resize", debounce(() => {
      const item = shotActive();
      if (item && state.view === "pattern" && patternState.tab === "shot") renderShotCanvas();
      if (patternState.quiz.chart && patternState.tab === "quiz") patternState.quiz.chart.resize();
    }, 140));
  }

  /* =================================================================
     标签页 / 启动
  ================================================================= */
  function switchTab(tab, updateHash) {
    if (!["atlas", "quiz", "shot"].includes(tab)) tab = "atlas";
    patternState.tab = tab;
    ["atlas", "quiz", "shot"].forEach((t) => {
      $("pane-" + t).hidden = t !== tab;
      const b = document.querySelector('#patternTabs button[data-tab="' + t + '"]');
      if (b) b.classList.toggle("active", t === tab);
    });
    if (tab === "atlas") ensurePatterns();
    if (tab === "quiz") {
      updateQuizScoreUI();
      if (!patternState.quiz.data && !patternState.quiz.loading) loadQuiz();
      else setTimeout(() => { if (patternState.quiz.chart) patternState.quiz.chart.resize(); if (patternState.quiz.zoomChart) patternState.quiz.zoomChart.resize(); }, 60);
    }
    if (tab === "shot") {
      setTimeout(() => {
        if (shotActive()) renderShotCanvas();
      }, 40);
    }
    if (updateHash !== false && state.view === "pattern") {
      const h = "#pattern/" + tab;
      if (location.hash !== h) history.replaceState(null, "", location.pathname + h);
    }
  }

  function activate() {
    ensurePatterns();
    const div = (location.hash || "").replace("#", "").split("/");
    const tab = div[0] === "pattern" && ["atlas", "quiz", "shot"].includes(div[1]) ? div[1] : patternState.tab;
    switchTab(tab, false);
    updateQuizScoreUI();
  }

  function boot() {
    bindAtlas();
    bindQuiz();
    bindShot();
    $("patternTabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (b) switchTab(b.dataset.tab);
    });
    updateQuizScoreUI();
  }

  window.KPattern = { activate, switchTab, _state: patternState };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

