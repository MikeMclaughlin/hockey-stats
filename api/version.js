"use strict";
module.exports = function (req, res) {
  req.url = "/api/version";
  return require("../server.js")(req, res);
};
