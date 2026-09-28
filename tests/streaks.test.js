"use strict";

var assert = require("assert");
var streaks = require("../public/js/streaks.js");

var box = {
  id: 1,
  gameDate: "2026-09-20",
  awayTeam: { abbrev: "TOR" },
  homeTeam: { abbrev: "BOS" },
  playerByGameStats: {
    awayTeam: {
      forwards: [{ playerId: 10, name: { default: "Auston Matthews" }, goals: 2, assists: 1, shots: 5, missedShots: 2 }],
      defense: []
    },
    homeTeam: {
      forwards: [{ playerId: 20, name: { default: "David Pastrnak" }, goals: 0, assists: 0, shots: 1 }],
      defense: []
    }
  }
};
var rows = streaks.parseBoxscore(box);
assert.strictEqual(rows.length, 2);
assert.strictEqual(rows[0].points, 3);
assert.strictEqual(rows[0].attempts, 7);

var games = [];
for (var i = 0; i < 5; i++) {
  games.push({ playerId: 10, name: "Auston Matthews", team: "TOR", gameDate: "2026-09-2" + i, goals: 1, assists: 1, points: 2, sog: 4, attempts: 6 });
}
var hit = streaks.streakForPlayer(games, "sog", 3, 5);
assert.ok(hit);
assert.strictEqual(hit.total, 20);
assert.strictEqual(streaks.streakForPlayer(games, "sog", 5, 5), null);

var tables = streaks.buildTables(games.concat(rows), { length: 5, minSog: 3 });
assert.ok(tables.tables.sog.rows.length >= 1);
console.log("streaks.test.js ok");
