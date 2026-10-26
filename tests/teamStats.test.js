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

var pdo = ts.pdoFromShots(3, 0, 23, 24);
assert.strictEqual(pdo, 113);

var b2bGames = [
  { id: 1, gameState: "OFF", gameType: 2, gameDate: "2026-10-01", awayTeam: { abbrev: "BOS", score: 2 }, homeTeam: { abbrev: "TOR", score: 1 }, gameOutcome: { lastPeriodType: "REG" } },
  { id: 2, gameState: "OFF", gameType: 2, gameDate: "2026-10-02", awayTeam: { abbrev: "MTL", score: 4 }, homeTeam: { abbrev: "BOS", score: 3 }, gameOutcome: { lastPeriodType: "OT" } },
  { id: 3, gameState: "OFF", gameType: 2, gameDate: "2026-10-04", awayTeam: { abbrev: "BOS", score: 5 }, homeTeam: { abbrev: "NYR", score: 1 }, gameOutcome: { lastPeriodType: "REG" } },
  { id: 4, gameState: "FINAL", gameType: 1, gameDate: "2026-09-25", awayTeam: { abbrev: "BOS", score: 1 }, homeTeam: { abbrev: "PHI", score: 0 }, gameOutcome: { lastPeriodType: "REG" } }
];
var b2b = ts.b2bFromGames(b2bGames, "BOS");
assert.strictEqual(b2b.b2bGames, 1);
assert.strictEqual(b2b.b2bWins, 0);
assert.strictEqual(b2b.b2bRecord, "0–1");
assert.strictEqual(b2b.b2bWinPct, 0);

var shots = { 1: { away: 30, home: 20 }, 2: { away: 25, home: 28 } };
var last = ts.attachShots(ts.finishedGames(b2bGames, "BOS", 2).slice(0, 2), shots);
assert.strictEqual(ts.last5Pdo(last) != null, true);

var blank = ts.row(
  { abbrev: "COL", name: "Colorado Avalanche" },
  { seasonId: 20262027, wins: 0, losses: 0, otLosses: 0, gamesPlayed: 0 },
  {},
  { games: 0, w: 0, l: 0, ot: 0, gfGp: null, gaGp: null, list: [] }
);
var preGames = [
  { id: 9, gameState: "FINAL", gameType: 1, gameDate: "2026-09-22", awayTeam: { abbrev: "COL", score: 3 }, homeTeam: { abbrev: "DAL", score: 2 }, gameOutcome: { lastPeriodType: "REG" } },
  { id: 10, gameState: "FINAL", gameType: 1, gameDate: "2026-09-24", awayTeam: { abbrev: "VGK", score: 1 }, homeTeam: { abbrev: "COL", score: 4 }, periodDescriptor: { periodType: "SO" } }
];
ts.applyPreseason(blank, preGames, "COL", { 9: { away: 28, home: 22 }, 10: { away: 20, home: 30 } }, null);
assert.strictEqual(blank.wins, 2);
assert.strictEqual(blank.losses, 0);
assert.strictEqual(blank.preseason.record, true);
assert.strictEqual(blank.preseason.pdo, true);
assert.ok(blank.pdo > 100);
assert.strictEqual(blank.preseason.l5pdo, true);
console.log("teamStats.test.js ok");
