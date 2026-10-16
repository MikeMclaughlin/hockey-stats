#!/usr/bin/env node
"use strict";

// One-time copy from a Vercel Blob store to a private Azure Blob container.
// Read-only on the Vercel side: list + get only. Never delete or overwrite there.
//
//   node scripts/migrate-vercel-blob-to-azure.js [--dry-run] [--overwrite]
//
// Source: BLOB_READ_WRITE_TOKEN (wins) or BLOB_STORE_ID (OIDC).
// Target: AZURE_STORAGE_CONNECTION_STRING and optional AZURE_STORAGE_CONTAINER
// (default hockey-stats).

var dryRun = false;
var overwrite = false;

function failUsage(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/migrate-vercel-blob-to-azure.js [--dry-run] [--overwrite]");
  process.exit(1);
}

process.argv.slice(2).forEach(function (arg) {
  if (arg === "--dry-run") dryRun = true;
  else if (arg === "--overwrite") overwrite = true;
  else failUsage("Unknown argument: " + arg);
});

function sourceAuth() {
  var token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  var storeId = String(process.env.BLOB_STORE_ID || "").trim();
  if (token) return { token: token };
  if (storeId) return { storeId: storeId };
  return null;
}

function containerName() {
  return String(process.env.AZURE_STORAGE_CONTAINER || "").trim() || "hockey-stats";
}

