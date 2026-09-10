"use strict";

var assert = require("assert");
var stats = require("../js/stats.js");

assert.strictEqual(stats.recordString(53, 22, 7), "53–22–7");
assert.ok(Math.abs(stats.pointsPct(53, 22, 7) - (53 * 2 + 7) / (82 * 2)) < 1e-9);

var pdo = stats.pdoFromShots(250, 220, 2500, 2400);
assert.ok(pdo > 90 && pdo < 110, "pdo in range " + pdo);

assert.strictEqual(stats.sogShare(30, 20), 60);
assert.strictEqual(stats.pdoFromShots(1, 1, 0, 10), null);

var games = [
  { gameState: "OFF", homeTeam: { abbrev: "BOS", score: 4 }, awayTeam: { abbrev: "TOR", score: 1 } },
  { gameState: "OFF", homeTeam: { abbrev: "MTL", score: 2 }, awayTeam: { abbrev: "BOS", score: 3 } },
  { gameState: "OFF", homeTeam: { abbrev: "BOS", score: 1 }, awayTeam: { abbrev: "CAR", score: 2 } },
  { gameState: "OFF", homeTeam: { abbrev: "NYR", score: 5 }, awayTeam: { abbrev: "BOS", score: 2 } },
  { gameState: "OFF", homeTeam: { abbrev: "BOS", score: 3 }, awayTeam: { abbrev: "BUF", score: 3 } },
  { gameState: "FUT", homeTeam: { abbrev: "BOS", score: 0 }, awayTeam: { abbrev: "CHI", score: 0 } }
];
var l5 = stats.last5GoalDiff(games, "BOS");
assert.strictEqual(l5.games, 5);
assert.strictEqual(l5.total, 3 - 1 + 1 - 3 + 0);

var csv = [
  "team,season,name,position,situation,games_played,xGoalsFor,xGoalsAgainst,xGoalsPercentage,shotsOnGoalFor,shotsOnGoalAgainst,shotAttemptsFor,shotAttemptsAgainst,goalsFor,goalsAgainst,highDangerShotsFor,highDangerShotsAgainst",
  "BOS,2025,BOS,Team Level,5on5,82,200,180,0.526,2000,1900,4000,3800,210,190,400,380",
  "BOS,2025,BOS,Team Level,all,82,250,240,0.51,2500,2400,5000,4800,270,250,800,600"
].join("\n");
var mp = stats.parseMoneyPuckCsv(csv);
assert.ok(mp.BOS);
assert.strictEqual(mp.BOS.goalsFor, 270);
assert.ok(mp.BOS.cfPct > 50);
assert.strictEqual(mp.BOS.hdcfPct, 57.1);
assert.strictEqual(mp.BOS.xgfPct5v5, 52.6);

var profile = stats.buildTeamProfile({
  abbrev: "BOS",
  name: "Boston Bruins",
  stand: { wins: 40, losses: 30, otLosses: 12, gamesPlayed: 82, goalDifferential: 8, goalFor: 250, goalAgainst: 242 },
  summary: { shotsForPerGame: 30, shotsAgainstPerGame: 28, gamesPlayed: 82 },
  moneypuck: mp.BOS,
  last5: l5
});
assert.strictEqual(profile.record, "40–30–12");
assert.ok(profile.pdo != null);
assert.ok(profile.cfPct != null);
assert.strictEqual(profile.hdcfPct, 57.1);

var est = stats.estimateScore(profile, {
  name: "Toronto Maple Leafs",
  gamesPlayed: 82,
  goalsFor: 280,
  goalsAgainst: 230,
  xGoalsFor: 260,
  last5AvgGd: 0.8,
  hdcfPct: 52
});
assert.ok(est.away >= 1 && est.home >= 1);
assert.ok(est.label.indexOf("–") !== -1);

var parsed = stats.parsePartnerOdds({
  awayTeam: { odds: [
    { description: "MONEY_LINE_2_WAY", value: 110, qualifier: "" },
    { description: "OVER_UNDER", value: -120, qualifier: "U6.5" }
  ] },
  homeTeam: { odds: [
    { description: "MONEY_LINE_2_WAY", value: -130, qualifier: "" },
    { description: "OVER_UNDER", value: 100, qualifier: "O6.5" }
  ] }
});
assert.strictEqual(parsed.awayMl, 110);
assert.strictEqual(parsed.homeMl, -130);
assert.strictEqual(parsed.total, 6.5);
assert.strictEqual(stats.formatAmerican(-130), "-130");
assert.strictEqual(stats.formatAmerican(110), "+110");

console.log("stats.test.js ok");
