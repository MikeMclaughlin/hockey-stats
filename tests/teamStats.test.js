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

var prior = ts.recordFromSources(
  { seasonId: 20262027, wins: 0, losses: 0, otLosses: 0, gamesPlayed: 0 },
  { seasonId: 20252026, wins: 43, losses: 30, otLosses: 9, gamesPlayed: 82, goalsFor: 261, goalsAgainst: 238 }
);
assert.strictEqual(prior.wins, 43);
assert.strictEqual(prior.losses, 30);
assert.strictEqual(prior.otl, 9);
assert.strictEqual(prior.goalDiff, 23);

var current = ts.recordFromSources(
  { seasonId: 20262027, wins: 1, losses: 0, otLosses: 0, gamesPlayed: 1, pointPctg: 1 },
  { seasonId: 20262027, wins: 1, losses: 0, otLosses: 0, gamesPlayed: 1 }
);
assert.strictEqual(current.wins, 1);
assert.strictEqual(current.otl, 0);

var idle = ts.recordFromSources(
  { seasonId: 20262027, wins: 0, losses: 0, otLosses: 0, gamesPlayed: 0, goalDifferential: 0, goalFor: 0, goalAgainst: 0 },
  null
);
assert.strictEqual(idle.wins, 0);
assert.strictEqual(idle.losses, 0);
assert.strictEqual(idle.otl, 0);
assert.strictEqual(idle.gamesPlayed, 0);
assert.strictEqual(idle.goalDiff, null);
assert.strictEqual(idle.ptsPct, null);
console.log("teamStats.test.js ok");
