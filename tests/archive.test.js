"use strict";

var assert = require("assert");
var archive = require("../public/js/archive.js");

var store = archive.emptyStore();
var first = archive.freezeEstimate(store, {
  id: 101,
  gameDate: "2026-09-29",
  awayAbbrev: "FLA",
  homeAbbrev: "CAR",
  awayName: "Florida Panthers",
  homeName: "Carolina Hurricanes",
  projectedAway: 3,
  projectedHome: 4
});
assert.strictEqual(first.projectedLabel, "3–4");
assert.strictEqual(first.graded, false);

var again = archive.freezeEstimate(store, {
  id: 101,
  projectedAway: 9,
  projectedHome: 0,
  awayAbbrev: "FLA",
  homeAbbrev: "CAR"
});
assert.strictEqual(again.projectedAway, 3);
assert.strictEqual(again.projectedHome, 4);

archive.applyResult(first, 3, 4, "OFF");
assert.strictEqual(first.correct, true);
assert.strictEqual(first.winnerCorrect, true);
assert.strictEqual(archive.verdict(first), "exact");

var miss = archive.freezeEstimate(store, {
  id: 102,
  gameDate: "2026-09-29",
  awayAbbrev: "MTL",
  homeAbbrev: "TOR",
  projectedAway: 4,
  projectedHome: 2
});
archive.applyResult(miss, 1, 3, "OFF");
assert.strictEqual(miss.correct, false);
assert.strictEqual(miss.winnerCorrect, false);
assert.strictEqual(archive.verdict(miss), "miss");

var winnerOnly = archive.freezeEstimate(store, {
  id: 103,
  gameDate: "2026-09-29",
  awayAbbrev: "NYR",
  homeAbbrev: "BOS",
  projectedAway: 2,
  projectedHome: 4
});
archive.applyResult(winnerOnly, 1, 3, "OFF");
assert.strictEqual(winnerOnly.correct, false);
assert.strictEqual(winnerOnly.winnerCorrect, true);
assert.strictEqual(archive.verdict(winnerOnly), "winner");

var sum = archive.summarize(archive.listEstimates(store));
assert.strictEqual(sum.total, 3);
assert.strictEqual(sum.graded, 3);
assert.strictEqual(sum.exact, 1);
assert.strictEqual(sum.winner, 2);

assert.ok(archive.isFinalState("OFF"));
assert.ok(archive.isFinalState("FINAL"));
assert.ok(!archive.isFinalState("FUT"));

var snaps = archive.emptyStore();
var snap = archive.freezeMatchupArchive(snaps, {
  id: 201,
  estimatedAway: 2,
  estimatedHome: 3,
  awayAbbrev: "BOS",
  homeAbbrev: "NYR",
  awayPills: { pdo: 101 },
  odds: { awayMl: 140, homeMl: -160, total: 6.5 }
});
assert.strictEqual(snap.estimatedLabel, "2–3");
assert.strictEqual(snap.odds.total, 6.5);
archive.freezeMatchupArchive(snaps, {
  id: 201,
  estimatedAway: 9,
  estimatedHome: 9,
  awayAbbrev: "BOS",
  homeAbbrev: "NYR"
});
assert.strictEqual(snaps.byId["201"].estimatedAway, 2);

var future = archive.emptyStore();
archive.freezeEstimate(future, {
  id: 301,
  startTimeUTC: "2026-10-20T23:00:00Z",
  gameState: "FUT",
  projectedAway: 3,
  projectedHome: 4,
  awayAbbrev: "FLA",
  homeAbbrev: "CAR"
});
archive.freezeEstimate(future, {
  id: 301,
  startTimeUTC: "2026-10-20T23:00:00Z",
  gameState: "FUT",
  projectedAway: 1,
  projectedHome: 2,
  awayAbbrev: "FLA",
  homeAbbrev: "CAR"
}, { relock: true, now: "2026-10-10T12:00:00Z" });
assert.strictEqual(future.byId["301"].projectedLabel, "1–2");
assert.strictEqual(future.byId["301"].priorLocks.length, 1);
assert.strictEqual(future.byId["301"].priorLocks[0].projectedLabel, "3–4");

archive.freezeEstimate(future, {
  id: 301,
  startTimeUTC: "2026-10-20T23:00:00Z",
  gameState: "LIVE",
  projectedAway: 0,
  projectedHome: 0,
  awayAbbrev: "FLA",
  homeAbbrev: "CAR"
}, { relock: true, now: "2026-10-20T23:30:00Z" });
assert.strictEqual(future.byId["301"].projectedAway, 1);
assert.strictEqual(future.byId["301"].projectedHome, 2);

console.log("archive.test.js ok");
