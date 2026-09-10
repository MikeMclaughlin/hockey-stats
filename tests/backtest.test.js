"use strict";

var assert = require("assert");
var backtest = require("../js/backtest.js");

var sched = {
  games: [
    { id: 1, gameType: 2, gameState: "OFF", gameDate: "2025-10-08", startTimeUTC: "2025-10-08T00:00:00Z",
      awayTeam: { abbrev: "TOR", score: 2 }, homeTeam: { abbrev: "BOS", score: 3 } },
    { id: 2, gameType: 2, gameState: "OFF", gameDate: "2025-10-09", startTimeUTC: "2025-10-09T00:00:00Z",
      awayTeam: { abbrev: "BOS", score: 4 }, homeTeam: { abbrev: "MTL", score: 1 } },
    { id: 1, gameType: 2, gameState: "OFF", gameDate: "2025-10-08", startTimeUTC: "2025-10-08T00:00:00Z",
      awayTeam: { abbrev: "TOR", score: 2 }, homeTeam: { abbrev: "BOS", score: 3 } }
  ]
};
var games = backtest.collectGames([sched, sched]);
assert.strictEqual(games.length, 2);
assert.strictEqual(games[0].id, 1);

var many = [];
for (var i = 0; i < 12; i++) {
  many.push({
    id: 100 + i,
    gameDate: "2025-11-" + String(10 + i),
    startTimeUTC: "2025-11-" + String(10 + i) + "T00:00:00Z",
    awayAbbrev: "AAA",
    homeAbbrev: "BBB",
    actualAway: 2,
    actualHome: 3
  });
}
var out = backtest.run(many, { minGp: 5 });
assert.strictEqual(out.summary.skipped, 5);
assert.ok(out.summary.graded >= 7);
assert.ok(out.summary.winnerPct != null);
assert.ok(out.rows.some(function (r) { return r.graded && r.projectedLabel; }));

console.log("backtest.test.js ok");
