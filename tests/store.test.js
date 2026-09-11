"use strict";

var assert = require("assert");
var path = require("path");
var fs = require("fs");

delete process.env.BLOB_READ_WRITE_TOKEN;
var store = require("../public/js/store.js");

assert.strictEqual(store.usesBlob(), false);
assert.strictEqual(store.KEYS.estimates, "estimates.json");

var tmpName = "store-test.json";
var payload = { ok: true, n: 7 };
return store.writeJson(tmpName, payload).then(function () {
  return store.readJson(tmpName, null);
}).then(function (got) {
  assert.strictEqual(got.n, 7);
  fs.unlinkSync(path.join(__dirname, "..", "data", tmpName));
  console.log("store.test.js ok");
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
