"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var edge = require("../public/js/edge-model.js");

function titleOf(model) {
  var title = edge.labelTitle(model);
  if (model.downgraded) {
    assert.strictEqual(
      title.indexOf("Lowered from " + model.labelBefore + " to " + model.label),
      0
    );
    assert.ok(title.indexOf("last-5 xG") !== -1, title);
    assert.ok(title.indexOf("The side was not flipped.") !== -1, title);
    if (!(model.pickPct < 55)) assert.strictEqual(title.indexOf("under 55%"), -1, title);
    if (!(model.pickPct >= 65)) assert.strictEqual(title.indexOf("65% or more"), -1, title);
  }
  return title;
}

var njd = {
  pickAbbrev: "NJD",
  pickPct: 63.4,
  label: "Toss-up",
  labelBefore: "Lean",
  downgraded: true
};
var njdTitle = titleOf(njd);
assert.strictEqual(
  njdTitle,
  "Lowered from Lean to Toss-up because the pick's last-5 xG share is below the opponent. Calibrated win chance 63.4%. The side was not flipped."
);

var confidentDrop = edge.assess({
  awayAbbrev: "AAA",
  homeAbbrev: "BBB",
  awayXg: 42,
  homeXg: 58,
  awayLast5Xg: 60,
  homeLast5Xg: 44,
  awayLast5: -0.4,
  homeLast5: 1.2,
  awayPdo: 98,
  homePdo: 103,
  awaySv: 0.88,
  homeSv: 0.93,
  projectedAway: 2,
  projectedHome: 4
});
assert.strictEqual(confidentDrop.pick, "home");
assert.ok(confidentDrop.pickPct >= 65, String(confidentDrop.pickPct));
assert.strictEqual(confidentDrop.labelBefore, "Confident");
assert.strictEqual(confidentDrop.label, "Lean");
assert.strictEqual(confidentDrop.downgraded, true);
var confidentTitle = titleOf(confidentDrop);
assert.ok(confidentTitle.indexOf("Lowered from Confident to Lean") === 0, confidentTitle);
assert.strictEqual(confidentTitle.indexOf("65% or more"), -1, confidentTitle);
assert.strictEqual(confidentTitle.indexOf("under 55%"), -1, confidentTitle);

var leanDrop = edge.assess({
  awayAbbrev: "NJD",
  homeAbbrev: "DET",
  awayXg: 48,
  homeXg: 52,
  awayLast5Xg: 55,
  homeLast5Xg: 47,
  awayLast5: 0,
  homeLast5: 0.2,
  awayPdo: 100,
  homePdo: 100.4,
  awaySv: 0.905,
  homeSv: 0.91,
  projectedAway: 2.6,
  projectedHome: 3.1
});
assert.strictEqual(leanDrop.pick, "home");
assert.ok(leanDrop.pickPct >= 55 && leanDrop.pickPct < 65, String(leanDrop.pickPct));
assert.strictEqual(leanDrop.labelBefore, "Lean");
assert.strictEqual(leanDrop.label, "Toss-up");
var leanTitle = titleOf(leanDrop);
assert.ok(leanTitle.indexOf("Lowered from Lean to Toss-up") === 0, leanTitle);
assert.ok(leanTitle.indexOf(leanDrop.pickPct + "%") !== -1, leanTitle);
assert.strictEqual(leanTitle.indexOf("under 55%"), -1, leanTitle);

assert.strictEqual(
  edge.labelTitle({ label: "Toss-up", pickPct: 51.3, labelBefore: "Toss-up", downgraded: false }),
  "Toss-up, under 55%. Calibrated win chance 51.3%."
);
assert.strictEqual(
  edge.labelTitle({ label: "Lean", pickPct: 60, downgraded: false }),
  "Lean, from 55% up to 65%. Calibrated win chance 60%."
);
assert.strictEqual(
  edge.labelTitle({ label: "Confident", pickPct: 72, downgraded: false }),
  "Confident at 65% or more. Calibrated win chance 72%."
);

var file = path.join(__dirname, "../public/data/backtest-20262027.json");
var rows = JSON.parse(fs.readFileSync(file, "utf8")).rows || [];
rows.forEach(function (row) {
  var model = edge.fromBacktestRow(row);
  var title = titleOf(model);
  if (model.label === "Toss-up" && !(model.pickPct < 55)) {
    assert.strictEqual(title.indexOf("under 55%"), -1, title);
  }
  if (model.label === "Confident" && !(model.pickPct >= 65)) {
    assert.strictEqual(title.indexOf("65% or more"), -1, title);
  }
});

console.log("model-label.test.js ok");
