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
    playerGames: "player-games.json",
    matchupArchive: "matchup-archive-20262027.json"
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

  function onVercel() {
    return !!(process.env.VERCEL || process.env.NOW_REGION);
  }

  function storageMode() {
    if (usesBlob()) return "blob";
    if (onVercel()) return "readonly";
    return "local";
  }

  function blobHint() {
    if (usesBlob() || !onVercel()) return null;
    return "Add BLOB_READ_WRITE_TOKEN to the Vercel project hockey-stats (Storage → Blob). The function filesystem is read-only, so estimates cannot be saved until that token is set.";
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

  async function readBlobBody(name) {
    var token = blobToken();
    var api = blobApi();
    var pathname = blobPath(name);
    if (typeof api.get === "function") {
      try {
        var got = await api.get(pathname, { token: token, access: "private" });
        if (got && got.stream && got.statusCode !== 404 && typeof Response === "function") {
          var text = await new Response(got.stream).text();
          if (text) return JSON.parse(text);
        }
      } catch (e) { /* list fallback */ }
    }
    var listed = await api.list({ prefix: pathname, token: token, limit: 20 });
    var blobs = (listed && listed.blobs) || [];
    var hit = null;
    for (var i = 0; i < blobs.length; i++) {
      if (blobs[i].pathname === pathname) { hit = blobs[i]; break; }
    }
    if (!hit && blobs.length === 1) hit = blobs[0];
    if (!hit) return null;
    var res = await fetch(hit.url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) return null;
    return await res.json();
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
    if (usesBlob()) {
      try {
        var fromBlob = await readBlobBody(name);
        if (fromBlob != null) return fromBlob;
      } catch (e) { /* fall through to the bundled file */ }
      var mirrored = readLocal(name, undefined);
      if (mirrored !== undefined) return mirrored;
      return fallback;
    }
    return readLocal(name, fallback);
  }

  function readonlyError() {
    var err = new Error(
      "EROFS: read-only file system, open 'data/" + "estimates.json'. " +
      "Set BLOB_READ_WRITE_TOKEN on the Vercel project hockey-stats so estimates persist in Vercel Blob."
    );
    err.code = "BLOB_REQUIRED";
    return err;
  }

  async function writeJson(name, body) {
    try {
      if (usesBlob()) {
        await writeBlob(name, body);
        try { writeLocal(name, body); } catch (e) { /* mirror optional on Vercel */ }
      } else if (onVercel()) {
        throw readonlyError();
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
    onVercel: onVercel,
    storageMode: storageMode,
    blobHint: blobHint,
    readJson: readJson,
    writeJson: writeJson,
    lastWrite: function () { return lastWrite; },
    listStored: async function () {
      if (!usesBlob()) {
        try {
          return fs.readdirSync(DATA).filter(function (n) { return /\.json$/i.test(n); }).map(function (n) {
            var st = fs.statSync(path.join(DATA, n));
            return { name: n, uploadedAt: st.mtime.toISOString(), source: "local" };
          });
        } catch (e) { return []; }
      }
      try {
        var api = blobApi();
        var listed = await api.list({ prefix: PREFIX, token: blobToken(), limit: 50 });
        return ((listed && listed.blobs) || []).map(function (b) {
          return { name: b.pathname, uploadedAt: b.uploadedAt || null, source: "blob" };
        });
      } catch (e) {
        return [{ name: "error", error: String(e.message || e), source: "blob" }];
      }
    },
    readLocal: readLocal,
    writeLocal: writeLocal
  };
});
