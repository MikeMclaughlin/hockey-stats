(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyStore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var fs = require("fs");
  var path = require("path");

  var ROOT = path.join(__dirname, "..", "..");
  var DATA = path.join(ROOT, "data");
  var PREFIX = "hockey-stats/";

  var KEYS = {
    estimates: "estimates.json",
    backtest: "backtest-20252026.json",
    mpGames: "mp-games-2025.json",
    matchups: "matchups.json",
    playerGames: "player-games.json"
  };

  var lastWrite = { at: null, name: null, error: null };

  function loadEnvLocal() {
    var file = path.join(ROOT, ".env.local");
    var raw;
    try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return; }
    raw.split(/\r?\n/).forEach(function (line) {
      var s = line.trim();
      if (!s || s.charAt(0) === "#") return;
      var i = s.indexOf("=");
      if (i < 1) return;
      var k = s.slice(0, i).trim();
      var v = s.slice(i + 1).trim();
      if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
          (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
        v = v.slice(1, -1);
      }
      if (process.env[k] == null || process.env[k] === "") process.env[k] = v;
    });
  }

  loadEnvLocal();

  function blobToken() {
    return String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  }

  function usesBlob() {
    return blobToken().length > 0;
  }

  function localPath(name) {
    return path.join(DATA, name);
  }

  function blobPath(name) {
    return PREFIX + name;
  }

  function readLocal(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(localPath(name), "utf8"));
    } catch (e) {
      return fallback;
    }
  }

  function writeLocal(name, body) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(localPath(name), JSON.stringify(body, null, 2));
  }

  function blobApi() {
    return require("@vercel/blob");
  }

  async function readBlob(name, fallback) {
    var token = blobToken();
    try {
      var api = blobApi();
      var listed = await api.list({ prefix: blobPath(name), token: token, limit: 20 });
      var blobs = (listed && listed.blobs) || [];
      var hit = null;
      for (var i = 0; i < blobs.length; i++) {
        if (blobs[i].pathname === blobPath(name)) { hit = blobs[i]; break; }
      }
      if (!hit && blobs.length === 1) hit = blobs[0];
      if (!hit) return fallback;
      var res = await fetch(hit.url, {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) return fallback;
      return await res.json();
    } catch (e) {
      return fallback;
    }
  }

  async function writeBlob(name, body) {
    var token = blobToken();
    var api = blobApi();
    await api.put(blobPath(name), JSON.stringify(body), {
      access: "private",
      token: token,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true
    });
  }

  async function readJson(name, fallback) {
    if (usesBlob()) return readBlob(name, fallback);
    return readLocal(name, fallback);
  }

  async function writeJson(name, body) {
    try {
      if (usesBlob()) {
        await writeBlob(name, body);
        try { writeLocal(name, body); } catch (e) { /* mirror optional */ }
      } else {
        writeLocal(name, body);
      }
      lastWrite = { at: new Date().toISOString(), name: name, error: null };
    } catch (e) {
      lastWrite = { at: new Date().toISOString(), name: name, error: String(e.message || e) };
      throw e;
    }
  }

  return {
    KEYS: KEYS,
    loadEnvLocal: loadEnvLocal,
    blobToken: blobToken,
    usesBlob: usesBlob,
    readJson: readJson,
    writeJson: writeJson,
    lastWrite: function () { return lastWrite; },
    readLocal: readLocal,
    writeLocal: writeLocal
  };
});
