(function () {
  "use strict";
  const BANK = window.QUESTIONS || [];
  const BY_ID = {};
  BANK.forEach((q) => { BY_ID[q.id] = q; });
  const MAX_ID = BANK.reduce((m, q) => Math.max(m, q.id), 0);
  const LABELS = ["A", "B", "C", "D"];
  const K = {
    stats: "autoquiz.stats.v1",
    stars: "autoquiz.stars.v1",
    hist: "autoquiz.hist.v1",
    daily: "autoquiz.daily.v1",
    set: "autoquiz.settings.v1",
    theme: "autoquiz.theme.v1",
  };
  const $ = (id) => document.getElementById(id);

  /* ---------- 儲存 ---------- */
  function load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 無痕模式：忽略 */ }
  }
  let stats = load(K.stats, {});   // id -> {r, w, last}
  let stars = load(K.stars, {});   // id -> 1
  let hist = load(K.hist, []);     // [{t, n, right, secs}]
  let daily = load(K.daily, { d: "", n: 0 });

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function bumpDaily() {
    if (daily.d !== today()) daily = { d: today(), n: 0 };
    daily.n++;
    save(K.daily, daily);
  }

  /* ---------- 工具 ---------- */
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
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  const wrongIds = () => BANK.filter((q) => stats[q.id] && stats[q.id].last === 0).map((q) => q.id);
  const starIds = () => BANK.filter((q) => stars[q.id]).map((q) => q.id);

  /* ---------- 版面切換 ---------- */
  let browseMode = "browse"; // browse | wrong | star
  function showView(name) {
    ["home", "browse", "quiz", "result"].forEach((v) => { $("view-" + v).hidden = v !== name; });
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
    $("browseTitle").textContent = titles[tab];
    $("bFrom").value = 1;
    $("bTo").value = MAX_ID;
    $("search").value = "";
    renderBrowse(true);
    showView("browse");
  }

  /* ---------- 主題 ---------- */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#0e1020" : "#4f46e5");
  }
  function initTheme() {
    let t = load(K.theme, null);
    if (!t) t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(t);
    $("themeBtn").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      save(K.theme, next);
    });
  }

  /* ---------- 首頁 ---------- */
  function readRange() {
    let from = parseInt($("rangeFrom").value, 10) || 1;
    let to = parseInt($("rangeTo").value, 10) || MAX_ID;
    from = clamp(from, 1, MAX_ID);
    to = clamp(to, 1, MAX_ID);
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
    const done = Object.keys(stats).length;
    let r = 0, w = 0;
    Object.values(stats).forEach((s) => { r += s.r; w += s.w; });
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
    $("heroSub").textContent = `題庫共 ${BANK.length} 題 · 已完成 ${donePct}% · 錯題 ${wrong} 題 · 收藏 ${starIds().length} 題`;
    $("qsWrong").disabled = wrong === 0;
    $("qsStar").disabled = starIds().length === 0;
    updateBadges();
  }
  function renderMap() {
    const map = $("map");
    map.innerHTML = "";
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
  function refreshPool() {
    const pool = currentPool();
    const [from, to] = readRange();
    $("poolInfo").textContent = `第 ${from}–${to} 題，符合條件的共 ${pool.length} 題`;
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
    refreshPool();
  }
  function saveSettings() {
    save(K.set, {
      from: $("rangeFrom").value, to: $("rangeTo").value, count: $("count").value,
      source: $("source").value, order: $("order").value, mode: $("mode").value,
      timer: $("timer").value, shuffleOpts: $("shuffleOpts").checked,
    });
  }
  function initHome() {
    $("rangeFrom").max = $("rangeTo").max = MAX_ID;
    $("rangeFrom").value = 1;
    $("rangeTo").value = MAX_ID;
    const s = load(K.set, null);
    if (s) {
      ["from:rangeFrom", "to:rangeTo", "count:count", "source:source", "order:order", "mode:mode", "timer:timer"].forEach((p) => {
        const [k, id] = p.split(":");
        if (s[k] !== undefined && s[k] !== "") $(id).value = s[k];
      });
      if (typeof s.shuffleOpts === "boolean") $("shuffleOpts").checked = s.shuffleOpts;
    }
    const presets = $("presets");
    const mk = (label, a, b) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = label; btn.dataset.a = a; btn.dataset.b = b;
      presets.appendChild(btn);
    };
    mk("全部", 1, MAX_ID);
    for (let a = 1; a <= MAX_ID; a += 50) mk(`${a}–${Math.min(a + 49, MAX_ID)}`, a, Math.min(a + 49, MAX_ID));
    presets.addEventListener("click", (e) => {
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
    const quickOpts = () => ({ mode: "instant", shuf: $("shuffleOpts").checked, timer: $("timer").value === "up" });
    $("qsRandom").addEventListener("click", () => {
      const o = quickOpts();
      begin(shuffle(BANK).slice(0, 20), o.mode, o.shuf, o.timer);
    });
    $("qsContinue").addEventListener("click", () => {
      const ids = Object.keys(stats).map(Number);
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

    // 備份
    $("exportBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ stats, stars, hist, daily }, null, 1)], { type: "application/json" });
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
          if (!d || typeof d.stats !== "object") throw new Error("格式不符");
          if (!confirm("匯入會覆蓋目前這個瀏覽器的紀錄，確定嗎？")) return;
          stats = d.stats || {}; stars = d.stars || {}; hist = d.hist || []; daily = d.daily || { d: "", n: 0 };
          save(K.stats, stats); save(K.stars, stars); save(K.hist, hist); save(K.daily, daily);
          renderHome();
          toast("匯入完成");
        } catch (err) { toast("匯入失敗：檔案格式不正確"); }
        e.target.value = "";
      };
      rd.readAsText(f);
    });
    $("resetStats").addEventListener("click", () => {
      if (!confirm("確定要清除所有作答紀錄、收藏與歷史嗎？")) return;
      stats = {}; stars = {}; hist = []; daily = { d: "", n: 0 };
      save(K.stats, stats); save(K.stars, stars); save(K.hist, hist); save(K.daily, daily);
      renderHome();
      toast("已清除");
    });
  }

  /* ---------- 題庫瀏覽 / 錯題本 / 收藏 ---------- */
  const PAGE = 30;
  let browseList = [];
  let browseShown = 0;

  function filteredBrowse() {
    let from = clamp(parseInt($("bFrom").value, 10) || 1, 1, MAX_ID);
    let to = clamp(parseInt($("bTo").value, 10) || MAX_ID, 1, MAX_ID);
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
  function initBrowse() {
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
    save(K.stars, stars);
    updateBadges();
  }

  /* ---------- 作答 ---------- */
  let session = null;
  let timerId = null;

  function stopTimer() { clearInterval(timerId); timerId = null; }
  function startTimer() {
    stopTimer();
    const el = $("timerTxt");
    el.hidden = !session.timed;
    if (!session.timed) return;
    el.textContent = fmtTime(0);
    timerId = setInterval(() => {
      session.secs = Math.round((Date.now() - session.t0) / 1000);
      el.textContent = fmtTime(session.secs);
    }, 500);
  }

  function begin(questions, mode, shuffleOpts, timed) {
    if (!questions.length) { toast("沒有可以刷的題目"); return; }
    session = {
      mode, timed, shuffleOpts,
      questions,
      idx: 0, t0: Date.now(), secs: 0,
      items: questions.map((q) => ({
        q,
        order: q.fixed || !shuffleOpts ? [0, 1, 2, 3] : shuffle([0, 1, 2, 3]),
        picked: null, locked: false,
      })),
    };
    setTab("");
    showView("quiz");
    startTimer();
    buildNav();
    render();
  }

  const correctPos = (it) => it.order.indexOf(it.q.ans);
  const isRight = (it) => it.picked !== null && it.picked === correctPos(it);

  function buildNav() {
    const box = $("navChips");
    box.innerHTML = "";
    session.items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = i + 1;
      b.dataset.i = i;
      box.appendChild(b);
    });
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
      chips[i].className = cls.trim();
    });
  }

  function render() {
    const it = session.items[session.idx];
    const total = session.items.length;
    $("counter").textContent = `${session.idx + 1} / ${total}`;
    $("bar").style.width = `${((session.idx + 1) / total) * 100}%`;
    $("qno").textContent = `題庫第 ${it.q.id} 題`;
    $("qtext").textContent = it.q.q;
    const img = $("qimg");
    if (it.q.img) { img.src = it.q.img; img.hidden = false; } else { img.hidden = true; }
    updateStarBtn();

    const box = $("options");
    box.innerHTML = "";
    it.order.forEach((origIdx, pos) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.dataset.pos = pos;
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
    save(K.stats, stats);
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
  }

  function go(delta) {
    const n = session.idx + delta;
    if (n < 0 || n >= session.items.length) return;
    session.idx = n;
    render();
  }
  function next() {
    if (session.idx < session.items.length - 1) { go(1); return; }
    const unanswered = session.items.filter((it) => it.picked === null).length;
    if (unanswered && !confirm(`還有 ${unanswered} 題沒作答，確定要結束嗎？`)) return;
    finish();
  }

  /* ---------- 成績 ---------- */
  function finish() {
    stopTimer();
    session.secs = Math.round((Date.now() - session.t0) / 1000);
    if (session.mode === "exam") session.items.forEach((it) => { if (it.picked !== null) record(it); });
    const items = session.items;
    const total = items.length;
    const right = items.filter(isRight).length;
    const pct = Math.round((right / total) * 100);
    hist.push({ t: Date.now(), n: total, right, secs: session.secs });
    hist = hist.slice(-30);
    save(K.hist, hist);

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
        ${ok ? "" : `<p class="mine">你的答案：${mine}</p>`}
        <p class="ans">正確答案：(${LABELS[cp]}) ${esc(it.q.opts[it.q.ans])}</p>
        ${it.q.note ? `<p class="note">※ ${esc(it.q.note)}</p>` : ""}
      </article>`;
    }).join("") : '<div class="empty">全部答對，沒有需要檢討的題目 🎉</div>';
  }

  /* ---------- 事件 ---------- */
  function initQuizEvents() {
    $("options").addEventListener("click", (e) => {
      const b = e.target.closest(".opt");
      if (b && !b.disabled) pick(Number(b.dataset.pos));
    });
    $("next").addEventListener("click", next);
    $("prev").addEventListener("click", () => go(-1));
    $("navChips").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) { session.idx = Number(b.dataset.i); render(); }
    });
    $("starBtn").addEventListener("click", () => {
      toggleStar(session.items[session.idx].q.id);
      updateStarBtn();
    });
    $("quit").addEventListener("click", () => {
      if (session.mode === "exam") {
        if (confirm("要放棄這回測驗嗎？（交卷模式的答案不會被記錄）")) { goTab("home"); }
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
  }

  /* ---------- 啟動 ---------- */
  initTheme();
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) goTab(b.dataset.view);
  });
  $("brand").addEventListener("click", (e) => { e.preventDefault(); goTab("home"); });

  if (!BANK.length) {
    $("heroSub").textContent = "找不到題庫，請先執行 python scripts/build_data.py";
    ["start", "qsRandom", "qsContinue", "qsWrong", "qsStar"].forEach((id) => { $(id).disabled = true; });
  } else {
    initHome();
    initBrowse();
    initQuizEvents();
    renderHome();
  }
})();