function streamToBuffer(stream) {
  if (!stream) return Promise.reject(new Error("download returned no stream"));
  if (typeof stream.getReader === "function") {
    var reader = stream.getReader();
    var chunks = [];
    var pump = function () {
      return reader.read().then(function (step) {
        if (step.done) return Buffer.concat(chunks);
        chunks.push(Buffer.from(step.value));
        return pump();
      });
    };
    return pump();
  }
  return new Promise(function (resolve, reject) {
    var chunks = [];
    stream.on("data", function (c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
    stream.on("end", function () { resolve(Buffer.concat(chunks)); });
    stream.on("error", reject);
  });
}

async function listSource(blobApi, auth) {
  var byPath = new Map();
  var failures = [];
  var deduped = 0;
  var cursor;
  var seenCursors = Object.create(null);
  var pages = 0;

  while (true) {
    if (cursor) {
      if (seenCursors[cursor]) {
        failures.push({ pathname: "", error: "pagination cursor repeated; stopped so blobs are not skipped" });
        break;
      }
      seenCursors[cursor] = true;
    }
    var page;
    try {
      page = await blobApi.list(Object.assign({ limit: 1000, cursor: cursor, mode: "expanded" }, auth));
    } catch (e) {
      failures.push({ pathname: "", error: "list failed: " + String(e.message || e) });
      break;
    }
    pages += 1;
    if (!page || !Array.isArray(page.blobs)) {
      failures.push({ pathname: "", error: "list page did not include a blobs array" });
      break;
    }
    var blobs = page.blobs;
    for (var i = 0; i < blobs.length; i++) {
      var item = blobs[i] || {};
      var key = item.pathname;
      if (!key) {
        failures.push({
          pathname: "",
          error: "listed blob has no pathname" + (item.url ? " url=" + item.url : "")
        });
        continue;
      }
      var size = Number(item.size);
      if (!isFinite(size) || size < 0) {
        failures.push({ pathname: key, error: "listed blob has no numeric size" });
        continue;
      }
      if (byPath.has(key)) {
        var prev = byPath.get(key);
        deduped += 1;
        if (prev.size !== size || prev.etag !== item.etag || prev.url !== item.url) {
          failures.push({
            pathname: key,
            error: "duplicate pathname disagrees (size " + prev.size + " vs " + size + ")"
          });
          console.log("dedupe " + key + " bytes=" + size + " conflict");
        } else {
          console.log("dedupe " + key + " bytes=" + size + " identical");
        }
        continue;
      }
      byPath.set(key, {
        pathname: key,
        size: size,
        url: item.url || "",
        etag: item.etag || ""
      });
    }
    if (!page || !page.hasMore) break;
    if (!page.cursor) {
      failures.push({ pathname: "", error: "list reported hasMore without a cursor" });
      break;
    }
    cursor = page.cursor;
  }

  return { byPath: byPath, failures: failures, deduped: deduped, pages: pages };
}

async function openContainer() {
  var connection = String(process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim();
  if (!connection) {
    throw new Error("Set AZURE_STORAGE_CONNECTION_STRING to write the Azure container.");
  }
  var BlobServiceClient;
  try {
    BlobServiceClient = require("@azure/storage-blob").BlobServiceClient;
  } catch (e) {
    throw new Error("Could not load @azure/storage-blob. " + String(e.message || e));
  }
  var service;
  try {
    service = BlobServiceClient.fromConnectionString(connection);
  } catch (e) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING could not be used. " + String(e.message || e));
  }
  var name = containerName();
  var container = service.getContainerClient(name);
  try {
    await container.createIfNotExists();
  } catch (e) {
    throw new Error(
      "Azure container \"" + name + "\" could not be created or opened. Create a private container, or use a connection string that can create one. " +
      String(e.message || e)
    );
  }
  var props;
  try {
    props = await container.getProperties();
  } catch (e) {
    throw new Error("Azure container \"" + name + "\" properties could not be read. " + String(e.message || e));
  }
  if (props && props.blobPublicAccess) {
    throw new Error(
      "Azure container \"" + name + "\" has public access (" + props.blobPublicAccess + "). Refusing to write to a public container."
    );
  }
  return container;
}

async function targetSize(container, pathname) {
  var blob = container.getBlobClient(pathname);
  try {
    var meta = await blob.getProperties();
    return { exists: true, size: Number(meta.contentLength) };
  } catch (e) {
    var status = e && (e.statusCode || e.status);
    if (status === 404 || (e && e.code === "BlobNotFound")) return { exists: false, size: null };
    throw e;
  }
}

async function listTarget(container) {
  var byName = new Map();
  var deduped = 0;
  for await (var item of container.listBlobsFlat()) {
    var size = item.properties ? Number(item.properties.contentLength) : NaN;
    if (byName.has(item.name)) {
      deduped += 1;
      console.log("dedupe target " + item.name + " bytes=" + size);
      continue;
    }
    byName.set(item.name, { name: item.name, size: size });
  }
  return { byName: byName, deduped: deduped };
}

async function downloadSource(blobApi, auth, pathname) {
  var got = await blobApi.get(pathname, Object.assign({ access: "private", useCache: false }, auth));
  if (!got || got.statusCode !== 200 || !got.stream) {
    throw new Error("private download failed" + (got && got.statusCode ? " status=" + got.statusCode : " (not found)"));
  }
  var contentType = got.blob && got.blob.contentType;
  if (!contentType) throw new Error("source content type is missing");
  var body = await streamToBuffer(got.stream);
  return { body: body, contentType: contentType };
}

async function main() {
  var auth = sourceAuth();
  if (!auth) {
    throw new Error("Set BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID to read the Vercel Blob store.");
  }
  var blobApi;
  try {
    blobApi = require("@vercel/blob");
  } catch (e) {
    throw new Error("Could not load @vercel/blob (devDependency). Run npm install. " + String(e.message || e));
  }
  if (typeof blobApi.list !== "function" || typeof blobApi.get !== "function") {
    throw new Error("@vercel/blob did not provide list and get.");
  }

  var listed = await listSource(blobApi, auth);
  var names = Array.from(listed.byPath.keys()).sort();
  var totalBytes = 0;
  names.forEach(function (name) { totalBytes += listed.byPath.get(name).size; });

  if (dryRun) {
    names.forEach(function (name) {
      var item = listed.byPath.get(name);
      console.log("list " + name + " bytes=" + item.size);
    });
    listed.failures.forEach(function (failure) {
      console.log("fail " + (failure.pathname || "(no pathname)") + " " + failure.error);
    });
    console.log(
      "summary source=" + names.length +
      " listed-pages=" + listed.pages +
      " failed=" + listed.failures.length +
      " deduped=" + listed.deduped +
      " bytes=" + totalBytes +
      " dry-run=true"
    );
    if (listed.failures.length) process.exitCode = 1;
    return;
  }

  var container = await openContainer();
  var copied = 0;
  var skipped = 0;
  var failed = listed.failures.slice();
  var copiedBytes = 0;

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var item = listed.byPath.get(name);
    try {
      var current = await targetSize(container, name);
      if (current.exists && current.size === item.size && !overwrite) {
        skipped += 1;
        console.log("skip " + name + " bytes=" + item.size + " matching-size");
        continue;
      }
      if (current.exists && current.size !== item.size && !overwrite) {
        failed.push({
          pathname: name,
          error: "size mismatch source=" + item.size + " target=" + current.size + " (pass --overwrite to replace)"
        });
        console.log("fail " + name + " bytes=" + item.size + " size mismatch source=" + item.size + " target=" + current.size);
        continue;
      }
      var downloaded = await downloadSource(blobApi, auth, name);
      if (downloaded.body.length !== item.size) {
        failed.push({
          pathname: name,
          error: "downloaded " + downloaded.body.length + " bytes, listed size " + item.size
        });
        console.log("fail " + name + " bytes=" + item.size + " downloaded=" + downloaded.body.length);
        continue;
      }
      var block = container.getBlockBlobClient(name);
      await block.uploadData(downloaded.body, {
        blobHTTPHeaders: { blobContentType: downloaded.contentType }
      });
      var written = await targetSize(container, name);
      if (!written.exists || written.size !== item.size) {
        failed.push({
          pathname: name,
          error: "upload size check failed target=" + (written.exists ? written.size : "missing")
        });
        console.log("fail " + name + " bytes=" + item.size + " upload size check failed");
        continue;
      }
      copied += 1;
      copiedBytes += downloaded.body.length;
      var action = current.exists ? "overwrite" : "copy";
      console.log(action + " " + name + " bytes=" + item.size + " content-type=" + downloaded.contentType);
    } catch (e) {
      failed.push({ pathname: name, error: String(e.message || e) });
      console.log("fail " + name + " bytes=" + item.size + " " + String(e.message || e));
    }
  }

  var target = await listTarget(container);
  var missing = [];
  var sizeMismatch = [];
  names.forEach(function (name) {
    var source = listed.byPath.get(name);
    var found = target.byName.get(name);
    if (!found) missing.push(name);
    else if (found.size !== source.size) sizeMismatch.push(name + " source=" + source.size + " target=" + found.size);
  });
  var extras = [];
  target.byName.forEach(function (item) {
    if (!listed.byPath.has(item.name)) extras.push(item.name);
  });

  var countsMatch = target.byName.size === names.length && !missing.length && !sizeMismatch.length && !extras.length;
  console.log(
    "summary source=" + names.length +
    " target=" + target.byName.size +
    " copied=" + copied +
    " skipped=" + skipped +
    " failed=" + failed.length +
    " deduped=" + listed.deduped +
    " bytes=" + totalBytes +
    " copied-bytes=" + copiedBytes +
    " container=" + containerName()
  );
  missing.forEach(function (name) { console.log("missing target " + name); });
  sizeMismatch.forEach(function (line) { console.log("size mismatch " + line); });
  extras.forEach(function (name) { console.log("extra target " + name); });
  if (!countsMatch) console.log("count mismatch source=" + names.length + " target=" + target.byName.size);

  if (failed.length || !countsMatch) process.exitCode = 1;
}

main().catch(function (err) {
  console.error(String(err && err.stack || err));
  process.exit(1);
});
