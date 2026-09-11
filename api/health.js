"use strict";
module.exports = function (req, res) {
  req.url = "/api/health";
  return require("../server.js")(req, res);
};
