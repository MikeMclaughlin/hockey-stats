"use strict";

var assert = require("assert");
var stats = require("../public/js/stats.js");

var strong = {
  ptsPct: 0.72, goalDiff: 80, pdo: 102, last5AvgGd: 1.4,
  sogShare: 54, gfMinusXg: 12, cfPct: 54, hdcfPct: 56, xgfPct5v5: 55
};
var weak = {
  ptsPct: 0.38, goalDiff: -40, pdo: 97, last5AvgGd: -1.1,
  sogShare: 46, gfMinusXg: -8, cfPct: 46, hdcfPct: 44, xgfPct5v5: 45
};

var e1 = stats.matchupEdge(strong, weak);
assert.strictEqual(e1.winner, "away");
assert.ok(e1.score > 0);
assert.strictEqual(e1.totalMeasures, 11);
assert.strictEqual(e1.measured, 9);
assert.strictEqual(e1.lowData, false);

var sparse = stats.matchupEdge({ ptsPct: 0.5, goalDiff: 1 }, { ptsPct: 0.4 });
assert.strictEqual(sparse.measured, 1);
assert.strictEqual(sparse.totalMeasures, 11);
assert.strictEqual(sparse.lowData, true);

var e2 = stats.matchupEdge(weak, strong);
assert.strictEqual(e2.winner, "home");
assert.ok(e2.score < 0);

var even = stats.matchupEdge(strong, strong);
assert.strictEqual(even.winner, "home");
assert.ok(even.breakdown.length === 11);

var awayTeam = { name: "Boston Bruins" };
var homeTeam = { name: "Toronto Maple Leafs" };
var whyAway = stats.explainEdge(e1, awayTeam, homeTeam);
assert.ok(whyAway.indexOf("Boston Bruins") !== -1);
assert.ok(whyAway.indexOf("pick") !== -1);
var whyEven = stats.explainEdge(even, awayTeam, homeTeam);
assert.ok(whyEven.indexOf("Toronto Maple Leafs") !== -1);

var whyFlip = stats.explainEdge(e1, {
  name: "Boston Bruins", xgfPct5v5: 55, pdo: 103, b2b: true
}, {
  name: "Toronto Maple Leafs", xgfPct5v5: 45, pdo: 99, b2b: false
}, "home");
assert.strictEqual(
  whyFlip,
  "Toronto Maple Leafs is the pick: even-strength expected-goals share 45% to 55%; home ice; the other side played last night."
);

assert.strictEqual(stats.pillSign(12, "gd"), "pos");
assert.strictEqual(stats.pillSign(-8, "gd"), "neg");
assert.strictEqual(stats.pillSign(101.4, "pdo"), "pos");
assert.strictEqual(stats.pillSign(98.2, "pdo"), "neg");
assert.strictEqual(stats.pillSign(54, "cf"), "pos");
assert.strictEqual(stats.pillSign(46, "sogShare"), "neg");
assert.strictEqual(stats.pillSign(50, "cf"), "even");
assert.strictEqual(stats.pillSign(55, "hdcf"), "pos");
assert.strictEqual(stats.pillSign(44, "hdcf"), "neg");
assert.strictEqual(stats.pillSign(null, "gd"), null);

console.log("edge.test.js ok");
