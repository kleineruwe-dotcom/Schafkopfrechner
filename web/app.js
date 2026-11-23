/* Kartlblock – Schafkopf mitzählen. */
(function () {
  "use strict";
  const S = window.Scoring;
  const T = S.GAME_TYPES;
  const LS_KEY = "kartlblock.state.v1";
  // Eigenständige Variante (ohne Server): kein Abgleich, Navigation ohne Hash.
  const NOSYNC = !!(window.KARTLBLOCK_STANDALONE || window.KARTLBLOCK_NOSYNC);
  const STANDALONE = !!window.KARTLBLOCK_STANDALONE; // innerhalb eines Rahmens: Navigation ohne Hash
  let memRoute = "";
  const LOGO_SRC = window.KARTLBLOCK_LOGO || "parkcafe-logo.png";
  const COLORS = ["#2f6b50", "#b8372b", "#c9962b", "#3b6fb6", "#8a4fb0", "#d07a2d", "#4a9a9a", "#7a7a3a"];
  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const syncEl = document.getElementById("sync");

  // ---------- Zustand ----------
  let state = loadLocal();
  let draft = null; // Spiel im Bearbeitungsformular
  let newSession = null; // Formular "Neue Runde"

  function emptyState() {
    return { sessions: {}, deleted: {}, prefs: {}, prefsUpdatedAt: 0 };
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return Object.assign(emptyState(), JSON.parse(raw));
    } catch (e) { /* ignorieren */ }
    return emptyState();
  }
  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* voll/privat */ }
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function now() { return Date.now(); }
  function touch(session) {
    state.sessions[session.id] = session;
    session.updatedAt = Math.max(now(), (session.updatedAt || 0) + 1);
    saveLocal();
    scheduleSync();
  }
  function setPrefs(patch) {
    state.prefs = Object.assign({}, state.prefs, patch);
    state.prefsUpdatedAt = now();
    saveLocal();
    scheduleSync();
  }

  // ---------- Server-Abgleich ----------
  let syncTimer = null;
  let syncing = false;
  function setSync(text) { syncEl.textContent = text; }
  function scheduleSync() {
    if (NOSYNC) { setSync("✓ gespeichert"); return; }
    setSync("speichert …");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 600);
  }
  async function sync() {
    if (NOSYNC) return;
    if (syncing) { scheduleSync(); return; }
    syncing = true;
    try {
      const res = await fetch("api/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!res.ok) throw new Error(res.status);
      const merged = await res.json();
      const before = JSON.stringify(state);
      // Lokale Objekte behalten, wenn sie gleich alt oder neuer sind (offene Formulare halten Referenzen).
      const sessions = {};
      Object.keys(merged.sessions || {}).forEach((id) => {
        const local = state.sessions[id];
        sessions[id] = local && (local.updatedAt || 0) >= (merged.sessions[id].updatedAt || 0) ? local : merged.sessions[id];
      });
      Object.keys(state.sessions).forEach((id) => {
        const local = state.sessions[id];
        const del = (merged.deleted || {})[id] || 0;
        if (!sessions[id] && (local.updatedAt || 0) > del) sessions[id] = local;
      });
      const prefsNewer = (state.prefsUpdatedAt || 0) > (merged.prefsUpdatedAt || 0);
      state = {
        sessions,
        deleted: Object.assign({}, merged.deleted, state.deleted),
        prefs: prefsNewer ? state.prefs : merged.prefs || {},
        prefsUpdatedAt: prefsNewer ? state.prefsUpdatedAt : merged.prefsUpdatedAt || 0,
      };
      saveLocal();
      setSync("✓ gespeichert");
      if (JSON.stringify(state) !== before && !draft && !newSession) render();
    } catch (e) {
      setSync("offline – lokal gespeichert");
    } finally {
      syncing = false;
    }
  }
  window.addEventListener("online", sync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });

  // ---------- Hilfen ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = S.fmt;
  const cls = (v) => (v > 0 ? "plus" : v < 0 ? "minus" : "");
  function euroToCents(str) {
    const n = parseFloat(String(str).replace(",", ".").replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? Math.round(n * 100) : 0;
  }
  function centsToEuro(c) { return (c / 100).toFixed(2).replace(".", ","); }
  function dateStr(ts) {
    return new Date(ts).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function timeStr(ts) { return new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }); }
  function sessionsSorted() {
    return Object.values(state.sessions).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  function getSession(id) { return state.sessions[id]; }
  function pname(session, id) {
    const p = session.players.find((x) => x.id === id);
    return p ? p.name : "?";
  }
  function toast(msg) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }
  function confirmBox(text, okLabel, onOk) {
    modalRoot.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">
      <p>${esc(text)}</p>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-m="cancel">Abbrechen</button>
        <button class="btn primary" data-m="ok">${esc(okLabel)}</button>
      </div></div></div>`;
    modalRoot.querySelector('[data-m="cancel"]').onclick = () => (modalRoot.innerHTML = "");
    modalRoot.querySelector('[data-m="ok"]').onclick = () => { modalRoot.innerHTML = ""; onOk(); };
  }

  // Wer spielt die nächste Runde mit? Bei mehr als 4: Geber setzt aus, Rest der Reihe nach.
  function proposeActive(session) {
    const ps = session.players.filter((p) => !p.away);
    const n = ps.length;
    if (n <= 4) return ps.map((p) => p.id);
    const di = Math.max(0, ps.findIndex((p) => p.id === session.dealer));
    const order = [];
    for (let k = 1; k <= n; k++) order.push(ps[(di + k) % n].id);
    if (n === 5) return order.filter((id) => id !== ps[di].id);
    return order.slice(0, 4);
  }
  function nextDealer(session) {
    const ps = session.players.filter((p) => !p.away);
    if (!ps.length) return null;
    const di = ps.findIndex((p) => p.id === session.dealer);
    return ps[(di + 1) % ps.length].id;
  }

  // ---------- Router ----------
  function route() {
    const h = STANDALONE ? memRoute : location.hash.replace(/^#\/?/, "");
    return h.split("/").filter(Boolean);
  }
  function go(path) {
    if (STANDALONE) { memRoute = path; onRoute(); return; }
    location.hash = "#/" + path;
  }
  if (STANDALONE) {
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#/"]');
      if (!a) return;
      e.preventDefault();
      go(a.getAttribute("href").slice(2));
    });
  } else {
    window.addEventListener("hashchange", onRoute);
  }
  function onRoute() {
    const r = route();
    if (r[2] !== "spiel") draft = null;
    if (r[0] !== "neu") newSession = null;
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const r = route();
    if (!r.length) return renderHome();
    if (r[0] === "neu") return renderNew();
    if (r[0] === "r") {
      const s = getSession(r[1]);
      if (!s) { app.innerHTML = `<div class="empty">Runde nicht gefunden. <a href="#/">Zur Übersicht</a></div>`; return; }
      const sub = r[2] || "stand";
      if (sub === "spiel") return renderGameForm(s, r[3]);
      return renderSession(s, sub);
    }
    renderHome();
  }

  // ---------- Übersicht ----------
  function renderHome() {
    const list = sessionsSorted();
    app.innerHTML = `
      <div class="hero-logo"><span><img src="${LOGO_SRC}" alt="Parkcafé Freising"></span></div>
      <div class="row spread"><h1>Spielrunden</h1><a class="btn primary" href="#/neu">+ Neue Runde</a></div>
      ${list.length ? "" : `<div class="card empty">Noch keine Runde. Leg mit „Neue Runde“ los: Spieler eintragen, Tarif wählen, fertig.</div>`}
      <div class="list">
        ${list.map((s) => {
          const { balances } = S.replay(s);
          const top = s.players.map((p) => `<span class="${cls(balances[p.id])}">${esc(p.name)} ${fmt(balances[p.id] || 0)}</span>`).join(" · ");
          return `<a class="card" href="#/r/${s.id}">
            <div class="row spread"><b>${esc(s.name)}</b><span class="muted small">${dateStr(s.createdAt)}</span></div>
            <div class="small muted">${s.games.length} ${s.games.length === 1 ? "Spiel" : "Spiele"} · Sauspiel ${fmt(S.tarifOf(s).sau, false)} / Solo ${fmt(S.tarifOf(s).solo, false)}</div>
            <div class="small" style="margin-top:4px">${top}</div></a>`;
        }).join("")}
      </div>
      <h2>Sicherung</h2>
      <div class="row">
        <button class="btn small" id="export">Alles exportieren</button>
        <label class="btn small">Importieren<input type="file" id="import" accept="application/json" hidden></label>
      </div>`;
    document.getElementById("export").onclick = exportAll;
    document.getElementById("import").onchange = importAll;
  }

  function exportAll() {
    if (STANDALONE) {
      modalRoot.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">
        <p>Sicherung: diesen Text kopieren und z. B. in eine Notiz einfügen. Zum Wiederherstellen als .json-Datei speichern und importieren.</p>
        <textarea id="export-text" readonly style="width:100%;height:160px;font:12px monospace">${esc(JSON.stringify(state))}</textarea>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-m="close">Schließen</button><button class="btn primary" data-m="copy">Kopieren</button></div></div></div>`;
      modalRoot.querySelector('[data-m="close"]').onclick = () => (modalRoot.innerHTML = "");
      modalRoot.querySelector('[data-m="copy"]').onclick = () => {
        const ta = modalRoot.querySelector("#export-text");
        navigator.clipboard.writeText(ta.value).then(() => toast("Kopiert"), () => { ta.select(); toast("Text markiert – jetzt kopieren"); });
      };
      return;
    }
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `schafkopfrechner-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importAll(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const data = JSON.parse(txt);
        let n = 0;
        Object.values(data.sessions || {}).forEach((s) => {
          if (s && s.id && Array.isArray(s.players) && Array.isArray(s.games)) {
            const cur = state.sessions[s.id];
            if (!cur || (s.updatedAt || 0) > (cur.updatedAt || 0)) { state.sessions[s.id] = s; n++; }
          }
        });
        saveLocal(); scheduleSync(); render(); toast(`${n} Runden importiert`);
      } catch (e) { toast("Datei nicht lesbar"); }
    });
  }

  // ---------- Neue Runde ----------
  function knownNames() {
    const set = new Map();
    sessionsSorted().forEach((s) => s.players.forEach((p) => { if (!set.has(p.name.toLowerCase())) set.set(p.name.toLowerCase(), p.name); }));
    return Array.from(set.values());
  }
  function renderNew() {
    if (!newSession) {
      const last = sessionsSorted()[0];
      newSession = {
        name: "Schafkopf " + new Date().toLocaleDateString("de-DE"),
        names: last ? last.players.map((p) => p.name) : ["", "", "", ""],
        tarif: Object.assign({}, S.DEFAULT_TARIF, (state.prefs && state.prefs.tarif) || (last && last.tarif) || {}),
        rules: Object.assign({}, S.DEFAULT_RULES, (state.prefs && state.prefs.rules) || (last && last.rules) || {}),
      };
    }
    const ns = newSession;
    const names = knownNames().filter((n) => !ns.names.some((x) => x.trim().toLowerCase() === n.toLowerCase()));
    app.innerHTML = `
      <h1>Neue Runde</h1>
      <div class="card">
        <div class="field"><label for="ns-name">Name der Runde</label><input type="text" id="ns-name" value="${esc(ns.name)}"></div>
        <h3>Spieler (3 bis 8, Reihenfolge = Sitzordnung)</h3>
        <div id="ns-players">${ns.names.map((n, i) => `
          <div class="player-row"><input type="text" data-i="${i}" value="${esc(n)}" placeholder="Spieler ${i + 1}" autocomplete="off">
          <button class="iconbtn" data-up="${i}" title="nach oben" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="iconbtn" data-del="${i}" title="entfernen">✕</button></div>`).join("")}</div>
        <div class="row">
          <button class="btn small" id="ns-add" ${ns.names.length >= 8 ? "disabled" : ""}>+ Spieler</button>
          ${names.length ? `<span class="small muted">Bekannt:</span>${names.slice(0, 12).map((n) => `<button class="chip" data-known="${esc(n)}" style="min-height:36px;padding:6px 10px">${esc(n)}</button>`).join("")}` : ""}
        </div>
      </div>
      ${tarifEditor(ns.tarif, ns.rules)}
      <div class="section"><button class="btn primary big" id="ns-go">Runde starten</button></div>`;

    app.querySelector("#ns-name").oninput = (e) => (ns.name = e.target.value);
    app.querySelectorAll("#ns-players input").forEach((inp) => (inp.oninput = (e) => (ns.names[+e.target.dataset.i] = e.target.value)));
    app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { ns.names.splice(+b.dataset.del, 1); renderNew(); }));
    app.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { const i = +b.dataset.up; [ns.names[i - 1], ns.names[i]] = [ns.names[i], ns.names[i - 1]]; renderNew(); }));
    app.querySelector("#ns-add").onclick = () => { ns.names.push(""); renderNew(); app.querySelector(`#ns-players input[data-i="${ns.names.length - 1}"]`).focus(); };
    app.querySelectorAll("[data-known]").forEach((b) => (b.onclick = () => {
      const empty = ns.names.findIndex((x) => !x.trim());
      if (empty >= 0) ns.names[empty] = b.dataset.known; else if (ns.names.length < 8) ns.names.push(b.dataset.known);
      renderNew();
    }));
    bindTarifEditor(ns.tarif, ns.rules, renderNew);
    app.querySelector("#ns-go").onclick = () => {
      const names = ns.names.map((n) => n.trim()).filter(Boolean);
      const uniq = new Set(names.map((n) => n.toLowerCase()));
      if (names.length < 3) return toast("Mindestens 3 Spieler eintragen");
      if (uniq.size !== names.length) return toast("Jeder Name nur einmal");
      const id = uid();
      const players = names.map((n) => ({ id: uid(), name: n }));
      const s = {
        id, name: ns.name.trim() || "Schafkopf", createdAt: now(), updatedAt: now(),
        players, tarif: Object.assign({}, ns.tarif), rules: JSON.parse(JSON.stringify(ns.rules)), games: [], dealer: players[0].id,
      };
      state.sessions[id] = s;
      setPrefs({ tarif: s.tarif, rules: s.rules });
      touch(s);
      newSession = null;
      go("r/" + id);
    };
  }

  // Tarif- und Regel-Editor (für neue Runde und Einstellungen)
  function tarifEditor(tarif, rules) {
    const money = (key, label, show = true) => show ? `<div class="field"><label>${label}</label><input inputmode="decimal" data-tarif="${key}" value="${centsToEuro(tarif[key])}"></div>` : "";
    const toggle = (key, label) => `<button class="chip ${rules[key] ? "on" : ""}" data-rule="${key}">${label}</button>`;
    return `
      <div class="card section">
        <h3>Tarif (in Euro)</h3>
        <div class="grid2">
          ${money("sau", "Sauspiel")}
          ${money("solo", "Solo / Wenz / Geier")}
          ${money("schneider", "Schneider")}
          ${money("schwarz", "Schwarz (zusätzlich)")}
          ${money("laufende", "je Laufender")}
          ${money("bettel", "Bettel", rules.bettel)}
          ${money("ramsch", "Ramsch", rules.ramsch)}
          ${money("durchmarsch", "Durchmarsch", rules.ramsch && rules.durchmarsch)}
          ${money("stock", "Stock-Einsatz je Spieler", rules.stock)}
        </div>
        <div class="row" style="margin-top:10px">
          <span class="small muted">Vorlagen:</span>
          <button class="btn small" data-preset="10/50">10 / 50 ct</button>
          <button class="btn small" data-preset="10/30">10 / 30 ct</button>
          <button class="btn small" data-preset="20/50">20 / 50 ct</button>
          <button class="btn small" data-preset="50/100">50 ct / 1 €</button>
        </div>
        <h3>Spielarten</h3>
        <div class="chips">
          <span class="chip on" style="cursor:default">Sauspiel</span><span class="chip on" style="cursor:default">Farbsolo</span>
          ${toggle("hochzeit", "Hochzeit")}${toggle("wenz", "Wenz")}${toggle("geier", "Geier")}${toggle("farbwenz", "Farbwenz")}
          ${toggle("bettel", "Bettel")}${toggle("ramsch", "Ramsch")}
        </div>
        <h3>Extras</h3>
        <div class="chips">
          ${toggle("tout", "Tout")}${toggle("sie", "Sie")}${toggle("kontra", "Kontra / Re")}${toggle("klopfen", "Klopfen")}
          ${rules.ramsch ? toggle("jungfrau", "Jungfrau (Ramsch)") + toggle("durchmarsch", "Durchmarsch") : ""}
          ${toggle("stock", "Stock")}
        </div>
        ${rules.stock ? `<div class="row" style="margin-top:10px">
          <span class="small muted">Stock gilt für</span>
          <div class="seg"><button data-stockscope="alle" class="${rules.stockScope === "alle" ? "on" : ""}">alle Spiele</button><button data-stockscope="sauspiel" class="${rules.stockScope === "sauspiel" ? "on" : ""}">nur Sauspiel</button></div>
          <span class="small muted">Verloren:</span>
          <div class="seg"><button data-stockloss="double" class="${rules.stockLoss === "double" ? "on" : ""}">Spieler verdoppelt Stock</button><button data-stockloss="none" class="${rules.stockLoss === "none" ? "on" : ""}">Stock bleibt</button></div>
        </div>` : ""}
        <h3>Laufende zählen ab</h3>
        <div class="row">
          ${[["sau", "Sauspiel"], ["solo", "Solo"], ["wenz", "Wenz"], ["geier", "Geier"], ["farbwenz", "Farbwenz"]]
            .filter(([k]) => k === "sau" || k === "solo" || rules[k])
            .map(([k, l]) => `<span class="small">${l}</span><div class="stepper"><button data-laufmin="${k}" data-d="-1">−</button><span>${rules.laufMin[k]}</span><button data-laufmin="${k}" data-d="1">+</button></div>`).join("")}
        </div>
        ${rules.tout || rules.sie ? `<p class="small muted">Tout zählt ×${rules.toutFactor}, Sie ×${rules.sieFactor}. Klopfen, Kontra und Re verdoppeln jeweils.</p>` : ""}
      </div>`;
  }
  function bindTarifEditor(tarif, rules, rerender, onChange) {
    const changed = () => { if (onChange) onChange(); };
    app.querySelectorAll("[data-tarif]").forEach((inp) => (inp.onchange = () => { tarif[inp.dataset.tarif] = Math.max(0, euroToCents(inp.value)); inp.value = centsToEuro(tarif[inp.dataset.tarif]); changed(); }));
    app.querySelectorAll("[data-rule]").forEach((b) => (b.onclick = () => { rules[b.dataset.rule] = !rules[b.dataset.rule]; changed(); rerender(); }));
    app.querySelectorAll("[data-stockscope]").forEach((b) => (b.onclick = () => { rules.stockScope = b.dataset.stockscope; changed(); rerender(); }));
    app.querySelectorAll("[data-stockloss]").forEach((b) => (b.onclick = () => { rules.stockLoss = b.dataset.stockloss; changed(); rerender(); }));
    app.querySelectorAll("[data-laufmin]").forEach((b) => (b.onclick = () => {
      rules.laufMin = Object.assign({}, S.DEFAULT_RULES.laufMin, rules.laufMin);
      const k = b.dataset.laufmin;
      rules.laufMin[k] = Math.min(8, Math.max(1, rules.laufMin[k] + +b.dataset.d));
      changed(); rerender();
    }));
    app.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => {
      const [sau, solo] = b.dataset.preset.split("/").map(Number);
      Object.assign(tarif, { sau, solo, schneider: sau, schwarz: sau, laufende: sau, bettel: Math.round((sau + solo) / 2 / 10) * 10 || sau, ramsch: sau * 2, durchmarsch: solo, stock: sau });
      changed(); rerender();
    }));
  }

  // ---------- Runde ----------
  function tabs(s, sub) {
    const t = [["stand", "Spielstand"], ["verlauf", "Verlauf"], ["abrechnung", "Abrechnung"], ["statistik", "Statistik"], ["einstellungen", "Einstellungen"]];
    return `<nav class="tabs">${t.map(([k, l]) => `<a href="#/r/${s.id}/${k}" class="${sub === k ? "on" : ""}">${l}</a>`).join("")}</nav>`;
  }
  function renderSession(s, sub) {
    const head = `<div class="row spread"><h1>${esc(s.name)}</h1><span class="muted small">${dateStr(s.createdAt)}</span></div>${tabs(s, sub)}`;
    if (sub === "verlauf") return (app.innerHTML = head + viewHistory(s), bindHistory(s));
    if (sub === "abrechnung") return (app.innerHTML = head + viewSettle(s));
    if (sub === "statistik") return (app.innerHTML = head + viewStats(s));
    if (sub === "einstellungen") return (app.innerHTML = head + viewSettings(s), bindSettings(s));
    app.innerHTML = head + viewBoard(s);
    bindBoard(s);
  }

  function viewBoard(s) {
    const rp = S.replay(s);
    const rules = S.rulesOf(s);
    const active = proposeActive(s);
    const last = rp.results[rp.results.length - 1];
    return `
      <div class="scores">
        ${s.players.map((p) => {
          const b = rp.balances[p.id] || 0;
          const out = s.players.length > 4 && !active.includes(p.id);
          const tag = p.id === s.dealer ? `<span class="tag">Geber</span>` : p.away ? `<span class="tag">Pause</span>` : "";
          return `<div class="card score ${out ? "out" : ""}">${tag}<div class="name">${esc(p.name)}</div><div class="bal ${cls(b)}">${fmt(b)}</div>
            ${last && last.deltas[p.id] !== undefined ? `<div class="small ${cls(last.deltas[p.id])}">letztes: ${fmt(last.deltas[p.id])}</div>` : `<div class="small muted">${out ? "setzt aus" : "&nbsp;"}</div>`}</div>`;
        }).join("")}
      </div>
      ${rules.stock ? `<div class="card stockbar"><span>Stock</span><b>${fmt(rp.stock, false)}</b></div>` : ""}
      <div class="section"><button class="btn primary big" id="new-game">Spiel eintragen</button></div>
      <div class="row section">
        ${rules.stock ? `<button class="btn grow" id="zam">Zamgworfen (Stock)</button>` : `<button class="btn grow" id="zam">Zamgworfen</button>`}
        <button class="btn grow" id="undo" ${s.games.length ? "" : "disabled"}>Letztes Spiel rückgängig</button>
      </div>
      <p class="small muted">${s.games.length} ${s.games.length === 1 ? "Spiel" : "Spiele"} · Geber: <b>${esc(pname(s, s.dealer))}</b>${s.players.length > 4 ? " · Es spielen: " + active.map((id) => esc(pname(s, id))).join(", ") : ""}</p>
      ${last ? `<h2>Letztes Spiel</h2>${gameCard(s, last, s.games.length)}` : ""}`;
  }
  function bindBoard(s) {
    app.querySelector("#new-game").onclick = () => go(`r/${s.id}/spiel`);
    app.querySelector("#zam").onclick = () => {
      const rules = S.rulesOf(s);
      const g = { id: uid(), ts: now(), type: "zamgeworfen", active: proposeActive(s), dealer: s.dealer };
      if (!rules.stock) {
        // Ohne Stock nur Geber weitergeben
        s.dealer = nextDealer(s); touch(s); render(); toast("Neu geben – Geber weiter"); return;
      }
      s.games.push(g);
      s.dealer = nextDealer(s);
      touch(s); render(); toast("Zamgworfen: Stock erhöht");
    };
    app.querySelector("#undo").onclick = () => confirmBox("Letztes Spiel wirklich löschen?", "Löschen", () => {
      const g = s.games.pop();
      if (g && g.dealer) s.dealer = g.dealer;
      touch(s); render(); toast("Gelöscht");
    });
    app.querySelectorAll("[data-game]").forEach((el) => (el.onclick = () => go(`r/${s.id}/spiel/${el.dataset.game}`)));
  }

  function describe(s, g) {
    const t = T[g.type];
    if (!t) return "?";
    if (t.stockOnly) return "Zamgworfen";
    if (t.ramsch) {
      if (g.durchmarsch) return `Ramsch – Durchmarsch von ${pname(s, g.durchmarsch)}`;
      return `Ramsch – verloren: ${pname(s, g.loser)}`;
    }
    const who = (g.players || []).map((id) => pname(s, id));
    let label = t.label;
    if (!t.team && g.sie) label += " Sie";
    else if (!t.team && g.tout) label += " Tout";
    if (g.type === "solo" && g.suit) label = `${g.suit}-${label === "Farbsolo" ? "Solo" : label.replace("Farbsolo", "Solo")}`;
    const res = g.won ? "gewonnen" : "verloren";
    const extra = [];
    if (g.schwarz) extra.push("schwarz"); else if (g.schneider) extra.push("Schneider");
    return `${label} ${t.team ? who.join(" + ") : who[0]} ${res}${extra.length ? " (" + extra.join(", ") + ")" : ""}`;
  }
  function gameCard(s, r, nr) {
    const g = r.game;
    return `<div class="card game" data-game="${g.id}">
      <span class="t">${esc(describe(s, g))}</span><span class="n">#${nr} · ${timeStr(g.ts)}</span>
      <span class="small muted" style="grid-column:1/-1">${esc(r.parts.join(" + "))}${r.value ? " = " + fmt(r.value, false) : ""}</span>
      <div class="d">${Object.keys(r.deltas).map((id) => `<span class="${cls(r.deltas[id])}">${esc(pname(s, id))} ${fmt(r.deltas[id])}</span>`).join("")}</div>
    </div>`;
  }

  // ---------- Spiel eintragen / korrigieren ----------
  function renderGameForm(s, gid) {
    const rules = S.rulesOf(s);
    if (!draft || draft.sid !== s.id || (gid && draft.id !== gid)) {
      const existing = gid ? s.games.find((g) => g.id === gid) : null;
      if (gid && !existing) { go(`r/${s.id}`); return; }
      draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), ts: now(), type: "sauspiel", active: proposeActive(s), players: [], won: true, laufende: 0, klopfer: 0, dealer: s.dealer };
      draft.sid = s.id;
      draft.isNew = !existing;
    }
    const d = draft;
    const t = T[d.type];
    const enabled = (k) => !T[k].rule || rules[T[k].rule];
    const types = Object.keys(T).filter((k) => k !== "zamgeworfen" && enabled(k));
    const actives = d.active.filter((id) => s.players.some((p) => p.id === id));
    const pbtn = (id, attr, on, red) => `<button class="chip ${on ? (red ? "on-red" : "on") : ""}" data-${attr}="${id}">${esc(pname(s, id))}</button>`;

    let body = "";
    if (s.players.length > 4) {
      body += `<h3>Wer spielt mit? (${actives.length}/4)</h3><div class="chips">${s.players.map((p) => pbtn(p.id, "act", d.active.includes(p.id))).join("")}</div>`;
    }
    body += `<h3>Spielart</h3><div class="chips">${types.map((k) => `<button class="chip ${d.type === k ? "on" : ""}" data-type="${k}">${T[k].label}</button>`).join("")}</div>`;

    if (t.ramsch) {
      body += `<h3>Wer hat verloren? (meiste Augen)</h3><div class="chips">${actives.map((id) => pbtn(id, "loser", d.loser === id && !d.durchmarsch, true)).join("")}</div>`;
      if (rules.durchmarsch) body += `<h3>Durchmarsch (alle Stiche)</h3><div class="chips">${actives.map((id) => pbtn(id, "dm", d.durchmarsch === id)).join("")}</div>`;
      if (rules.jungfrau && !d.durchmarsch) body += `<h3>Jungfrauen (ohne Stich)</h3>${stepper("jungfrauen", d.jungfrauen || 0)}`;
      if (rules.klopfen) body += `<h3>Geklopft</h3>${stepper("klopfer", d.klopfer || 0)}`;
    } else {
      body += `<h3>${t.team ? (d.type === "hochzeit" ? "Spieler + Partner (Hochzeit)" : "Spieler + Partner (Sau)") : "Wer spielt?"}</h3>
        <div class="chips">${actives.map((id) => pbtn(id, "pl", (d.players || []).includes(id))).join("")}</div>`;
      if (d.type === "solo") body += `<h3>Farbe (optional)</h3><div class="chips">${["Eichel", "Gras", "Herz", "Schellen"].map((f) => `<button class="chip ${d.suit === f ? "on" : ""}" data-suit="${f}">${f}</button>`).join("")}</div>`;
      body += `<h3>Ergebnis</h3><div class="seg win"><button class="yes ${d.won ? "on" : ""}" data-won="1">Gewonnen</button><button class="no ${!d.won ? "on" : ""}" data-won="0">Verloren</button></div>`;
      if (d.type !== "bettel") {
        const sch = d.schwarz ? "schwarz" : d.schneider ? "schneider" : "none";
        body += `<h3>Schneider / Schwarz</h3><div class="seg">${[["none", "nichts"], ["schneider", "Schneider"], ["schwarz", "Schwarz"]].map(([k, l]) => `<button class="${sch === k ? "on" : ""}" data-sch="${k}">${l}</button>`).join("")}</div>`;
        const min = rules.laufMin[t.lauf];
        body += `<h3>Laufende <span class="small" style="text-transform:none">(zählen ab ${min})</span></h3>${stepper("laufende", d.laufende || 0)}`;
      }
      if (!t.team && (rules.tout || rules.sie)) {
        body += `<h3>Tout / Sie</h3><div class="chips">${rules.tout ? `<button class="chip ${d.tout && !d.sie ? "on" : ""}" data-flag="tout">Tout ×${rules.toutFactor}</button>` : ""}${rules.sie ? `<button class="chip ${d.sie ? "on" : ""}" data-flag="sie">Sie ×${rules.sieFactor}</button>` : ""}</div>`;
      }
      const dbl = [];
      if (rules.kontra) dbl.push(`<button class="chip ${d.kontra ? "on" : ""}" data-flag="kontra">Kontra</button>`, `<button class="chip ${d.re ? "on" : ""} ${d.kontra ? "" : "dim"}" data-flag="re">Re</button>`);
      if (dbl.length) body += `<h3>Kontra / Re</h3><div class="chips">${dbl.join("")}</div>`;
      if (rules.klopfen) body += `<h3>Geklopft</h3>${stepper("klopfer", d.klopfer || 0)}`;
    }

    // Vorschau
    const problem = validate(s, d);
    let preview = `<div class="muted">${esc(problem)}</div>`;
    if (!problem) {
      const stockBefore = stockBeforeGame(s, d);
      const r = S.evaluate(s, d, stockBefore);
      preview = `<div class="small muted">${esc(r.parts.join(" + "))} = <b>${fmt(r.value, false)}</b></div>
        <div class="deltas">${Object.keys(r.deltas).map((id) => `<span>${esc(pname(s, id))} <b class="${cls(r.deltas[id])}">${fmt(r.deltas[id])}</b></span>`).join("")}</div>`;
    }
    app.innerHTML = `
      <div class="row spread"><h1>${d.isNew ? "Spiel eintragen" : "Spiel korrigieren"}</h1><a class="btn small" href="#/r/${s.id}">Abbrechen</a></div>
      <div class="card">${body}</div>
      ${!d.isNew ? `<div class="section"><button class="btn danger" id="del-game">Spiel löschen</button></div>` : ""}
      <div class="preview">${preview}<button class="btn primary big" id="save-game" ${problem ? "disabled" : ""}>${d.isNew ? "Eintragen" : "Änderung speichern"}</button></div>`;
    bindGameForm(s);
  }
  function stepper(key, val) {
    return `<div class="stepper"><button data-step="${key}" data-d="-1" aria-label="weniger">−</button><span>${val}</span><button data-step="${key}" data-d="1" aria-label="mehr">+</button></div>`;
  }
  function stockBeforeGame(s, d) {
    const idx = s.games.findIndex((g) => g.id === d.id);
    const games = idx >= 0 ? s.games.slice(0, idx) : s.games;
    return S.replay(Object.assign({}, s, { games })).stock;
  }
  function validate(s, d) {
    const t = T[d.type];
    if (d.active.length !== 4) return "Genau 4 Mitspieler auswählen.";
    if (t.ramsch) return d.durchmarsch || d.loser ? "" : "Wer hat den Ramsch verloren?";
    const n = (d.players || []).length;
    if (t.team && n !== 2) return "Spieler und Partner antippen (2 Personen).";
    if (!t.team && n !== 1) return "Wer hat gespielt?";
    return "";
  }
  function cleanDraft(d) {
    const t = T[d.type];
    const g = { id: d.id, ts: d.ts, type: d.type, active: d.active.slice(), dealer: d.dealer };
    if (d.klopfer) g.klopfer = d.klopfer;
    if (t.ramsch) {
      if (d.durchmarsch) g.durchmarsch = d.durchmarsch;
      else { g.loser = d.loser; if (d.jungfrauen) g.jungfrauen = d.jungfrauen; }
      return g;
    }
    g.players = d.players.slice();
    g.won = !!d.won;
    if (d.type === "solo" && d.suit) g.suit = d.suit;
    if (d.type !== "bettel") {
      if (d.schneider || d.schwarz) g.schneider = true;
      if (d.schwarz) g.schwarz = true;
      if (d.laufende) g.laufende = d.laufende;
    }
    if (!t.team) { if (d.sie) g.sie = true; else if (d.tout) g.tout = true; }
    if (d.kontra) { g.kontra = true; if (d.re) g.re = true; }
    return g;
  }
  function bindGameForm(s) {
    const d = draft;
    const re = () => renderGameForm(s, d.isNew ? undefined : d.id);
    const q = (sel, fn) => app.querySelectorAll(sel).forEach((b) => (b.onclick = () => { fn(b); re(); }));
    q("[data-act]", (b) => {
      const id = b.dataset.act;
      if (d.active.includes(id)) d.active = d.active.filter((x) => x !== id);
      else if (d.active.length < 4) d.active.push(id);
      d.players = (d.players || []).filter((x) => d.active.includes(x));
      if (d.loser && !d.active.includes(d.loser)) d.loser = null;
      if (d.durchmarsch && !d.active.includes(d.durchmarsch)) d.durchmarsch = null;
    });
    q("[data-type]", (b) => {
      const nt = b.dataset.type;
      const wasTeam = T[d.type].team;
      d.type = nt;
      if (T[nt].team !== wasTeam && !T[nt].ramsch) d.players = (d.players || []).slice(0, T[nt].team ? 2 : 1);
    });
    q("[data-pl]", (b) => {
      const id = b.dataset.pl;
      const max = T[d.type].team ? 2 : 1;
      d.players = d.players || [];
      if (d.players.includes(id)) d.players = d.players.filter((x) => x !== id);
      else { d.players.push(id); while (d.players.length > max) d.players.shift(); }
    });
    q("[data-loser]", (b) => { d.loser = b.dataset.loser; d.durchmarsch = null; });
    q("[data-dm]", (b) => { d.durchmarsch = d.durchmarsch === b.dataset.dm ? null : b.dataset.dm; });
    q("[data-suit]", (b) => { d.suit = d.suit === b.dataset.suit ? null : b.dataset.suit; });
    q("[data-won]", (b) => { d.won = b.dataset.won === "1"; });
    q("[data-sch]", (b) => { d.schneider = b.dataset.sch !== "none"; d.schwarz = b.dataset.sch === "schwarz"; });
    q("[data-step]", (b) => { const k = b.dataset.step; d[k] = Math.max(0, Math.min(k === "laufende" ? 8 : k === "jungfrauen" ? 3 : 4, (d[k] || 0) + +b.dataset.d)); });
    q("[data-flag]", (b) => {
      const f = b.dataset.flag;
      if (f === "re" && !d.kontra) return;
      d[f] = !d[f];
      if (f === "sie" && d.sie) d.tout = false;
      if (f === "tout" && d.tout) d.sie = false;
      if (f === "kontra" && !d.kontra) d.re = false;
    });
    const del = app.querySelector("#del-game");
    if (del) del.onclick = () => confirmBox("Dieses Spiel löschen? Die Salden werden neu berechnet.", "Löschen", () => {
      s.games = s.games.filter((g) => g.id !== d.id);
      draft = null; touch(s); go(`r/${s.id}/verlauf`); toast("Spiel gelöscht");
    });
    app.querySelector("#save-game").onclick = () => {
      if (validate(s, d)) return;
      const g = cleanDraft(d);
      if (d.isNew) {
        s.games.push(g);
        s.dealer = nextDealer(s);
      } else {
        s.games = s.games.map((x) => (x.id === g.id ? g : x));
      }
      draft = null;
      touch(s);
      go(`r/${s.id}`);
      toast(d.isNew ? "Eingetragen" : "Korrigiert");
    };
  }

  // ---------- Verlauf ----------
  function viewHistory(s) {
    const rp = S.replay(s);
    if (!rp.results.length) return `<div class="card empty">Noch keine Spiele.</div>`;
    return `<p class="small muted">Antippen zum Korrigieren oder Löschen.</p><div class="list">${rp.results.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => gameCard(s, r, i + 1)).join("")}</div>
      <h2>Tabelle</h2><div class="card tablewrap"><table><thead><tr><th>#</th><th>Spiel</th>${s.players.map((p) => `<th class="r">${esc(p.name)}</th>`).join("")}</tr></thead>
      <tbody>${rp.results.map((r, i) => `<tr><td>${i + 1}</td><td class="small">${esc(T[r.game.type].label)}</td>${s.players.map((p) => `<td class="r ${cls(r.balances[p.id])}">${r.deltas[p.id] === undefined ? `<span class="muted">${centsToEuro(r.balances[p.id] || 0)}</span>` : centsToEuro(r.balances[p.id] || 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function bindHistory(s) {
    app.querySelectorAll("[data-game]").forEach((el) => (el.onclick = () => go(`r/${s.id}/spiel/${el.dataset.game}`)));
  }

  // ---------- Abrechnung ----------
  function viewSettle(s) {
    const rp = S.replay(s);
    const transfers = S.settle(rp.balances);
    const sorted = s.players.slice().sort((a, b) => (rp.balances[b.id] || 0) - (rp.balances[a.id] || 0));
    const rules = S.rulesOf(s);
    return `
      <div class="card"><table><tbody>${sorted.map((p, i) => `<tr><td>${i + 1}.</td><td><b>${esc(p.name)}</b></td><td class="r ${cls(rp.balances[p.id])}"><b>${fmt(rp.balances[p.id] || 0)}</b></td></tr>`).join("")}</tbody></table>
      ${rules.stock && rp.stock ? `<p class="small muted">Im Stock liegen noch ${fmt(rp.stock, false)}. Die sind in den Salden oben schon abgezogen; wie ihr den Rest aufteilt, entscheidet ihr am Tisch.</p>` : ""}</div>
      <h2>Wer zahlt wem</h2>
      ${transfers.length ? `<div class="card"><table><tbody>${transfers.map((t) => `<tr><td>${esc(pname(s, t.from))}</td><td class="muted">zahlt an</td><td>${esc(pname(s, t.to))}</td><td class="r"><b>${fmt(t.amount, false)}</b></td></tr>`).join("")}</tbody></table></div>` : `<div class="card empty">Alles ausgeglichen.</div>`}`;
  }

  // ---------- Statistik ----------
  function viewStats(s) {
    const rp = S.replay(s);
    if (!rp.results.length) return `<div class="card empty">Noch keine Spiele.</div>`;
    const st = {};
    s.players.forEach((p) => (st[p.id] = { played: 0, asPlayer: 0, won: 0, solos: 0, solosWon: 0, ramschLost: 0, best: 0, worst: 0 }));
    const typeCount = {};
    rp.results.forEach((r) => {
      const g = r.game;
      const t = T[g.type];
      typeCount[g.type] = (typeCount[g.type] || 0) + 1;
      Object.keys(r.deltas).forEach((id) => {
        if (!st[id]) return;
        if (!t.stockOnly) st[id].played++;
        st[id].best = Math.max(st[id].best, r.deltas[id]);
        st[id].worst = Math.min(st[id].worst, r.deltas[id]);
      });
      if (t.ramsch) { if (g.loser && st[g.loser]) st[g.loser].ramschLost++; return; }
      (g.players || []).forEach((id) => {
        if (!st[id]) return;
        st[id].asPlayer++;
        if (g.won) st[id].won++;
        if (!t.team) { st[id].solos++; if (g.won) st[id].solosWon++; }
      });
    });
    const pct = (a, b) => (b ? Math.round((a / b) * 100) + " %" : "–");
    return `
      <div class="card">${chart(s, rp)}<div class="legend">${s.players.map((p, i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(p.name)}</span>`).join("")}</div></div>
      <h2>Pro Spieler</h2>
      <div class="card tablewrap"><table><thead><tr><th>Spieler</th><th class="r">Spiele</th><th class="r">selbst gespielt</th><th class="r">davon gewonnen</th><th class="r">Soli</th><th class="r">Ramsch verloren</th><th class="r">bestes</th><th class="r">schlechtestes</th></tr></thead>
      <tbody>${s.players.map((p) => { const x = st[p.id]; return `<tr><td><b>${esc(p.name)}</b></td><td class="r">${x.played}</td><td class="r">${x.asPlayer}</td><td class="r">${pct(x.won, x.asPlayer)}</td><td class="r">${x.solosWon}/${x.solos}</td><td class="r">${x.ramschLost}</td><td class="r plus">${fmt(x.best)}</td><td class="r minus">${fmt(x.worst)}</td></tr>`; }).join("")}</tbody></table></div>
      <h2>Spielarten</h2>
      <div class="chips">${Object.keys(typeCount).map((k) => `<span class="chip" style="cursor:default">${T[k].label}: ${typeCount[k]}</span>`).join("")}</div>`;
  }
  function chart(s, rp) {
    const W = 600, H = 220, P = 28;
    const series = s.players.map((p) => [0].concat(rp.results.map((r) => r.balances[p.id] || 0)));
    const all = series.flat();
    let min = Math.min(0, ...all), max = Math.max(0, ...all);
    if (min === max) { min -= 100; max += 100; }
    const n = series[0].length - 1 || 1;
    const x = (i) => P + (i / n) * (W - 2 * P);
    const y = (v) => H - P - ((v - min) / (max - min)) * (H - 2 * P);
    const lines = series.map((sr, i) => `<polyline fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="2.5" stroke-linejoin="round" points="${sr.map((v, j) => `${x(j).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Saldenverlauf">
      <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" stroke="currentColor" stroke-opacity=".25" stroke-dasharray="4 4"/>
      <text x="2" y="${y(max) + 4}" font-size="11" fill="currentColor" opacity=".6">${centsToEuro(max)}</text>
      <text x="2" y="${y(min) + 4}" font-size="11" fill="currentColor" opacity=".6">${centsToEuro(min)}</text>
      ${lines}</svg>`;
  }

  // ---------- Einstellungen der Runde ----------
  function viewSettings(s) {
    return `
      <div class="card">
        <div class="field"><label>Name der Runde</label><input type="text" id="set-name" value="${esc(s.name)}"></div>
        <h3>Spieler</h3>
        ${s.players.map((p) => `<div class="player-row"><input type="text" data-pname="${p.id}" value="${esc(p.name)}">
          ${s.players.length > 4 ? `<button class="chip ${p.away ? "on-red" : ""}" data-away="${p.id}" style="min-height:40px">${p.away ? "Pause" : "dabei"}</button>` : ""}
          <button class="chip ${s.dealer === p.id ? "on" : ""}" data-dealer="${p.id}" style="min-height:40px">Geber</button></div>`).join("")}
        <div class="row"><input type="text" id="add-player" placeholder="Spieler nachträglich hinzufügen" style="flex:1"><button class="btn" id="add-player-btn">Hinzufügen</button></div>
        <p class="small muted">Mitspieler, die schon Spiele haben, bleiben in der Abrechnung. „Pause“ nimmt jemanden aus der automatischen Auswahl.</p>
      </div>
      <p class="small muted section">Tarifänderungen gelten für die ganze Runde, also auch rückwirkend für schon eingetragene Spiele.</p>
      ${tarifEditor(S.tarifOf(s), S.rulesOf(s))}
      <div class="section row">
        <button class="btn danger" id="del-session">Runde löschen</button>
      </div>`;
  }
  function bindSettings(s) {
    s.tarif = S.tarifOf(s);
    s.rules = S.rulesOf(s);
    app.querySelector("#set-name").onchange = (e) => { s.name = e.target.value.trim() || s.name; touch(s); };
    app.querySelectorAll("[data-pname]").forEach((inp) => (inp.onchange = () => {
      const v = inp.value.trim();
      if (!v || s.players.some((p) => p.id !== inp.dataset.pname && p.name.toLowerCase() === v.toLowerCase())) { inp.value = pname(s, inp.dataset.pname); return toast("Name leer oder doppelt"); }
      s.players.find((p) => p.id === inp.dataset.pname).name = v; touch(s);
    }));
    app.querySelectorAll("[data-away]").forEach((b) => (b.onclick = () => { const p = s.players.find((x) => x.id === b.dataset.away); p.away = !p.away; touch(s); render(); }));
    app.querySelectorAll("[data-dealer]").forEach((b) => (b.onclick = () => { s.dealer = b.dataset.dealer; touch(s); render(); }));
    app.querySelector("#add-player-btn").onclick = () => {
      const v = app.querySelector("#add-player").value.trim();
      if (!v) return;
      if (s.players.length >= 8) return toast("Höchstens 8 Spieler");
      if (s.players.some((p) => p.name.toLowerCase() === v.toLowerCase())) return toast("Name schon vorhanden");
      s.players.push({ id: uid(), name: v }); touch(s); render();
    };
    bindTarifEditor(s.tarif, s.rules, render, () => { touch(s); setPrefs({ tarif: s.tarif, rules: s.rules }); });
    app.querySelector("#del-session").onclick = () => confirmBox(`Runde „${s.name}“ mit ${s.games.length} Spielen endgültig löschen?`, "Löschen", () => {
      delete state.sessions[s.id];
      state.deleted[s.id] = Math.max(now(), (s.updatedAt || 0) + 1);
      saveLocal(); scheduleSync(); go("");
    });
  }

  // ---------- Start ----------
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  render();
  setSync("");
  sync();
})();
