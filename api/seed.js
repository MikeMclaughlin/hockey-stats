"use strict";
module.exports = function (req, res) {
  req.url = "/api/seed";
  return require("../server.js")(req, res);
};
