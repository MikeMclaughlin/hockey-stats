"use strict";

var crypto = require("crypto");

var SESSION = "hs_session";
var STATE = "hs_state";
var SESSION_MS = 14 * 24 * 60 * 60 * 1000;
var STATE_MS = 10 * 60 * 1000;

function secret() {
  return String(process.env.AUTH_SECRET || "");
}

function enabled() {
  return !!(String(process.env.GOOGLE_CLIENT_ID || "").trim() &&
    String(process.env.GOOGLE_CLIENT_SECRET || "").trim() &&
    secret().trim());
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(text) {
  var s = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  if (s.length % 4) s += "====".slice(s.length % 4);
  return Buffer.from(s, "base64");
}

function sign(text) {
  var mac = crypto.createHmac("sha256", secret()).update(text).digest();
  return b64url(Buffer.from(text, "utf8")) + "." + b64url(mac);
}

function unsign(token) {
  if (!secret().trim()) return null;
  var parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  var body;
  var got;
  try {
    body = b64urlDecode(parts[0]).toString("utf8");
    got = b64urlDecode(parts[1]);
  } catch (e) {
    return null;
  }
  var expected = crypto.createHmac("sha256", secret()).update(body).digest();
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;
  return body;
}

function readCookieHeader(req) {
  var out = {};
  var raw = req && req.headers ? String(req.headers.cookie || "") : "";
  raw.split(";").forEach(function (part) {
    var i = part.indexOf("=");
    if (i < 1) return;
    var key = part.slice(0, i).trim();
    var value = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(value); }
    catch (e) { out[key] = value; }
  });
  return out;
}

function cookie(name, value, maxAge) {
  var bits = [
    name + "=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ];
  if (maxAge === 0) bits.push("Max-Age=0");
  else if (maxAge != null) bits.push("Max-Age=" + String(maxAge));
  return bits.join("; ");
}

function readSession(req) {
  var raw = unsign(readCookieHeader(req)[SESSION] || "");
  if (!raw) return null;
  var data;
  try { data = JSON.parse(raw); }
  catch (e) { return null; }
  if (!data || !data.email || !data.exp || Date.now() > Number(data.exp)) return null;
  if (data.verified !== true) return null;
  return {
    email: String(data.email).trim().toLowerCase(),
    name: String(data.name || "Signed in").slice(0, 80),
    verified: true
  };
}

function sessionCookie(session) {
  var body = JSON.stringify({
    email: session.email,
    name: session.name,
    verified: true,
    exp: Date.now() + SESSION_MS
  });
  return cookie(SESSION, sign(body), Math.floor(SESSION_MS / 1000));
}

function clearCookies() {
  return [cookie(SESSION, "", 0), cookie(STATE, "", 0)];
}

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(/[,;\s]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function isAdmin(session) {
  if (!session || session.verified !== true || !session.email) return false;
  return adminEmails().indexOf(session.email) !== -1;
}

function origin(req) {
  var headers = (req && req.headers) || {};
  var host = String(headers["x-forwarded-host"] || headers.host || "").split(",")[0].trim();
  var proto = String(headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (proto !== "http" && proto !== "https") proto = "https";
  if (!host) {
    host = "hockey-stats-nine.vercel.app";
    proto = "https";
  }
  return proto + "://" + host;
}

function redirectUri(req) {
  return origin(req) + "/api/auth/callback/google";
}

function safeNext(value) {
  var s = String(value || "/");
  if (s.charAt(0) !== "/" || s.slice(0, 2) === "//" || s.indexOf("\\") !== -1) return "/";
  if (s.indexOf("/api/") === 0) return "/";
  return s.slice(0, 200);
}

function issueState(nextPath) {
  var payload = {
    n: safeNext(nextPath),
    s: crypto.randomBytes(24).toString("hex"),
    exp: Date.now() + STATE_MS
  };
  return {
    nonce: payload.s,
    next: payload.n,
    cookie: cookie(STATE, sign(JSON.stringify(payload)), Math.floor(STATE_MS / 1000))
  };
}

function readState(req) {
  var raw = unsign(readCookieHeader(req)[STATE] || "");
  if (!raw) return null;
  var data;
  try { data = JSON.parse(raw); }
  catch (e) { return null; }
  if (!data || !data.s || !data.exp || Date.now() > Number(data.exp)) return null;
  return data;
}

function loginLocation(req, nonce) {
  var params = new URLSearchParams();
  params.set("client_id", String(process.env.GOOGLE_CLIENT_ID).trim());
  params.set("redirect_uri", redirectUri(req));
  params.set("response_type", "code");
  params.set("scope", "openid email profile");
  params.set("state", nonce);
  params.set("prompt", "select_account");
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

function emailHash(email) {
  return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}

module.exports = {
  enabled: enabled,
  readSession: readSession,
  sessionCookie: sessionCookie,
  clearCookies: clearCookies,
  isAdmin: isAdmin,
  origin: origin,
  redirectUri: redirectUri,
  safeNext: safeNext,
  issueState: issueState,
  readState: readState,
  loginLocation: loginLocation,
  emailHash: emailHash
};
