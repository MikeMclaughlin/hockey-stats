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
assert.ok(out.rows[6].awayLast5 != null);

var csv = [
  "team,season,name,gameId,playerTeam,opposingTeam,home_or_away,gameDate,position,situation,xGoalsFor,xGoalsAgainst,shotsOnGoalFor,shotsOnGoalAgainst,goalsFor,goalsAgainst",
  "BOS,2025,BOS,1,BOS,TOR,HOME,20251008,Team Level,all,3,2,30,28,4,2",
  "BOS,2025,BOS,1,BOS,TOR,HOME,20251008,Team Level,5on5,2.2,1.8,22,20,2,1"
].join("\n");
var parsed = backtest.parseTeamGameCsv(csv, "2025");
assert.strictEqual(parsed.length, 1);
assert.strictEqual(parsed[0].sf, 30);
assert.ok(parsed[0].xgf5 > 2);

console.log("backtest.test.js ok");
