"use strict";
module.exports = function (req, res) {
  var q = String(req.url || "").indexOf("?");
  req.url = "/api/estimates" + (q >= 0 ? String(req.url).slice(q) : "");
  return require("../server.js")(req, res);
};
