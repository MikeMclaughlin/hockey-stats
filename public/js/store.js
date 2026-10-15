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
  var WRITE_PROBE = "health-write-test.json";

  var KEYS = {
    estimates: "estimates.json",
    backtest: "backtest-20252026.json",
    mpGames: "mp-games-2025.json",
    matchups: "matchups.json",
    playerGames: "player-games.json",
    matchupArchive: "matchup-archive-20262027.json",
    cronStatus: "cron-status.json",
    statsSeason: "stats-season.json",
    odds: "odds.json",
    scorers: "scorers-20262027.json",
    liveBacktest: "backtest-20262027.json",
    periodGoals: "period-goals.json"
  };

  var lastWrite = { at: null, name: null, error: null };

  var BLOB_SETUP_HINT =
    "Connect a private Vercel Blob store to the hockey-stats project (it sets BLOB_STORE_ID; @vercel/blob authenticates with the deployment OIDC token) or set BLOB_READ_WRITE_TOKEN. Either one enables Blob. The function filesystem is read-only until then.";

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

  function blobStoreId() {
    return String(process.env.BLOB_STORE_ID || "").trim();
  }

  // token when BLOB_READ_WRITE_TOKEN is set (passed explicitly so it wins).
  // oidc when only BLOB_STORE_ID is set. none uses the local file fallback.
  function blobAuthMode() {
    if (blobToken()) return "token";
    if (blobStoreId()) return "oidc";
    return "none";
  }

  function usesBlob() {
    return blobAuthMode() !== "none";
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
    return BLOB_SETUP_HINT;
  }

  // @vercel/blob 2.8 resolveBlobAuth: an explicit token always wins.
  // OIDC: pass storeId and omit token and oidcToken so the SDK reads and
  // refreshes VERCEL_OIDC_TOKEN itself. A manually passed oidcToken is not refreshed.
  function blobAuthOptions() {
    var mode = blobAuthMode();
    if (mode === "token") return { token: blobToken() };
    if (mode === "oidc") return { storeId: blobStoreId() };
    return {};
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
    var file = localPath(name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(body, null, 2));
  }

  function blobApi() {
    return require("@vercel/blob");
  }

  function streamToText(stream) {
    if (!stream) return Promise.resolve("");
    if (typeof Response === "function") return new Response(stream).text();
    return new Promise(function (resolve, reject) {
      var chunks = [];
      stream.on("data", function (c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
      stream.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
      stream.on("error", reject);
    });
  }

  async function readBlobBody(name) {
    var api = blobApi();
    var pathname = blobPath(name);
    var got = await api.get(pathname, Object.assign({ access: "private", useCache: false }, blobAuthOptions()));
    if (!got || got.statusCode === 404 || !got.stream) return null;
    var text = await streamToText(got.stream);
    if (!text) return null;
    return JSON.parse(text);
  }

  async function writeBlob(name, body) {
    var api = blobApi();
    return api.put(blobPath(name), JSON.stringify(body), Object.assign({
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true
    }, blobAuthOptions()));
  }

  function bundledRead(name, fallback, reason) {
    var mirrored = readLocal(name, undefined);
    if (mirrored !== undefined) return { value: mirrored, source: "fallback", reason: reason };
    return { value: fallback, source: "fallback", reason: reason };
  }

  // source "blob" or "local" is safe to write back. "fallback" means Blob
  // 404'd or threw and the value is the bundled repo file (or the caller's
  // fallback). Callers must not write that copy back to Blob.
  async function readJsonResult(name, fallback) {
    if (!usesBlob()) return { value: readLocal(name, fallback), source: "local" };
    try {
      var fromBlob = await readBlobBody(name);
      if (fromBlob != null) return { value: fromBlob, source: "blob" };
    } catch (e) {
      return bundledRead(name, fallback, "error");
    }
    return bundledRead(name, fallback, "missing");
  }

  async function readJson(name, fallback) {
    var result = await readJsonResult(name, fallback);
    return result.value;
  }

  function readonlyError() {
    var err = new Error("EROFS: read-only file system. " + BLOB_SETUP_HINT);
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

  async function writeTest() {
    var mode = blobAuthMode();
    if (mode === "none") {
      return { ok: false, skipped: true, error: null, at: null, mode: "none" };
    }
    var at = new Date().toISOString();
    var probe = { probe: true, at: at, mode: mode };
    try {
      var putResult = await writeBlob(WRITE_PROBE, probe);
      var headTarget = (putResult && putResult.url) || blobPath(WRITE_PROBE);
      var api = blobApi();
      var meta = await api.head(headTarget, blobAuthOptions());
      var got = await readBlobBody(WRITE_PROBE);
      var headOk = !!(meta && (meta.pathname === blobPath(WRITE_PROBE) || meta.url));
      var readOk = !!(got && got.probe === true && got.at === at);
      var ok = headOk && readOk;
      return {
        ok: ok,
        skipped: false,
        error: ok ? null : "write probe read-back mismatch",
        at: at,
        mode: mode,
        pathname: (putResult && putResult.pathname) || blobPath(WRITE_PROBE)
      };
    } catch (e) {
      return {
        ok: false,
        skipped: false,
        error: String(e.message || e),
        at: at,
        mode: mode,
        pathname: blobPath(WRITE_PROBE)
      };
    }
  }

  return {
    KEYS: KEYS,
    BLOB_SETUP_HINT: BLOB_SETUP_HINT,
    loadEnvLocal: loadEnvLocal,
    blobToken: blobToken,
    blobStoreId: blobStoreId,
    blobAuthMode: blobAuthMode,
    blobAuthOptions: blobAuthOptions,
    usesBlob: usesBlob,
    onVercel: onVercel,
    storageMode: storageMode,
    blobHint: blobHint,
    readJson: readJson,
    readJsonResult: readJsonResult,
    writeJson: writeJson,
    writeTest: writeTest,
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
        var listed = await api.list(Object.assign({ prefix: PREFIX, limit: 50 }, blobAuthOptions()));
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
