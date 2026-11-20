(function () {
  "use strict";

  /* =========================================================
   * 全域：科目、儲存、小工具
   * ======================================================= */
  const SUBJECTS = window.SUBJECTS || [];
  window.QBANKS = window.QBANKS || {};
  const LABELS = ["A", "B", "C", "D"];
  const $ = (id) => document.getElementById(id);

  const GLOBAL_KEYS = { theme: "autoquiz.theme.v1", subject: "autoquiz.subject.v1" };
  const LEGACY = { stats: "autoquiz.stats.v1", stars: "autoquiz.stars.v1", hist: "autoquiz.hist.v1", daily: "autoquiz.daily.v1", set: "autoquiz.settings.v1" };

  function load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 無痕模式：忽略 */ }
  }
  function drop(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
  const keyOf = (sid, name) => `autoquiz2.${sid}.${name}`;

  // 舊版（只有一科）的紀錄 → 搬到「自動化概論」名下，只搬一次
  function migrateLegacy() {
    const sid = "automation";
    if (localStorage.getItem(keyOf(sid, "migrated"))) return;
    try {
      let any = false;
      Object.keys(LEGACY).forEach((name) => {
        const raw = localStorage.getItem(LEGACY[name]);
        if (raw !== null && localStorage.getItem(keyOf(sid, name)) === null) {
          localStorage.setItem(keyOf(sid, name), raw);
          any = true;
        }
      });
      localStorage.setItem(keyOf(sid, "migrated"), "1");
      return any;
    } catch (e) { /* ignore */ }
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  /* =========================================================
   * 目前科目的狀態
   * ======================================================= */
  let subject = null;          // {id, name, ...}
  let BANK = [];
  let BY_ID = {};
  let MAX_ID = 0;
  let stats = {};              // id -> {r, w, last}
  let stars = {};              // id -> 1
  let hist = [];               // [{t, n, right, secs}]
  let daily = { d: "", n: 0 };

  const K = (name) => keyOf(subject.id, name);
  const saveStats = () => save(K("stats"), stats);
  const saveStars = () => save(K("stars"), stars);
  const saveHist = () => save(K("hist"), hist);
  const saveDaily = () => save(K("daily"), daily);

  const wrongIds = () => BANK.filter((q) => stats[q.id] && stats[q.id].last === 0).map((q) => q.id);
  const starIds = () => BANK.filter((q) => stars[q.id]).map((q) => q.id);

  function bumpDaily() {
    if (daily.d !== today()) daily = { d: today(), n: 0 };
    daily.n++;
    saveDaily();
  }

  // 不用載入題庫就能讀某科的進度（給「所有科目」卡片用）
  function peekStats(sid) {
    return load(keyOf(sid, "stats"), null) || (sid === "automation" ? load(LEGACY.stats, {}) : {});
  }

  function loadSubjectScript(id) {
    if (window.QBANKS[id]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `data/${id}.js` + (window.APP_VERSION ? `?v=${window.APP_VERSION}` : "");
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("載入題庫失敗"));
      document.head.appendChild(s);
    });
  }

  async function selectSubject(id, opts) {
    opts = opts || {};
    const meta = SUBJECTS.find((s) => s.id === id) || SUBJECTS[0];
    if (!meta) return;
    stopTimer();
    session = null;
    $("heroSub").textContent = "載入題庫中…";
    try {
      await loadSubjectScript(meta.id);
    } catch (e) {
      toast("題庫載入失敗，請確認網路後重新整理");
      return;
    }
    subject = meta;
    save(GLOBAL_KEYS.subject, subject.id);
    BANK = window.QBANKS[subject.id] || [];
    BY_ID = {};
    BANK.forEach((q) => { BY_ID[q.id] = q; });
    MAX_ID = BANK.reduce((m, q) => Math.max(m, q.id), 0);
    stats = load(K("stats"), {});
    stars = load(K("stars"), {});
    hist = load(K("hist"), []);
    daily = load(K("daily"), { d: "", n: 0 });

    $("subjectSel").value = subject.id;
    $("brandLogo").textContent = subject.icon || "⚙";
    document.title = `${subject.name} 刷題`;
    if (opts.updateHash !== false) {
      try { history.replaceState(null, "", "#" + subject.id); } catch (e) { /* file:// */ }
    }
    setupHomeForSubject();
    goTab("home");
  }

  /* =========================================================
   * 版面切換
   * ======================================================= */
  let browseMode = "browse"; // browse | wrong | star
  function showView(name) {
    ["home", "browse", "quiz", "result"].forEach((v) => { $("view-" + v).hidden = v !== name; });
    document.body.classList.toggle("in-quiz", name === "quiz");
    window.scrollTo(0, 0);
  }
  function setTab(tab) {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === tab));
  }
  function goTab(tab) {
    stopTimer();
    if (tab === "home") { setTab("home"); renderHome(); showView("home"); return; }
    browseMode = tab;
    setTab(tab);
    const titles = { browse: "題庫瀏覽", wrong: "錯題本", star: "收藏題目" };
    $("browseTitle").textContent = `${subject.name} · ${titles[tab]}`;
    $("bFrom").value = 1;
    $("bTo").value = Math.max(1, MAX_ID);
    $("search").value = "";
    renderBrowse(true);
    showView("browse");
  }

  /* =========================================================
   * 主題（深淺色）
   * ======================================================= */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0e1020" : "#4f46e5");
  }
  function initTheme() {
    let t = load(GLOBAL_KEYS.theme, null);
    if (!t) t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(t);
    $("themeBtn").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      save(GLOBAL_KEYS.theme, next);
    });
  }

  /* =========================================================
   * 首頁
   * ======================================================= */
  function readRange() {
    let from = parseInt($("rangeFrom").value, 10) || 1;
    let to = parseInt($("rangeTo").value, 10) || MAX_ID;
    from = clamp(from, 1, Math.max(1, MAX_ID));
    to = clamp(to, 1, Math.max(1, MAX_ID));
    if (from > to) [from, to] = [to, from];
    return [from, to];
  }
  function currentPool() {
    const [from, to] = readRange();
    const src = $("source").value;
    return BANK.filter((q) => {
      if (q.id < from || q.id > to) return false;
      const s = stats[q.id];
      if (src === "wrong") return s && s.last === 0;
      if (src === "new") return !s;
      if (src === "star") return !!stars[q.id];
      return true;
    });
  }
  function setRing(el, pct, color) {
    el.style.setProperty("--p", pct);
    if (color) el.style.setProperty("--c", color);
  }
  function updateBadges() {
    $("badgeWrong").textContent = wrongIds().length;
    $("badgeStar").textContent = starIds().length;
  }

  function renderStats() {
    const empty = BANK.length === 0;
    const done = Object.keys(stats).filter((id) => BY_ID[id]).length;
    let r = 0, w = 0;
    Object.keys(stats).forEach((id) => { if (BY_ID[id]) { r += stats[id].r; w += stats[id].w; } });
    const donePct = BANK.length ? Math.round((done / BANK.length) * 100) : 0;
    const acc = r + w ? Math.round((r / (r + w)) * 100) : null;
    const wrong = wrongIds().length;
    $("stDone").textContent = `${done} / ${BANK.length}`;
    $("ringDoneTxt").textContent = donePct + "%";
    setRing($("ringDone"), donePct);
    $("stAcc").textContent = acc === null ? "–" : acc + "%";
    $("ringAccTxt").textContent = acc === null ? "–" : acc;
    setRing($("ringAcc"), acc || 0, acc !== null && acc < 60 ? "#f43f5e" : "#22c55e");
    $("stWrong").textContent = wrong;
    $("stToday").textContent = daily.d === today() ? daily.n : 0;
    $("heroTitle").textContent = `${subject.name}　今天刷幾題？`;
    $("heroSub").textContent = empty
      ? "這個科目的題庫還沒建立，敬請期待"
      : `題庫共 ${BANK.length} 題 · 已完成 ${donePct}% · 錯題 ${wrong} 題 · 收藏 ${starIds().length} 題`;
    $("qsRandom").disabled = empty;
    $("qsContinue").disabled = empty;
    $("qsWrong").disabled = wrong === 0;
    $("qsStar").disabled = starIds().length === 0;
    updateBadges();
  }

  function renderMap() {
    const map = $("map");
    map.innerHTML = "";
    if (!BANK.length) { map.innerHTML = '<p class="muted small">尚無題目</p>'; return; }
    const frag = document.createDocumentFragment();
    BANK.forEach((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = q.id;
      const s = stats[q.id];
      let cls = "";
      if (s) cls = s.last === 1 ? "ok" : "bad";
      if (stars[q.id]) cls += " starred";
      b.className = cls.trim();
      b.title = `第 ${q.id} 題` + (s ? (s.last === 1 ? "（上次答對）" : "（上次答錯）") : "（未做）");
      b.dataset.id = q.id;
      frag.appendChild(b);
    });
    map.appendChild(frag);
  }

  function renderHistory() {
    const card = $("historyCard");
    if (!hist.length) { card.hidden = true; return; }
    card.hidden = false;
    $("history").innerHTML = hist.slice(-6).reverse().map((h) => {
      const d = new Date(h.t);
      const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const pct = Math.round((h.right / h.n) * 100);
      return `<div class="hist"><span>${when}</span><span>${h.right} / ${h.n} 題（${pct}%）</span><span class="muted">${fmtTime(h.secs)}</span></div>`;
    }).join("");
  }

  function renderSubjectCards() {
    const box = $("subjectCards");
    box.innerHTML = SUBJECTS.map((s) => {
      const st = s.id === subject.id ? stats : peekStats(s.id);
      const done = Object.keys(st).length;
      const pct = s.count ? Math.round((done / s.count) * 100) : 0;
      const body = s.count
        ? `<div class="mini-bar"><i style="width:${pct}%"></i></div><small>${done} / ${s.count} 題 · ${pct}%</small>`
        : `<small class="muted">${esc(s.desc || "題庫建置中")}</small>`;
      return `<button type="button" class="subject-card ${s.id === subject.id ? "current" : ""}" data-sid="${esc(s.id)}">
        <span class="s-ico">${esc(s.icon || "📘")}</span>
        <span class="s-body"><b>${esc(s.name)}</b>${body}</span></button>`;
    }).join("");
    $("subjectsCard").hidden = SUBJECTS.length < 2;
  }

  function refreshPool() {
    const pool = currentPool();
    const [from, to] = readRange();
    $("poolInfo").textContent = BANK.length
      ? `第 ${from}–${to} 題，符合條件的共 ${pool.length} 題`
      : "這個科目還沒有題目";
    $("countRange").max = Math.max(1, pool.length);
    if (parseInt($("count").value, 10) > pool.length) $("count").value = Math.max(1, pool.length);
    $("countRange").value = $("count").value;
    $("countLabel").textContent = $("count").value;
    $("start").disabled = pool.length === 0;
  }

  function renderHome() {
    renderStats();
    renderMap();
    renderHistory();
    renderSubjectCards();
    refreshPool();
    renderResumeBox();
  }

  function saveSettings() {
    save(K("set"), {
      from: $("rangeFrom").value, to: $("rangeTo").value, count: $("count").value,
      source: $("source").value, order: $("order").value, mode: $("mode").value,
      timer: $("timer").value, shuffleOpts: $("shuffleOpts").checked,
    });
  }

  // 切換科目時重設首頁輸入欄位
  function setupHomeForSubject() {
    const max = Math.max(1, MAX_ID);
    $("rangeFrom").max = $("rangeTo").max = max;
    $("rangeFrom").value = 1;
    $("rangeTo").value = max;
    $("count").value = Math.min(20, max);
    $("source").value = "all"; $("order").value = "random"; $("mode").value = "instant"; $("timer").value = "up";
    $("shuffleOpts").checked = true;
    const s = load(K("set"), null);
    if (s) {
      [["from", "rangeFrom"], ["to", "rangeTo"], ["count", "count"], ["source", "source"], ["order", "order"], ["mode", "mode"], ["timer", "timer"]].forEach(([k, id]) => {
        if (s[k] !== undefined && s[k] !== "") $(id).value = s[k];
      });
      if (typeof s.shuffleOpts === "boolean") $("shuffleOpts").checked = s.shuffleOpts;
    }
    const presets = $("presets");
    presets.innerHTML = "";
    const mk = (label, a, b) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = label; btn.dataset.a = a; btn.dataset.b = b;
      presets.appendChild(btn);
    };
    if (MAX_ID) {
      mk("全部", 1, MAX_ID);
      for (let a = 1; a <= MAX_ID; a += 50) mk(`${a}–${Math.min(a + 49, MAX_ID)}`, a, Math.min(a + 49, MAX_ID));
    }
  }

  const quickOpts = () => ({ mode: "instant", shuf: $("shuffleOpts").checked, timer: $("timer").value === "up" });

  function bindHome() {
    $("presets").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $("rangeFrom").value = b.dataset.a;
      $("rangeTo").value = b.dataset.b;
      refreshPool();
    });
    ["rangeFrom", "rangeTo", "source"].forEach((id) => $(id).addEventListener("input", refreshPool));
    $("countRange").addEventListener("input", () => { $("count").value = $("countRange").value; $("countLabel").textContent = $("count").value; });
    $("count").addEventListener("input", () => {
      const v = clamp(parseInt($("count").value, 10) || 1, 1, 9999);
      $("countRange").value = v;
      $("countLabel").textContent = v;
    });
    $("countAll").addEventListener("click", () => { $("count").value = Math.max(1, currentPool().length); refreshPool(); });
    $("start").addEventListener("click", () => {
      saveSettings();
      let pool = currentPool();
      const n = clamp(parseInt($("count").value, 10) || 20, 1, pool.length);
      pool = $("order").value === "random" ? shuffle(pool) : pool;
      begin(pool.slice(0, n), $("mode").value, $("shuffleOpts").checked, $("timer").value === "up");
    });

    // 快速開始
    $("qsRandom").addEventListener("click", () => {
      const o = quickOpts();
      begin(shuffle(BANK).slice(0, 20), o.mode, o.shuf, o.timer);
    });
    $("qsContinue").addEventListener("click", () => {
      const ids = Object.keys(stats).map(Number).filter((id) => BY_ID[id]);
      let startId = ids.length ? Math.max.apply(null, ids) + 1 : 1;
      if (startId > MAX_ID) startId = 1;
      const o = quickOpts();
      begin(BANK.filter((q) => q.id >= startId).slice(0, 20), o.mode, o.shuf, o.timer);
      toast(`從第 ${startId} 題開始`);
    });
    $("qsWrong").addEventListener("click", () => {
      const o = quickOpts();
      begin(shuffle(wrongIds()).slice(0, 30).map((id) => BY_ID[id]), o.mode, o.shuf, o.timer);
    });
    $("qsStar").addEventListener("click", () => {
      const o = quickOpts();
      begin(shuffle(starIds()).slice(0, 30).map((id) => BY_ID[id]), o.mode, o.shuf, o.timer);
    });

    // 題號地圖
    $("map").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const id = Number(b.dataset.id);
      const o = quickOpts();
      begin(BANK.filter((q) => q.id >= id).slice(0, 20), o.mode, o.shuf, o.timer);
    });

    // 科目卡片
    $("subjectCards").addEventListener("click", (e) => {
      const b = e.target.closest("[data-sid]");
      if (b && b.dataset.sid !== subject.id) selectSubject(b.dataset.sid);
    });

    // 備份（所有科目一起）
    $("exportBtn").addEventListener("click", () => {
      const out = { version: 2, subjects: {} };
      SUBJECTS.forEach((s) => {
        const isCur = subject && s.id === subject.id;
        out.subjects[s.id] = {
          stats: isCur ? stats : peekStats(s.id),
          stars: isCur ? stars : load(keyOf(s.id, "stars"), {}),
          hist: isCur ? hist : load(keyOf(s.id, "hist"), []),
          daily: isCur ? daily : load(keyOf(s.id, "daily"), { d: "", n: 0 }),
        };
      });
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "autoquiz-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          let subjects = null;
          if (d && d.version === 2 && d.subjects) subjects = d.subjects;
          else if (d && typeof d.stats === "object") subjects = { automation: d }; // 舊版備份
          if (!subjects) throw new Error("格式不符");
          if (!confirm("匯入會覆蓋目前這個瀏覽器中對應科目的紀錄，確定嗎？")) return;
          Object.keys(subjects).forEach((sid) => {
            const v = subjects[sid] || {};
            save(keyOf(sid, "stats"), v.stats || {});
            save(keyOf(sid, "stars"), v.stars || {});
            save(keyOf(sid, "hist"), v.hist || []);
            save(keyOf(sid, "daily"), v.daily || { d: "", n: 0 });
            save(keyOf(sid, "migrated"), 1);
          });
          stats = load(K("stats"), {}); stars = load(K("stars"), {}); hist = load(K("hist"), []); daily = load(K("daily"), { d: "", n: 0 });
          renderHome();
          toast("匯入完成");
        } catch (err) { toast("匯入失敗：檔案格式不正確"); }
        e.target.value = "";
      };
      rd.readAsText(f);
    });
    $("resetStats").addEventListener("click", () => {
      if (!confirm(`確定要清除「${subject.name}」的作答紀錄、收藏與歷史嗎？`)) return;
      stats = {}; stars = {}; hist = []; daily = { d: "", n: 0 };
      saveStats(); saveStars(); saveHist(); saveDaily(); drop(K("session"));
      renderHome();
      toast("已清除");
    });

    // 未完成測驗
    $("resumeGo").addEventListener("click", resumeSession);
    $("resumeDrop").addEventListener("click", () => { drop(K("session")); renderResumeBox(); });
  }

  /* =========================================================
   * 題庫瀏覽 / 錯題本 / 收藏
   * ======================================================= */
  const PAGE = 30;
  let browseList = [];
  let browseShown = 0;

  function filteredBrowse() {
    let from = clamp(parseInt($("bFrom").value, 10) || 1, 1, Math.max(1, MAX_ID));
    let to = clamp(parseInt($("bTo").value, 10) || MAX_ID, 1, Math.max(1, MAX_ID));
    if (from > to) [from, to] = [to, from];
    const kw = $("search").value.trim().toLowerCase();
    return BANK.filter((q) => {
      if (q.id < from || q.id > to) return false;
      if (browseMode === "wrong" && !(stats[q.id] && stats[q.id].last === 0)) return false;
      if (browseMode === "star" && !stars[q.id]) return false;
      if (kw && !(q.q + " " + q.opts.join(" ")).toLowerCase().includes(kw)) return false;
      return true;
    });
  }
  function qItemHtml(q) {
    const s = stats[q.id];
    const showAns = $("showAns").checked;
    const tag = s ? (s.last === 1 ? '<span class="tag ok">上次答對</span>' : '<span class="tag bad">上次答錯</span>') : "";
    const opts = q.opts.map((o, i) =>
      `<li class="${showAns && i === q.ans ? "right" : ""}"><b>(${LABELS[i]})</b>${esc(o)}</li>`).join("");
    return `<article class="card qitem" data-id="${q.id}">
      <div class="top"><span class="id">第 ${q.id} 題</span>${tag}
        <button type="button" class="star-btn ${stars[q.id] ? "on" : ""}" data-star="${q.id}" aria-label="收藏">${stars[q.id] ? "★" : "☆"}</button></div>
      <p class="qt">${esc(q.q)}</p>
      ${q.img ? `<img class="qfig" src="${q.img}" alt="第 ${q.id} 題附圖" loading="lazy" decoding="async">` : ""}
      <ol>${opts}</ol>
      ${q.note ? `<p class="note">※ ${esc(q.note)}</p>` : ""}
    </article>`;
  }
  function renderBrowse(reset) {
    if (reset) {
      browseList = filteredBrowse();
      browseShown = 0;
      $("list").innerHTML = "";
    }
    const sub = { browse: "查看所有題目與答案，可搜尋關鍵字、加入收藏", wrong: "上次答錯的題目，答對後會自動移出錯題本", star: "你標記收藏的題目" };
    $("browseSub").textContent = `${sub[browseMode]}　·　目前 ${browseList.length} 題`;
    const next = browseList.slice(browseShown, browseShown + PAGE);
    if (reset && !browseList.length) {
      $("list").innerHTML = `<div class="empty">${browseMode === "wrong" ? "目前沒有錯題，太棒了！" : browseMode === "star" ? "還沒有收藏的題目。作答或瀏覽時按 ☆ 就能收藏。" : "找不到符合的題目。"}</div>`;
    } else {
      $("list").insertAdjacentHTML("beforeend", next.map(qItemHtml).join(""));
    }
    browseShown += next.length;
    $("more").hidden = browseShown >= browseList.length;
    $("browseStart").disabled = browseList.length === 0;
  }
  function bindBrowse() {
    let t = null;
    $("search").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => renderBrowse(true), 200); });
    ["bFrom", "bTo"].forEach((id) => $(id).addEventListener("input", () => renderBrowse(true)));
    $("showAns").addEventListener("change", () => renderBrowse(true));
    $("more").addEventListener("click", () => renderBrowse(false));
    $("list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-star]");
      if (!b) return;
      toggleStar(Number(b.dataset.star));
      if (browseMode === "star") renderBrowse(true);
      else { b.classList.toggle("on", !!stars[b.dataset.star]); b.textContent = stars[b.dataset.star] ? "★" : "☆"; }
    });
    $("browseStart").addEventListener("click", () => {
      saveSettings();
      begin(shuffle(browseList), "instant", $("shuffleOpts").checked, $("timer").value === "up");
    });
  }
  function toggleStar(id) {
    if (stars[id]) delete stars[id]; else stars[id] = 1;
    saveStars();
    updateBadges();
  }

  /* =========================================================
   * 作答
   * ======================================================= */
  let session = null;
  let timerId = null;

  function stopTimer() { clearInterval(timerId); timerId = null; }
  function startTimer() {
    stopTimer();
    const el = $("timerTxt");
    el.hidden = !session.timed;
    session.t0 = Date.now() - (session.secs || 0) * 1000;
    if (!session.timed) return;
    el.textContent = fmtTime(session.secs || 0);
    timerId = setInterval(() => {
      session.secs = Math.round((Date.now() - session.t0) / 1000);
      el.textContent = fmtTime(session.secs);
    }, 500);
  }

  function makeItem(q, order) {
    return { q, order: order || (q.fixed || !session.shuffleOpts ? [0, 1, 2, 3] : shuffle([0, 1, 2, 3])), picked: null, locked: false };
  }

  function begin(questions, mode, shuffleOpts, timed) {
    if (!questions.length) { toast("沒有可以刷的題目"); return; }
    session = { mode, timed, shuffleOpts, questions, idx: 0, secs: 0, items: [] };
    session.items = questions.map((q) => makeItem(q));
    enterQuiz();
  }

  function enterQuiz() {
    setTab("");
    showView("quiz");
    startTimer();
    buildNav();
    render();
    persistSession();
  }

  /* ---- 未完成測驗：存在 localStorage，重新整理也不會掉 ---- */
  function persistSession() {
    if (!session) return;
    save(K("session"), {
      mode: session.mode, timed: session.timed, shuffleOpts: session.shuffleOpts,
      idx: session.idx, secs: session.secs || 0, savedAt: Date.now(),
      items: session.items.map((it) => ({ id: it.q.id, o: it.order, p: it.picked, l: it.locked ? 1 : 0 })),
    });
  }
  function readSavedSession() {
    const s = load(K("session"), null);
    if (!s || !Array.isArray(s.items) || !s.items.length) return null;
    if (!s.items.every((it) => BY_ID[it.id] && Array.isArray(it.o) && it.o.length === 4)) return null;
    return s;
  }
  function renderResumeBox() {
    const s = readSavedSession();
    $("resumeBox").hidden = !s;
    if (!s) return;
    const done = s.items.filter((it) => it.p !== null).length;
    $("resumeInfo").textContent = `${subject.name} · 已作答 ${done} / ${s.items.length} 題 · ${s.mode === "exam" ? "交卷模式" : "即時看答案"}`;
  }
  function resumeSession() {
    const s = readSavedSession();
    if (!s) { renderResumeBox(); return; }
    session = {
      mode: s.mode, timed: s.timed, shuffleOpts: s.shuffleOpts,
      idx: clamp(s.idx || 0, 0, s.items.length - 1), secs: s.secs || 0,
      items: s.items.map((it) => ({ q: BY_ID[it.id], order: it.o, picked: it.p, locked: !!it.l })),
    };
    session.questions = session.items.map((it) => it.q);
    enterQuiz();
  }

  const correctPos = (it) => it.order.indexOf(it.q.ans);
  const isRight = (it) => it.picked !== null && it.picked === correctPos(it);

  function buildNav() {
    const box = $("navChips");
    box.innerHTML = "";
    const frag = document.createDocumentFragment();
    session.items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = i + 1;
      b.dataset.i = i;
      frag.appendChild(b);
    });
    box.appendChild(frag);
    updateNav();
  }
  function updateNav() {
    const chips = $("navChips").children;
    session.items.forEach((it, i) => {
      let cls = "";
      if (it.picked !== null) {
        if (session.mode === "instant") cls = isRight(it) ? "ok" : "bad";
        else cls = "answered";
      }
      if (i === session.idx) cls += " cur";
      if (chips[i]) chips[i].className = cls.trim();
    });
    const cur = chips[session.idx];
    if (cur && cur.scrollIntoView && $("navChips").scrollHeight > $("navChips").clientHeight) {
      // 導覽列很長時，讓目前題號保持在可視範圍
      try { cur.scrollIntoView({ block: "nearest" }); } catch (e) { /* ignore */ }
    }
  }

  function render() {
    const it = session.items[session.idx];
    const total = session.items.length;
    $("counter").textContent = `${session.idx + 1} / ${total}`;
    $("bar").style.width = `${((session.idx + 1) / total) * 100}%`;
    $("qno").textContent = `${subject.short || subject.name} 第 ${it.q.id} 題`;
    $("qtext").textContent = it.q.q;
    const img = $("qimg");
    if (it.q.img) { img.src = it.q.img; img.hidden = false; } else { img.hidden = true; img.removeAttribute("src"); }
    const nxt = session.items[session.idx + 1];
    if (nxt && nxt.q.img) { const pre = new Image(); pre.src = nxt.q.img; }   // 預載下一題的圖
    updateStarBtn();

    const box = $("options");
    box.innerHTML = "";
    it.order.forEach((origIdx, pos) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.dataset.pos = pos;
      b.setAttribute("aria-label", `選項 ${LABELS[pos]}：${it.q.opts[origIdx]}`);
      b.innerHTML = `<span class="lab">${LABELS[pos]}</span><span>${esc(it.q.opts[origIdx])}</span>`;
      box.appendChild(b);
    });
    paint(it);
    $("prev").disabled = session.idx === 0;
    const last = session.idx === total - 1;
    $("next").textContent = last ? (session.mode === "exam" ? "交卷 ✓" : "看成績 ✓") : "下一題 →";
    updateNav();
  }
  function updateStarBtn() {
    const it = session.items[session.idx];
    const on = !!stars[it.q.id];
    $("starBtn").textContent = on ? "★" : "☆";
    $("starBtn").classList.toggle("on", on);
    $("starBtn").setAttribute("aria-pressed", on ? "true" : "false");
  }

  function paint(it) {
    const instant = session.mode === "instant";
    const cp = correctPos(it);
    const btns = $("options").children;
    const fb = $("feedback");
    fb.hidden = true;
    for (let i = 0; i < btns.length; i++) {
      btns[i].classList.remove("picked", "correct", "wrong");
      if (instant && it.locked) {
        btns[i].disabled = true;
        if (i === cp) btns[i].classList.add("correct");
        else if (i === it.picked) btns[i].classList.add("wrong");
      } else {
        btns[i].disabled = false;
        if (i === it.picked) btns[i].classList.add("picked");
      }
    }
    if (instant && it.locked) {
      const ok = isRight(it);
      fb.hidden = false;
      fb.className = "feedback " + (ok ? "ok" : "bad");
      fb.innerHTML = (ok ? "✓ 答對了！" : `✕ 答錯了，正確答案是 (${LABELS[cp]})`) +
        (it.q.note ? `<span class="note">※ ${esc(it.q.note)}</span>` : "");
    }
  }

  function record(it) {
    const s = stats[it.q.id] || { r: 0, w: 0, last: null };
    if (isRight(it)) s.r++; else s.w++;
    s.last = isRight(it) ? 1 : 0;
    stats[it.q.id] = s;
    saveStats();
    bumpDaily();
  }

  function pick(pos) {
    const it = session.items[session.idx];
    if (session.mode === "instant") {
      if (it.locked) return;
      it.picked = pos;
      it.locked = true;
      record(it);
    } else {
      it.picked = pos;
    }
    paint(it);
    updateNav();
    persistSession();
  }

  function go(delta) {
    const n = session.idx + delta;
    if (n < 0 || n >= session.items.length) return;
    session.idx = n;
    render();
    persistSession();
  }
  function next() {
    if (session.idx < session.items.length - 1) { go(1); return; }
    const unanswered = session.items.filter((it) => it.picked === null).length;
    if (unanswered && !confirm(`還有 ${unanswered} 題沒作答，確定要結束嗎？`)) return;
    finish();
  }

  /* =========================================================
   * 成績
   * ======================================================= */
  function finish() {
    stopTimer();
    session.secs = Math.round((Date.now() - session.t0) / 1000);
    if (session.mode === "exam") session.items.forEach((it) => { if (it.picked !== null) record(it); });
    drop(K("session"));
    const items = session.items;
    const total = items.length;
    const right = items.filter(isRight).length;
    const pct = Math.round((right / total) * 100);
    hist.push({ t: Date.now(), n: total, right, secs: session.secs });
    hist = hist.slice(-30);
    saveHist();

    $("bigScore").textContent = pct;
    setRing($("bigRing"), pct, pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#f43f5e");
    $("resultTitle").textContent = pct === 100 ? "全對！太強了 🎉" : pct >= 80 ? "表現很棒 👍" : pct >= 60 ? "及格了，再加強 💪" : "再接再厲，錯題多看幾次 📚";
    const unans = items.filter((it) => it.picked === null).length;
    $("resultSub").textContent = `答對 ${right} / ${total} 題` + (unans ? `（未作答 ${unans} 題）` : "") + (session.timed ? ` · 用時 ${fmtTime(session.secs)}` : "");
    $("retryWrong").hidden = right === total;
    document.querySelectorAll("#reviewFilter button").forEach((b) => b.classList.toggle("active", b.dataset.f === "wrong"));
    renderReview("wrong");
    showView("result");
  }
  function renderReview(filter) {
    const list = session.items.filter((it) => filter === "all" || !isRight(it));
    $("reviewList").innerHTML = list.length ? list.map((it) => {
      const cp = correctPos(it);
      const ok = isRight(it);
      const mine = it.picked === null ? "未作答" : `(${LABELS[it.picked]}) ${esc(it.q.opts[it.order[it.picked]])}`;
      return `<article class="card qitem review ${ok ? "ok" : "bad"}">
        <div class="top"><span class="id">第 ${it.q.id} 題</span>
          <span class="tag ${ok ? "ok" : "bad"}">${ok ? "答對" : it.picked === null ? "未作答" : "答錯"}</span>
          <button type="button" class="star-btn ${stars[it.q.id] ? "on" : ""}" data-star="${it.q.id}" aria-label="收藏">${stars[it.q.id] ? "★" : "☆"}</button></div>
        <p class="qt">${esc(it.q.q)}</p>
        ${it.q.img ? `<img class="qfig" src="${it.q.img}" alt="第 ${it.q.id} 題附圖" loading="lazy" decoding="async">` : ""}
        ${ok ? "" : `<p class="mine">你的答案：${mine}</p>`}
        <p class="ans">正確答案：(${LABELS[cp]}) ${esc(it.q.opts[it.q.ans])}</p>
        ${it.q.note ? `<p class="note">※ ${esc(it.q.note)}</p>` : ""}
      </article>`;
    }).join("") : '<div class="empty">全部答對，沒有需要檢討的題目 🎉</div>';
  }

  /* =========================================================
   * 事件
   * ======================================================= */
  function bindQuiz() {
    $("options").addEventListener("click", (e) => {
      const b = e.target.closest(".opt");
      if (b && !b.disabled) pick(Number(b.dataset.pos));
    });
    $("next").addEventListener("click", next);
    $("prev").addEventListener("click", () => go(-1));
    $("navChips").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) { session.idx = Number(b.dataset.i); render(); persistSession(); }
    });
    $("starBtn").addEventListener("click", () => {
      toggleStar(session.items[session.idx].q.id);
      updateStarBtn();
    });
    $("quit").addEventListener("click", () => {
      if (session.mode === "exam") {
        const choice = confirm("要先離開嗎？\n\n按「確定」＝離開，之後可在首頁「繼續作答」\n按「取消」＝留在這裡");
        if (choice) { persistSession(); goTab("home"); }
      } else if (confirm("要結束並查看成績嗎？")) {
        finish();
      }
    });
    $("backHome").addEventListener("click", () => goTab("home"));
    $("retryWrong").addEventListener("click", () => {
      begin(shuffle(session.items.filter((it) => !isRight(it)).map((it) => it.q)), session.mode, session.shuffleOpts, session.timed);
    });
    $("retryAll").addEventListener("click", () => {
      begin(shuffle(session.questions), session.mode, session.shuffleOpts, session.timed);
    });
    $("reviewFilter").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      document.querySelectorAll("#reviewFilter button").forEach((x) => x.classList.toggle("active", x === b));
      renderReview(b.dataset.f);
    });
    $("reviewList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-star]");
      if (!b) return;
      toggleStar(Number(b.dataset.star));
      b.classList.toggle("on", !!stars[b.dataset.star]);
      b.textContent = stars[b.dataset.star] ? "★" : "☆";
    });

    // 鍵盤
    document.addEventListener("keydown", (e) => {
      if ($("view-quiz").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.matches("input,select,textarea")) return;
      const k = e.key.toUpperCase();
      const pos = "ABCD".indexOf(k);
      if (pos >= 0 && k.length === 1) { pick(pos); return; }
      if (["1", "2", "3", "4"].includes(k)) { pick(Number(k) - 1); return; }
      if (k === "S") { $("starBtn").click(); return; }
      if (k === "ENTER" || k === "ARROWRIGHT") { e.preventDefault(); next(); }
      if (k === "ARROWLEFT") go(-1);
    });

    // 手機：左右滑動換題
    let sx = 0, sy = 0, st = 0;
    const card = $("view-quiz");
    card.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
    }, { passive: true });
    card.addEventListener("touchend", (e) => {
      if (!e.changedTouches.length || e.target.closest(".navchips")) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Date.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 45) go(dx < 0 ? 1 : -1);
    }, { passive: true });

    // 離開頁面前存下進度
    window.addEventListener("pagehide", () => { if (session && !$("view-quiz").hidden) persistSession(); });
  }

  /* =========================================================
   * 啟動
   * ======================================================= */
  function registerSW() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("sw.js").then(() => {
      $("footTxt").textContent = "題庫刷題 · 紀錄僅存於本機瀏覽器 · 可離線使用";
    }).catch(() => { /* 不支援就算了 */ });
  }

  async function init() {
    initTheme();
    $("tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b && subject) goTab(b.dataset.view);
    });
    $("brand").addEventListener("click", (e) => { e.preventDefault(); if (subject) goTab("home"); });

    if (!SUBJECTS.length) {
      $("heroSub").textContent = "找不到題庫，請先執行 python scripts/build_data.py";
      return;
    }
    migrateLegacy();
    $("subjectSel").innerHTML = SUBJECTS.map((s) =>
      `<option value="${esc(s.id)}">${esc(s.icon || "")} ${esc(s.name)}${s.count ? "" : "（建置中）"}</option>`).join("");
    $("subjectSel").addEventListener("change", () => selectSubject($("subjectSel").value));
    window.addEventListener("hashchange", () => {
      const id = location.hash.replace(/^#/, "");
      if (subject && id && id !== subject.id && SUBJECTS.some((s) => s.id === id)) selectSubject(id, { updateHash: false });
    });

    bindHome();
    bindBrowse();
    bindQuiz();

    const hashId = location.hash.replace(/^#/, "");
    const saved = load(GLOBAL_KEYS.subject, null);
    const first = [hashId, saved].find((id) => id && SUBJECTS.some((s) => s.id === id)) || SUBJECTS[0].id;
    await selectSubject(first);
    registerSW();
  }

  init();
})();
