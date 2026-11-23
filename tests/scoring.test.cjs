const test = require("node:test");
const assert = require("node:assert");
const S = require("../web/scoring.js");
const players = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
const base = { players, tarif: {}, rules: { stock: true } };
const sum = (d) => Object.values(d).reduce((x, y) => x + y, 0);

test("Sauspiel gewonnen mit Schneider und 3 Laufenden", () => {
  const g = { type: "sauspiel", active: ["a", "b", "c", "d"], players: ["a", "c"], won: true, schneider: true, laufende: 3 };
  const r = S.evaluate(base, g, 0);
  assert.strictEqual(r.value, 10 + 10 + 30);
  assert.deepStrictEqual(r.deltas, { a: 50, b: -50, c: 50, d: -50 });
});

test("Laufende unter Minimum zählen nicht", () => {
  const g = { type: "sauspiel", active: ["a", "b", "c", "d"], players: ["a", "c"], won: true, laufende: 2 };
  assert.strictEqual(S.evaluate(base, g, 0).value, 10);
  const w = { type: "wenz", active: ["a", "b", "c", "d"], players: ["a"], won: true, laufende: 2 };
  assert.strictEqual(S.evaluate(base, w, 0).value, 70);
});

test("Solo verloren, Tout, Kontra", () => {
  const g = { type: "solo", active: ["a", "b", "c", "d"], players: ["b"], won: false, tout: true, kontra: true };
  const r = S.evaluate(base, g, 0);
  assert.strictEqual(r.value, 200);
  assert.deepStrictEqual(r.deltas, { a: 200, b: -600, c: 200, d: 200 });
});

test("Ramsch mit Jungfrau und Durchmarsch", () => {
  const g = { type: "ramsch", active: ["a", "b", "c", "d"], loser: "d", jungfrauen: 1 };
  const r = S.evaluate(base, g, 0);
  assert.deepStrictEqual(r.deltas, { a: 40, b: 40, c: 40, d: -120 });
  const dm = { type: "ramsch", active: ["a", "b", "c", "d"], durchmarsch: "a" };
  assert.deepStrictEqual(S.evaluate(base, dm, 0).deltas, { a: 150, b: -50, c: -50, d: -50 });
});

test("Stock: Zamgworfen, verdoppeln, gewinnen, Summe bleibt null", () => {
  const act = ["a", "b", "c", "d", "e"].slice(0, 4);
  const session = Object.assign({}, base, {
    players: players.concat([{ id: "e", name: "e" }]),
    games: [
      { type: "zamgeworfen", active: act },
      { type: "sauspiel", active: act, players: ["a", "b"], won: false },
      { type: "solo", active: ["b", "c", "d", "e"], players: ["e"], won: true },
    ],
  });
  const res = S.replay(session);
  assert.strictEqual(res.results[0].stockAfter, 40);
  assert.strictEqual(res.results[1].stockAfter, 80);
  assert.strictEqual(res.stock, 0);
  assert.strictEqual(sum(res.balances), 0);
  const t = S.settle(res.balances);
  const after = Object.assign({}, res.balances);
  t.forEach((x) => { after[x.from] += x.amount; after[x.to] -= x.amount; });
  assert.ok(Object.values(after).every((v) => v === 0));
});
