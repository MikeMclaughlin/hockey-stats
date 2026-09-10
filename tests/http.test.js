"use strict";

var assert = require("assert");
var http = require("http");
var { server } = require("../server.js");

function get(port, path) {
  return new Promise(function (resolve, reject) {
    http.get({ hostname: "127.0.0.1", port: port, path: path }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    }).on("error", reject);
  });
}

var srv = server.listen(0, "127.0.0.1", function () {
  var port = srv.address().port;
  Promise.resolve()
    .then(function () { return get(port, "/api/health"); })
    .then(function (r) {
      assert.strictEqual(r.status, 200);
      var j = JSON.parse(r.body);
      assert.strictEqual(j.ok, true);
      assert.strictEqual(j.service, "hockey-stats");
    })
    .then(function () { return get(port, "/"); })
    .then(function (r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.indexOf("Hockey Stats") !== -1);
      assert.ok(r.body.indexOf("/js/app.js") !== -1);
    })
    .then(function () { return get(port, "/js/stats.js"); })
    .then(function (r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.indexOf("pdoFromShots") !== -1);
    })
    .then(function () { return get(port, "/review.html"); })
    .then(function (r) {
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.indexOf("Estimate review") !== -1);
    })
    .then(function () { return get(port, "/api/estimates"); })
    .then(function (r) {
      assert.strictEqual(r.status, 200);
      var j = JSON.parse(r.body);
      assert.ok(Array.isArray(j.estimates));
      assert.ok(j.summary);
    })
    .then(function () {
      console.log("http.test.js ok");
      srv.close();
    })
    .catch(function (err) {
      console.error(err);
      srv.close();
      process.exit(1);
    });
});
