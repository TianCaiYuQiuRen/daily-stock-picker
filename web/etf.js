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
        " · 更新 " + (d.generated_at || "").slice(11, 16) + " · 按名称/跟踪指数归类";
    }

    const items = state.items || [];
    if (!items.length) {
      $("etfBody").innerHTML = '<tr><td colspan="10" class="etf-empty">没有符合条件的 ETF</td></tr>';
      return;
    }
    $("etfBody").innerHTML = items.map((it, i) => {
      const up = Number(it.pct) >= 0;
      const wup = Number(it.weekly_pct) >= 0;
      return '<tr>' +
        '<td class="rank">' + (i + 1) + "</td>" +
        '<td class="code">' + esc(it.code) + "</td>" +
        '<td class="name">' + esc(it.name) + "</td>" +
        '<td class="num price">' + Number(it.price || 0).toFixed(3) + "</td>" +
        '<td class="num"><span class="pct ' + (up ? "up" : "down") + '">' +
        signed(it.pct, 2) + "%</span></td>" +
        '<td class="num ' + (wup ? "up" : "down") + '">' + signed(it.weekly_pct, 2) + "%</td>" +
        '<td class="num">' + Number(it.j || 0).toFixed(1) + "</td>" +
        '<td><span class="etf-kind ' + it.kind + '">' + esc(it.kind_label) + "</span></td>" +
        '<td class="etf-sector">' + esc((it.sectors || []).join(" + ") || "-") + "</td>" +
        '<td class="num">' + fmtAmt(it.amount) + "</td>" +
        "</tr>";
    }).join("");
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
  scan(false);
})();
