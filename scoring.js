// Schafkopfrechner – Abrechnungslogik (ohne DOM, auch mit Node testbar).
(function (root) {
  "use strict";

  const GAME_TYPES = {
    sauspiel: { label: "Sauspiel", team: true, tarif: "sau", lauf: "sau" },
    hochzeit: { label: "Hochzeit", team: true, tarif: "sau", lauf: "sau", rule: "hochzeit" },
    solo: { label: "Farbsolo", team: false, tarif: "solo", lauf: "solo" },
    wenz: { label: "Wenz", team: false, tarif: "solo", lauf: "wenz", rule: "wenz" },
    geier: { label: "Geier", team: false, tarif: "solo", lauf: "geier", rule: "geier" },
    farbwenz: { label: "Farbwenz", team: false, tarif: "solo", lauf: "farbwenz", rule: "farbwenz" },
    bettel: { label: "Bettel", team: false, tarif: "bettel", lauf: null, rule: "bettel" },
    ramsch: { label: "Ramsch", ramsch: true, rule: "ramsch" },
    zamgeworfen: { label: "Zamgworfen", stockOnly: true },
  };

  const DEFAULT_TARIF = {
    sau: 10, // Cent
    solo: 50,
    bettel: 30,
    schneider: 10,
    schwarz: 10,
    laufende: 10,
    ramsch: 20,
    durchmarsch: 50,
    stock: 10,
  };

  const DEFAULT_RULES = {
    hochzeit: true,
    wenz: true,
    geier: false,
    farbwenz: false,
    bettel: false,
    ramsch: true,
    tout: true,
    sie: true,
    kontra: true,
    klopfen: true,
    stock: false,
    stockScope: "alle", // "alle" | "sauspiel"
    stockLoss: "double", // "double" = Verlierer zahlt Stockbetrag ein | "none"
    jungfrau: true,
    durchmarsch: true,
    toutFactor: 2,
    sieFactor: 4,
    laufMin: { sau: 3, solo: 3, wenz: 2, geier: 2, farbwenz: 3 },
  };

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function rulesOf(session) {
    const r = Object.assign(clone(DEFAULT_RULES), session.rules || {});
    r.laufMin = Object.assign(clone(DEFAULT_RULES.laufMin), (session.rules || {}).laufMin || {});
    return r;
  }

  function tarifOf(session) {
    return Object.assign(clone(DEFAULT_TARIF), session.tarif || {});
  }

  // Verteilt einen Betrag möglichst gleich auf n Köpfe (Rest-Cent an die Ersten).
  function split(amount, n) {
    const sign = amount < 0 ? -1 : 1;
    const abs = Math.abs(amount);
    const base = Math.floor(abs / n);
    let rest = abs - base * n;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(sign * (base + (rest > 0 ? 1 : 0)));
      if (rest > 0) rest--;
    }
    return out;
  }

  function laufendeCount(type, game, rules) {
    const t = GAME_TYPES[type];
    if (!t || !t.lauf) return 0;
    const n = Number(game.laufende) || 0;
    return n >= rules.laufMin[t.lauf] ? n : 0;
  }

  // Wert eines Spiels pro Gegenspieler (Cent) und Erklärung.
  function gameValue(session, game) {
    const tarif = tarifOf(session);
    const rules = rulesOf(session);
    const t = GAME_TYPES[game.type];
    const parts = [];
    let v = tarif[t.tarif];
    parts.push(`${t.label} ${fmt(v, false)}`);
    if (game.type !== "bettel") {
      if (game.schneider || game.schwarz) {
        v += tarif.schneider;
        parts.push(`Schneider ${fmt(tarif.schneider, false)}`);
      }
      if (game.schwarz) {
        v += tarif.schwarz;
        parts.push(`Schwarz ${fmt(tarif.schwarz, false)}`);
      }
      const l = laufendeCount(game.type, game, rules);
      if (l) {
        v += l * tarif.laufende;
        parts.push(`${l} Laufende ${fmt(l * tarif.laufende, false)}`);
      }
    }
    if (!t.team && game.sie) {
      v *= rules.sieFactor;
      parts.push(`Sie ×${rules.sieFactor}`);
    } else if (!t.team && game.tout) {
      v *= rules.toutFactor;
      parts.push(`Tout ×${rules.toutFactor}`);
    }
    const doublings = (Number(game.klopfer) || 0) + (game.kontra ? 1 : 0) + (game.re ? 1 : 0);
    if (doublings) {
      v *= Math.pow(2, doublings);
      const d = [];
      if (game.klopfer) d.push(`${game.klopfer}× geklopft`);
      if (game.kontra) d.push("Kontra");
      if (game.re) d.push("Re");
      parts.push(`${d.join(", ")} ×${Math.pow(2, doublings)}`);
    }
    return { value: v, parts };
  }

  // Ergebnis eines Spiels: Gewinne/Verluste je Spieler (Cent), neuer Stock.
  function evaluate(session, game, stockBefore) {
    const tarif = tarifOf(session);
    const rules = rulesOf(session);
    const t = GAME_TYPES[game.type];
    const deltas = {};
    const active = game.active || [];
    active.forEach((id) => (deltas[id] = 0));
    let stock = stockBefore || 0;
    let value = 0;
    let parts = [];
    let stockChange = 0;

    if (!t) return { deltas, stock, value, parts, stockChange };

    if (t.stockOnly) {
      const amount = tarif.stock;
      active.forEach((id) => (deltas[id] -= amount));
      stockChange = amount * active.length;
      stock += stockChange;
      parts = [`Jeder zahlt ${fmt(amount, false)} in den Stock`];
      return { deltas, stock, value: amount, parts, stockChange };
    }

    if (t.ramsch) {
      const doublings = (game.jungfrauen || 0) + (Number(game.klopfer) || 0);
      if (game.durchmarsch) {
        value = tarif.durchmarsch * Math.pow(2, Number(game.klopfer) || 0);
        parts = [`Durchmarsch ${fmt(tarif.durchmarsch, false)}`];
        if (game.klopfer) parts.push(`${game.klopfer}× geklopft ×${Math.pow(2, game.klopfer)}`);
        active.forEach((id) => {
          if (id !== game.durchmarsch) {
            deltas[id] -= value;
            deltas[game.durchmarsch] += value;
          }
        });
      } else {
        value = tarif.ramsch * Math.pow(2, doublings);
        parts = [`Ramsch ${fmt(tarif.ramsch, false)}`];
        if (game.jungfrauen) parts.push(`${game.jungfrauen} Jungfrau ×${Math.pow(2, game.jungfrauen)}`);
        if (game.klopfer) parts.push(`${game.klopfer}× geklopft ×${Math.pow(2, game.klopfer)}`);
        active.forEach((id) => {
          if (id !== game.loser) {
            deltas[id] += value;
            deltas[game.loser] -= value;
          }
        });
      }
      return { deltas, stock, value, parts, stockChange };
    }

    const gv = gameValue(session, game);
    value = gv.value;
    parts = gv.parts;
    const party = (game.players || []).filter((id) => active.includes(id));
    const others = active.filter((id) => !party.includes(id));
    const sign = game.won ? 1 : -1;

    if (t.team) {
      party.forEach((id) => (deltas[id] += sign * value));
      others.forEach((id) => (deltas[id] -= sign * value));
    } else {
      const soloist = party[0];
      deltas[soloist] += sign * value * others.length;
      others.forEach((id) => (deltas[id] -= sign * value));
    }

    // Stock
    const stockApplies =
      rules.stock && stock > 0 && party.length && (rules.stockScope === "alle" || game.type === "sauspiel");
    if (stockApplies) {
      if (game.won) {
        const shares = split(stock, party.length);
        party.forEach((id, i) => (deltas[id] += shares[i]));
        stockChange = -stock;
        parts.push(`Stock ${fmt(stock, false)} gewonnen`);
        stock = 0;
      } else if (rules.stockLoss === "double") {
        const shares = split(stock, party.length);
        party.forEach((id, i) => (deltas[id] -= shares[i]));
        stockChange = stock;
        parts.push(`Stock verdoppelt (+${fmt(stock, false)})`);
        stock += stockChange;
      }
    }
    return { deltas, stock, value, parts, stockChange };
  }

  // Läuft über alle Spiele einer Runde.
  function replay(session) {
    const balances = {};
    (session.players || []).forEach((p) => (balances[p.id] = 0));
    let stock = 0;
    const results = [];
    (session.games || []).forEach((g) => {
      const r = evaluate(session, g, stock);
      stock = r.stock;
      Object.keys(r.deltas).forEach((id) => {
        balances[id] = (balances[id] || 0) + r.deltas[id];
      });
      results.push(Object.assign({ game: g, balances: Object.assign({}, balances), stockAfter: stock }, r));
    });
    return { balances, stock, results };
  }

  // Minimale Zahlungen, damit alle ausgeglichen sind. Stock-Rest bleibt außen vor.
  function settle(balances) {
    const debtors = [];
    const creditors = [];
    Object.keys(balances).forEach((id) => {
      const b = balances[id];
      if (b < 0) debtors.push({ id, amount: -b });
      else if (b > 0) creditors.push({ id, amount: b });
    });
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);
    const transfers = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const x = Math.min(debtors[i].amount, creditors[j].amount);
      if (x > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: x });
      debtors[i].amount -= x;
      creditors[j].amount -= x;
      if (debtors[i].amount === 0) i++;
      if (creditors[j].amount === 0) j++;
    }
    return transfers;
  }

  function fmt(cents, signed) {
    const s = (Math.abs(cents) / 100).toFixed(2).replace(".", ",") + " €";
    if (signed === false) return s;
    if (cents > 0) return "+" + s;
    if (cents < 0) return "−" + s;
    return s;
  }

  const api = { GAME_TYPES, DEFAULT_TARIF, DEFAULT_RULES, rulesOf, tarifOf, gameValue, evaluate, replay, settle, fmt, split };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof self !== "undefined" ? self : this);
