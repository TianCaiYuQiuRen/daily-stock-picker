/* =====================================================================
   电子书阅读器
   ===================================================================== */
(function () {
  "use strict";
  const K = window.KTrain;
  const { $, api, esc, debounce } = K;

  const S = {
    loaded: false,
    loading: false,
    data: null,
    current: 1,
    zoom: 100,
    activeChapter: null,
    search: "",
  };

  function pad4(n) {
    return String(n).padStart(4, "0");
  }

  function pageUrl(n) {
    return "/book/pages/p" + pad4(n) + ".webp";
  }

  function chapterAt(page) {
    const chapters = (S.data && S.data.chapters) || [];
    let found = chapters[0] || null;
    for (const ch of chapters) {
      if (page >= ch.page) found = ch;
      else break;
    }
    return found;
  }

  function sectionAt(chapter, page) {
    if (!chapter) return null;
    let found = null;
    for (const sec of chapter.sections || []) {
      if (page >= sec.page) found = sec;
      else break;
    }
    return found;
  }

  function updateLocation() {
    if (!S.data) return;
    const ch = chapterAt(S.current);
    const sec = sectionAt(ch, S.current);
    const total = S.data.total || 0;
    $("bookPageNow").textContent = String(S.current);
    $("bookPageTotal").textContent = String(total);
    $("bookPageTotal2").textContent = String(total);
    $("bookPageInput").max = String(total);
    $("bookPageInput").value = String(S.current);
    $("bookChapterLabel").textContent = ch ? ch.title : "未分章";
    $("bookSectionLabel").textContent = sec ? sec.title : "";
    $("bookPageKicker").textContent = "PDF " + S.current + " / " + total + (ch ? " · " + ch.title : "");
    $("bookPageTitle").textContent = ch ? ch.title : "电子书";
    $("bookPageSub").textContent = sec ? sec.title : "本章开始";
    $("bookZoomLabel").textContent = S.zoom + "%";
    S.activeChapter = ch ? ch.id : null;
    syncOutlineActive();
  }

  function applyZoom() {
    const img = $("bookPageImage");
    if (!img) return;
    img.style.width = S.zoom + "%";
    $("bookZoomLabel").textContent = S.zoom + "%";
  }

  function showLoading(on) {
    $("bookPageLoading").hidden = !on;
  }

  function loadPage(page, updateHash) {
    if (!S.data) return;
    const total = S.data.total || 1;
    const n = Math.max(1, Math.min(total, Number(page) || 1));
    S.current = n;
    showLoading(true);
    const img = $("bookPageImage");
    img.style.width = S.zoom + "%";
    img.onload = () => { showLoading(false); };
    img.onerror = () => {
      showLoading(false);
      $("bookPageLoading").hidden = false;
      $("bookPageLoading").textContent = "这一页还没有生成，请运行 tools/build_book.py";
    };
    img.src = pageUrl(n);
    updateLocation();
    if (updateHash !== false && S.data) {
      const h = "#book/" + n;
      if (location.hash !== h) history.replaceState(null, "", location.pathname + h);
    }
    // 预加载下一页，翻页更顺
    if (n < total) {
      const pre = new Image();
      pre.src = pageUrl(n + 1);
    }
  }

  function renderOutline() {
    const box = $("bookOutline");
    const chapters = (S.data && S.data.chapters) || [];
    const q = S.search.trim().toLowerCase();
    let visible = 0;
    box.innerHTML = chapters.map((ch, idx) => {
      const secs = (ch.sections || []).filter((s) => !q || (ch.title + s.title).toLowerCase().includes(q));
      const chMatch = !q || ch.title.toLowerCase().includes(q);
      if (!chMatch && !secs.length) return "";
      visible++;
      const active = S.activeChapter === ch.id;
      const num = String(idx + 1).padStart(2, "0");
      return '<div class="book-chapter">' +
        '<button class="book-chapter-btn' + (active ? " active" : "") + '" data-chapter="' + esc(ch.id) + '" data-page="' + ch.page + '" type="button">' +
        '<span class="num">' + num + '</span><span>' + esc(ch.title) + "</span></button>" +
        '<div class="book-section-list">' + secs.map((s) =>
          '<button class="book-section-btn' + (S.current >= s.page && S.current < nextSectionPage(ch, s) ? " active" : "") + '" data-page="' + s.page + '" type="button">' + esc(s.title) + "</button>"
        ).join("") + "</div></div>";
    }).join("");
    if (!visible) box.innerHTML = '<div class="book-empty"><b>没有匹配的章节</b><span>换一个关键词试试</span></div>';
    $("bookOutlineCount").textContent = visible + " 章";
  }

  function nextSectionPage(ch, sec) {
    const list = ch.sections || [];
    const i = list.indexOf(sec);
    if (i >= 0 && i < list.length - 1) return list[i + 1].page;
    const chapters = (S.data && S.data.chapters) || [];
    const ci = chapters.indexOf(ch);
    return ci >= 0 && ci < chapters.length - 1 ? chapters[ci + 1].page : (S.data.total || 1) + 1;
  }

  function syncOutlineActive() {
    document.querySelectorAll("#bookOutline [data-chapter]").forEach((b) => {
      b.classList.toggle("active", b.dataset.chapter === S.activeChapter);
    });
    const ch = chapterAt(S.current);
    const sec = sectionAt(ch, S.current);
    document.querySelectorAll("#bookOutline .book-section-btn").forEach((b) => {
      b.classList.toggle("active", !!sec && Number(b.dataset.page) === sec.page);
    });
  }

  async function loadManifest() {
    if (S.loaded || S.loading) return;
    S.loading = true;
    $("bookOutline").innerHTML = '<div class="book-empty"><b>正在加载目录</b><span>读取本地书页…</span></div>';
    try {
      const data = await api("/api/book");
      if (!data.ok) throw new Error(data.error || "电子书目录不可用");
      S.data = data;
      S.loaded = true;
      renderOutline();
      const hash = (location.hash || "").match(/^#book\/(\d+)/);
      loadPage(hash ? Number(hash[1]) : 1, false);
    } catch (err) {
      $("bookOutline").innerHTML = "";
      $("bookPageTitle").textContent = "电子书还没有生成";
      $("bookPageSub").textContent = err.message;
      $("bookPageImage").removeAttribute("src");
      $("bookPageLoading").hidden = false;
      $("bookPageLoading").textContent = err.message;
      $("bookOutlineCount").textContent = "不可用";
    } finally {
      S.loading = false;
    }
  }

  function bind() {
    $("bookOutline").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-page]");
      if (!btn) return;
      loadPage(Number(btn.dataset.page), true);
    });
    $("bookSearch").addEventListener("input", debounce((e) => {
      S.search = e.target.value || "";
      renderOutline();
    }, 120));
    $("bookPrev").addEventListener("click", () => loadPage(S.current - 1));
    $("bookNext").addEventListener("click", () => loadPage(S.current + 1));
    $("bookZoomOut").addEventListener("click", () => { S.zoom = Math.max(70, S.zoom - 10); applyZoom(); });
    $("bookZoomIn").addEventListener("click", () => { S.zoom = Math.min(180, S.zoom + 10); applyZoom(); });
    $("bookFit").addEventListener("click", () => { S.zoom = 100; applyZoom(); });
    $("bookJump").addEventListener("click", () => loadPage($("bookPageInput").value));
    $("bookPageInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadPage($("bookPageInput").value);
    });
    document.addEventListener("keydown", (e) => {
      if (K.state.view !== "book") return;
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); loadPage(S.current - 1); }
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); loadPage(S.current + 1); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); $("bookZoomIn").click(); }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); $("bookZoomOut").click(); }
    });
  }

  function activate() {
    if (S.loaded) {
      const m = (location.hash || "").match(/^#book\/(\d+)/);
      loadPage(m ? Number(m[1]) : S.current, false);
      return;
    }
    loadManifest();
  }

  window.KBook = { activate, state: S };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
