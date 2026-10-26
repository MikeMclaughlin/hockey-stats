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
  var DEFAULT_CONTAINER = "hockey-stats";

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
    periodGoals: "period-goals.json",
    teamTrends: "team-trends.json",
    cardSnapshots: "card-snapshots.json"
  };

  var lastWrite = { at: null, name: null, error: null };
  var containerPromise = null;
  var containerKey = "";

  var BLOB_SETUP_HINT =
    "Set AZURE_STORAGE_CONNECTION_STRING for a private Azure Blob Storage container (AZURE_STORAGE_CONTAINER, default hockey-stats, no public access). That enables blob storage. The function filesystem is read-only until then.";

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

  function azureConnectionString() {
    return String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim();
  }

  function azureContainerName() {
    return String(process.env.AZURE_STORAGE_CONTAINER || "").trim() || DEFAULT_CONTAINER;
  }

  // connection-string when AZURE_STORAGE_CONNECTION_STRING is set.
  // none uses the local file fallback.
  function blobAuthMode() {
    if (azureConnectionString()) return "connection-string";
    return "none";
  }

  function usesBlob() {
    return blobAuthMode() !== "none";
  }

  function onVercel() {
    return !!(process.env.VERCEL || process.env.NOW_REGION);
  }

  function storageMode() {
    if (usesBlob()) return "azure";
    if (onVercel()) return "readonly";
    return "local";
  }

  function blobHint() {
    if (usesBlob() || !onVercel()) return null;
    return BLOB_SETUP_HINT;
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

  function azureError(message, cause) {
    var detail = cause ? String(cause.message || cause) : "";
    var err = new Error(detail ? message + " " + detail : message);
    if (cause && cause.code) err.code = cause.code;
    else if (cause && cause.statusCode) err.code = cause.statusCode;
    return err;
  }

  function openContainer() {
    var connection = azureConnectionString();
    if (!connection) {
      return Promise.reject(azureError("AZURE_STORAGE_CONNECTION_STRING is not set."));
    }
    var BlobServiceClient;
    try {
      BlobServiceClient = require("@azure/storage-blob").BlobServiceClient;
    } catch (e) {
      return Promise.reject(azureError("Could not load @azure/storage-blob.", e));
    }
    var service;
    try {
      service = BlobServiceClient.fromConnectionString(connection);
    } catch (e) {
      return Promise.reject(azureError("AZURE_STORAGE_CONNECTION_STRING could not be used.", e));
    }
    var name = azureContainerName();
    var container = service.getContainerClient(name);
    return container.createIfNotExists().then(function () {
      return container.getProperties();
    }).then(function (props) {
      if (props && props.blobPublicAccess) {
        throw azureError(
          "Azure container \"" + name + "\" has public access (" + props.blobPublicAccess + "). Create it as a private container with no public access."
        );
      }
      return container;
    }).catch(function (e) {
      if (e && e.message && e.message.indexOf("public access") !== -1) throw e;
      throw azureError(
        "Azure container \"" + name + "\" could not be created or opened. Create a private container, or use a connection string that can create one.",
        e
      );
    });
  }

  function containerClient() {
    var key = azureConnectionString() + "\n" + azureContainerName();
    if (!containerPromise || containerKey !== key) {
      containerKey = key;
      containerPromise = openContainer().catch(function (err) {
        containerPromise = null;
        containerKey = "";
        throw err;
      });
    }
    return containerPromise;
  }

  function streamToText(stream) {
    if (!stream) return Promise.resolve("");
    if (typeof stream.getReader === "function") {
      var reader = stream.getReader();
      var chunks = [];
      var pump = function () {
        return reader.read().then(function (step) {
          if (step.done) return Buffer.concat(chunks).toString("utf8");
          chunks.push(Buffer.from(step.value));
          return pump();
        });
      };
      return pump();
    }
    if (typeof Response === "function" && typeof stream.getReader !== "function" && typeof stream.on !== "function") {
      return new Response(stream).text();
    }
    return new Promise(function (resolve, reject) {
      var chunks = [];
      stream.on("data", function (c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
      stream.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
      stream.on("error", reject);
    });
  }

  function isMissingBlob(err) {
    if (!err) return false;
    var status = err.statusCode || err.status;
    return status === 404 || err.code === "BlobNotFound";
  }

  async function readBlobBody(name) {
    var container = await containerClient();
    var blob = container.getBlobClient(blobPath(name));
    try {
      var download = await blob.download(0);
      var text = await streamToText(download.readableStreamBody || download.blobBody);
      if (!text) return null;
      return JSON.parse(text);
    } catch (e) {
      if (isMissingBlob(e)) return null;
      throw e;
    }
  }

  async function writeBlob(name, body) {
    var container = await containerClient();
    var pathname = blobPath(name);
    var payload = Buffer.from(JSON.stringify(body), "utf8");
    var block = container.getBlockBlobClient(pathname);
    var uploaded = await block.uploadData(payload, {
      blobHTTPHeaders: { blobContentType: "application/json" }
    });
    return {
      pathname: pathname,
      url: block.url,
      etag: uploaded && uploaded.etag
    };
  }

  async function headBlob(name) {
    var container = await containerClient();
    var pathname = blobPath(name);
    var blob = container.getBlobClient(pathname);
    var meta = await blob.getProperties();
    return {
      pathname: pathname,
      url: blob.url,
      etag: meta && meta.etag,
      lastModified: meta && meta.lastModified,
      contentLength: meta && meta.contentLength,
      contentType: meta && meta.contentType
    };
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
      var meta = await headBlob(WRITE_PROBE);
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
    blobAuthMode: blobAuthMode,
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
        var container = await containerClient();
        var out = [];
        for await (var item of container.listBlobsFlat({ prefix: PREFIX })) {
          var modified = item.properties && item.properties.lastModified;
          out.push({
            name: item.name,
            uploadedAt: modified ? new Date(modified).toISOString() : null,
            source: "blob"
          });
          if (out.length >= 50) break;
        }
        return out;
      } catch (e) {
        return [{ name: "error", error: String(e.message || e), source: "blob" }];
      }
    },
    readLocal: readLocal,
    writeLocal: writeLocal
  };
});
