"use strict";

var assert = require("assert");
var tf = require("../js/table-filter.js");

assert.strictEqual(tf.matchText("Exact", "ex"), true);
assert.strictEqual(tf.matchText("Miss", "win"), false);
assert.strictEqual(tf.matchText("CAR", ""), true);

var spec = tf.parseNumericFilter(">=2");
assert.strictEqual(tf.matchNumeric(3, spec), true);
assert.strictEqual(tf.matchNumeric(1, spec), false);
assert.strictEqual(tf.matchNumeric(2, tf.parseNumericFilter("2")), true);
assert.strictEqual(tf.matchNumeric(3, tf.parseNumericFilter("1-2")), false);
assert.strictEqual(tf.matchNumeric(2, tf.parseNumericFilter("1-2")), true);

assert.strictEqual(tf.rowMatches({ awayAbbrev: "BOS", totalErr: 2 }, { awayAbbrev: "bo" }, { totalErr: true }), true);
assert.strictEqual(tf.rowMatches({ awayAbbrev: "BOS", totalErr: 2 }, { totalErr: ">=3" }, { totalErr: true }), false);
assert.strictEqual(tf.rowMatches({ verdict: "Exact" }, { verdict: "exact" }, {}), true);

console.log("filter.test.js ok");
