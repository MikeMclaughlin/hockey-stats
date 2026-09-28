"use strict";

var assert = require("assert");
var ts = require("../public/js/teamStats.js");

var games = [
  { gameState: "OFF", gameType: 2, awayTeam: { abbrev: "TOR", score: 3 }, homeTeam: { abbrev: "BOS", score: 2 }, gameOutcome: { lastPeriodType: "REG" } },
  { gameState: "OFF", gameType: 2, awayTeam: { abbrev: "MTL", score: 2 }, homeTeam: { abbrev: "TOR", score: 1 }, gameOutcome: { lastPeriodType: "OT" } },
  { gameState: "OFF", gameType: 2, awayTeam: { abbrev: "TOR", score: 0 }, homeTeam: { abbrev: "NYR", score: 4 }, gameOutcome: { lastPeriodType: "REG" } },
  { gameState: "OFF", gameType: 2, awayTeam: { abbrev: "OTT", score: 1 }, homeTeam: { abbrev: "TOR", score: 5 }, gameOutcome: { lastPeriodType: "REG" } },
  { gameState: "OFF", gameType: 2, awayTeam: { abbrev: "TOR", score: 2 }, homeTeam: { abbrev: "DET", score: 3 }, gameOutcome: { lastPeriodType: "SO" } }
];
var form = ts.last5Form(games, "TOR");
assert.strictEqual(form.games, 5);
assert.strictEqual(form.w, 2);
assert.strictEqual(form.l, 1);
assert.strictEqual(form.ot, 2);

var row = ts.row(
  { abbrev: "TOR", name: "Toronto Maple Leafs" },
  { wins: 4, losses: 2, otLosses: 1 },
  { shotsForPerGame: 31.2, shotsAgainstPerGame: 27.4 },
  form
);
assert.strictEqual(row.abbrev, "TOR");
assert.strictEqual(row.l5ot, 2);
assert.strictEqual(row.sogGp, 31.2);
console.log("teamStats.test.js ok");
