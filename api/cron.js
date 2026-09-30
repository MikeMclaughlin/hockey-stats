"use strict";
module.exports = function (req, res) {
  req.url = "/api/cron";
  return require("../server.js")(req, res);
};
