"use strict";

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var { URL } = require("url");
var stats = require("./public/js/stats.js");
var archive = require("./public/js/archive.js");
var backtest = require("./public/js/backtest.js");
var store = require("./public/js/store.js");

var ROOT = __dirname;
var PORT = Number(process.env.PORT || 3080);
var CACHE_MS = 5 * 60 * 1000;
var cache = { at: 0, body: null };
var ESTIMATES_FILE = path.join(ROOT, "data", "estimates.json");
var BACKTEST_FILE = path.join(ROOT, "data", "backtest-20252026.json");
var MP_GAMES_FILE = path.join(ROOT, "data", "mp-games-2025.json");

var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function send(res, status, body, type) {
  var buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Content-Length": buf.length,
    "Cache-Control": "no-store"
  });
  res.end(buf);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), TYPES[".json"]);
}

function safeFile(urlPath) {
  var rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  var pub = path.normalize(path.join(ROOT, "public"));
  var file = path.normalize(path.join(pub, rel));
  if (file !== pub && !file.startsWith(pub + path.sep)) return null;
  return file;
}

function serveFile(res, file) {
  fs.readFile(file, function (err, buf) {
    if (err) {
      send(res, err.code === "ENOENT" ? 404 : 500, err.code === "ENOENT" ? "Not found" : "Read error");
      return;
    }
    send(res, 200, buf, TYPES[path.extname(file)] || "application/octet-stream");
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function httpsGet(urlStr, cb, attempt) {
  attempt = attempt || 1;
  https.get(urlStr, { headers: { "User-Agent": "hockey-stats/1.1", Accept: "*/*" } }, function (up) {
    if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
      up.resume();
      httpsGet(up.headers.location, cb, attempt);
      return;
    }
    var chunks = [];
    up.on("data", function (c) { chunks.push(c); });
    up.on("end", function () {
      var buf = Buffer.concat(chunks);
      if (up.statusCode === 429 && attempt < 5) {
        var wait = Number(up.headers["retry-after"]);
        if (!isFinite(wait) || wait < 1) wait = Math.min(60, 3 * attempt);
        setTimeout(function () { httpsGet(urlStr, cb, attempt + 1); }, wait * 1000);
        return;
      }
      if (up.statusCode !== 200) {
        cb(new Error("HTTP " + up.statusCode + " " + urlStr));
        return;
      }
      cb(null, buf.toString("utf8"));
    });
  }).on("error", cb);
}

function getJson(urlStr) {
  return new Promise(function (resolve, reject) {
    httpsGet(urlStr, function (err, text) {
      if (err) return reject(err);
      try { resolve(JSON.parse(text)); }
      catch (e) { reject(e); }
    });
  });
}

function getText(urlStr) {
  return new Promise(function (resolve, reject) {
    httpsGet(urlStr, function (err, text) {
      if (err) return reject(err);
      resolve(text);
    });
  });
}

function indexStandings(payload) {
  var map = Object.create(null);
  (payload.standings || []).forEach(function (row) {
    var ab = row.teamAbbrev && row.teamAbbrev.default;
    if (ab) map[ab] = row;
  });
  return map;
}

function indexSummary(payload) {
  var map = Object.create(null);
  (payload.data || []).forEach(function (row) {
    var t = stats.teamById(row.teamId);
    if (t) map[t.abbrev] = row;
  });
  return map;
}

function last5FromSchedule(payload, abbrev) {
  return stats.last5GoalDiff(payload.games || [], abbrev);
}

function seasonIdFromScore(score) {
  var games = score.games || [];
  if (games.length && games[0].season) return Number(games[0].season);
  return 20252026;
}

function statsSeasonFor(seasonId, score) {
  /* If opening night / no games played this season, use prior season advanced stats. */
  var games = score.games || [];
  var anyLive = games.some(function (g) {
    return g.gameState && g.gameState !== "FUT" && g.gameState !== "PRE";
  });
  if (seasonId >= 20262027 && !anyLive) return 20252026;
  return seasonId;
}

function mpSeasonYear(seasonId) {
  return String(Math.floor(Number(seasonId) / 10000));
}

async function buildMatchups() {
  var score = await getJson("https://api-web.nhle.com/v1/score/now");
  var standings = await getJson("https://api-web.nhle.com/v1/standings/now");
  var oddsById = Object.create(null);
  var oddsPartner = null;
  try {
    var partner = await getJson("https://api-web.nhle.com/v1/partner-game/US/now");
    oddsPartner = partner.bettingPartner && partner.bettingPartner.name;
    (partner.games || []).forEach(function (og) {
      oddsById[og.gameId] = stats.parsePartnerOdds(og);
      oddsById[og.gameId].partner = oddsPartner;
    });
  } catch (e) {
    oddsById = Object.create(null);
  }
  var seasonId = seasonIdFromScore(score);
  var statsSeason = statsSeasonFor(seasonId, score);
  var summaryUrl =
    "https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId=" +
    statsSeason + "%20and%20gameTypeId=2";
  var summary = await getJson(summaryUrl);

  var mp = {};
  try {
    var csv = await getText(
      "https://moneypuck.com/moneypuck/playerData/seasonSummary/" +
        mpSeasonYear(statsSeason) +
        "/regular/teams.csv"
    );
    mp = stats.parseMoneyPuckCsv(csv);
  } catch (e) {
    mp = {};
  }

  var standMap = indexStandings(standings);
  var sumMap = indexSummary(summary);

  var games = score.games || [];
  var needed = {};
  games.forEach(function (g) {
    if (g.awayTeam && g.awayTeam.abbrev) needed[g.awayTeam.abbrev] = true;
    if (g.homeTeam && g.homeTeam.abbrev) needed[g.homeTeam.abbrev] = true;
  });

  var mpGamesCache = await store.readJson(store.KEYS.mpGames, []);
  var last5Map = {};
  var formMap = {};
  var abbrevs = Object.keys(needed);
  await Promise.all(
    abbrevs.map(function (ab) {
      var url = "https://api-web.nhle.com/v1/club-schedule-season/" + ab + "/" + statsSeason;
      return getJson(url)
        .then(function (sched) {
          last5Map[ab] = last5FromSchedule(sched, ab);
          formMap[ab] = backtest.scheduleForm(sched.games || [], ab, score.currentDate);
        })
        .catch(function () {
          last5Map[ab] = null;
          formMap[ab] = { lastDate: null, dates: [], results: [] };
        });
    })
  );

  function profile(teamObj) {
    var ab = teamObj.abbrev;
    var meta = stats.teamByAbbrev(ab) || {};
    var p = stats.buildTeamProfile({
      abbrev: ab,
      name: meta.name || (teamObj.name && teamObj.name.default) || ab,
      logo: teamObj.logo,
      stand: standMap[ab] || {},
      summary: sumMap[ab] || {},
      moneypuck: mp[ab] || {},
      last5: last5Map[ab],
      last5SvPct: stats.last5SavePctFromMp(mpGamesCache, ab, score.currentDate)
    });
    p.score = teamObj.score;
    return p;
  }

  var matchups = games.map(function (g) {
    var away = profile(g.awayTeam || {});
    var home = profile(g.homeTeam || {});
    var edge = stats.matchupEdge(away, home);
    var winnerTeam = edge.winner === "away" ? away : edge.winner === "home" ? home : null;
    var projected = stats.estimateScore(away, home);
    var odds = oddsById[g.id] || null;
    return {
      id: g.id,
      gameDate: g.gameDate || score.currentDate,
      startTimeUTC: g.startTimeUTC,
      venue: g.venue && g.venue.default,
      gameState: g.gameState,
      away: away,
      home: home,
      edge: edge,
      edgeTeam: winnerTeam ? winnerTeam.abbrev : "EVEN",
      edgeName: winnerTeam ? winnerTeam.name : "Even matchup",
      why: stats.explainEdge(edge, away, home),
      projected: projected,
      odds: odds,
      notes: backtest.buildNotes(
        { gameDate: g.gameDate, awayAbbrev: away.abbrev, homeAbbrev: home.abbrev },
        formMap[away.abbrev] || { lastDate: null, dates: [], results: [] },
        formMap[home.abbrev] || { lastDate: null, dates: [], results: [] },
        projected,
        odds
      )
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    currentDate: score.currentDate,
    prevDate: score.prevDate,
    nextDate: score.nextDate,
    seasonId: seasonId,
    statsSeason: statsSeason,
    note:
      statsSeason !== seasonId
        ? "2026-27 has not started — stats are 2025-26 regular season."
        : null,
    matchupCount: matchups.length,
    matchups: matchups
  };
}

async function loadEstimates() {
  var data = await store.readJson(store.KEYS.estimates, null);
  return data && data.byId ? data : archive.emptyStore();
}

async function saveEstimates(est) {
  await store.writeJson(store.KEYS.estimates, est);
}

async function persistMatchups(body) {
  var storeEst = await loadEstimates();
  (body.matchups || []).forEach(function (m) {
    var proj = m.projected || {};
    archive.freezeEstimate(storeEst, {
      id: m.id,
      seasonId: body.seasonId,
      gameDate: m.gameDate,
      startTimeUTC: m.startTimeUTC,
      venue: m.venue,
      awayAbbrev: m.away && m.away.abbrev,
      homeAbbrev: m.home && m.home.abbrev,
      awayName: m.away && m.away.name,
      homeName: m.home && m.home.name,
      projectedAway: proj.away,
      projectedHome: proj.home,
      gameState: m.gameState
    });
    var row = storeEst.byId[String(m.id)];
    var as = m.away && m.away.score;
    var hs = m.home && m.home.score;
    if (row && archive.isFinalState(m.gameState) && as != null && hs != null) {
      archive.applyResult(row, as, hs, m.gameState);
    }
  });
  await saveEstimates(storeEst);
  return storeEst;
}

async function estimatesPayload(est) {
  est = est || await loadEstimates();
  var estimates = archive.listEstimates(est).sort(function (a, b) {
    return String(a.gameDate || "").localeCompare(String(b.gameDate || "")) ||
      String(a.startTimeUTC || "").localeCompare(String(b.startTimeUTC || ""));
  });
  return {
    generatedAt: new Date().toISOString(),
    estimates: estimates,
    summary: archive.summarize(estimates)
  };
}

async function gradeEstimates() {
  var est = await loadEstimates();
  var rows = archive.listEstimates(est).filter(function (r) { return !r.graded && r.gameDate; });
  var dates = {};
  rows.forEach(function (r) { dates[r.gameDate] = true; });
  var today = new Date().toISOString().slice(0, 10);
  var keys = Object.keys(dates).filter(function (d) { return d <= today; });
  for (var i = 0; i < keys.length; i++) {
    var payload = await getJson("https://api-web.nhle.com/v1/score/" + keys[i]);
    (payload.games || []).forEach(function (g) {
      var row = est.byId[String(g.id)];
      if (!row || !archive.isFinalState(g.gameState)) return;
      var as = g.awayTeam && g.awayTeam.score;
      var hs = g.homeTeam && g.homeTeam.score;
      if (as == null || hs == null) return;
      archive.applyResult(row, as, hs, g.gameState);
    });
  }
  await saveEstimates(est);
  return estimatesPayload(est);
}

async function loadMoneyPuckGames() {
  var cached = await store.readJson(store.KEYS.mpGames, null);
  if (Array.isArray(cached) && cached.length) return cached;
  var teams = stats.TEAMS.map(function (t) { return t.abbrev; });
  var all = [];
  for (var i = 0; i < teams.length; i++) {
    try {
      var csv = await getText(
        "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/regular/teams/" +
          teams[i] + ".csv"
      );
      all = all.concat(backtest.parseTeamGameCsv(csv, "2025"));
    } catch (e) {
      if (String(e.message || e).indexOf("429") !== -1) break;
    }
    await sleep(800);
  }
  if (all.length) {
    try { await store.writeJson(store.KEYS.mpGames, all); } catch (e) { /* ignore */ }
  }
  return all;
}

async function runBacktest() {
  var teams = stats.TEAMS.map(function (t) { return t.abbrev; });
  var schedules = [];
  for (var i = 0; i < teams.length; i++) {
    schedules.push(await getJson("https://api-web.nhle.com/v1/club-schedule-season/" + teams[i] + "/20252026"));
  }
  var games = backtest.collectGames(schedules);
  var mpGames = [];
  try { mpGames = await loadMoneyPuckGames(); } catch (e) { mpGames = []; }
  var out = backtest.run(games, { minGp: 5, mpGames: mpGames });
  out.generatedAt = new Date().toISOString();
  out.source = "walk-forward from NHL 2025-26 regular-season finals; xG/HDCF fall back to prior scoring rates";
  out.rows = out.rows.filter(function (r) { return r.graded; });
  return out;
}

function detectRoute(req, url) {
  var headers = req.headers || {};
  var parts = [
    req.url,
    url && url.pathname,
    url && url.href,
    headers["x-invoke-path"],
    headers["x-vercel-original-path"],
    headers["x-forwarded-uri"],
    headers["x-invoke-query"],
    headers["x-matched-path"]
  ];
  var blob = parts.filter(Boolean).join(" ").toLowerCase();
  if (blob.indexOf("grade") !== -1) return "/api/estimates/grade";
  if (blob.indexOf("health") !== -1) return "/api/health";
  if (blob.indexOf("matchup") !== -1) return "/api/matchups";
  if (blob.indexOf("backtest") !== -1) return "/api/backtest";
  if (blob.indexOf("estimate") !== -1) return "/api/estimates";
  return (url && url.pathname ? url.pathname.replace(/\/+$/, "") : "") || "/";
}

function handleApi(req, res, url) {
  var pathname = detectRoute(req, url);
  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "hockey-stats", port: PORT, blob: store.usesBlob() });
    return true;
  }
  if (pathname === "/api/matchups") {
    if (cache.body && Date.now() - cache.at < CACHE_MS && url.searchParams.get("refresh") !== "1") {
      sendJson(res, 200, cache.body);
      return true;
    }
    buildMatchups()
      .then(function (body) {
        cache = { at: Date.now(), body: body };
        return store.writeJson(store.KEYS.matchups, body)
          .then(function () { return persistMatchups(body); })
          .catch(function () { return persistMatchups(body); })
          .then(function () { sendJson(res, 200, body); });
      })
      .catch(function (err) {
        store.readJson(store.KEYS.matchups, null).then(function (fallback) {
          if (fallback) {
            fallback.stale = true;
            fallback.error = String(err.message || err);
            sendJson(res, 200, fallback);
            return;
          }
          sendJson(res, 502, { error: String(err.message || err), matchups: [] });
        });
      });
    return true;
  }
  if (pathname === "/api/backtest") {
    store.readJson(store.KEYS.backtest, null).then(function (cached) {
      if (cached && url.searchParams.get("refresh") !== "1") {
        sendJson(res, 200, cached);
        return;
      }
      return runBacktest().then(function (body) {
        return store.writeJson(store.KEYS.backtest, body).catch(function () {}).then(function () {
          sendJson(res, 200, body);
        });
      });
    }).catch(function (err) {
      sendJson(res, 502, { error: String(err.message || err) });
    });
    return true;
  }
  if (pathname === "/api/estimates") {
    estimatesPayload().then(function (body) { sendJson(res, 200, body); });
    return true;
  }
  if (pathname === "/api/estimates/grade" && (req.method === "POST" || req.method === "GET")) {
    gradeEstimates()
      .then(function (body) { sendJson(res, 200, body); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), estimates: [], summary: archive.summarize([]) });
      });
    return true;
  }
  return false;
}

function requestUrl(req) {
  var raw = req.url || "/";
  var headers = req.headers || {};
  var hint = headers["x-invoke-path"] || headers["x-vercel-original-path"] ||
    headers["x-forwarded-uri"] || headers["x-invoke-query"] || "";
  var pathPart = raw.split("?")[0];
  if (pathPart === "/server.js" || pathPart === "/" || pathPart.indexOf("[[") !== -1) {
    if (hint && String(hint).indexOf("/api/") === 0) raw = hint + (raw.indexOf("?") >= 0 ? raw.slice(raw.indexOf("?")) : "");
  }
  try { return new URL(raw, "http://127.0.0.1"); } catch (e) {
    return new URL("/" + String(raw).replace(/^\//, ""), "http://127.0.0.1");
  }
}

function routeKey(pathname) {
  var p = String(pathname || "").replace(/\/+$/, "") || "/";
  if (/\/health$/.test(p) || p === "/health") return "/api/health";
  if (/\/matchups$/.test(p) || p === "/matchups") return "/api/matchups";
  if (/\/backtest$/.test(p) || p === "/backtest") return "/api/backtest";
  if (/\/estimates\/grade$/.test(p)) return "/api/estimates/grade";
  if (/\/estimates$/.test(p) || p === "/estimates") return "/api/estimates";
  return p;
}

function handler(req, res) {
  var url = requestUrl(req);
  url.pathname = routeKey(url.pathname);
  if (handleApi(req, res, url)) return;
  var headers = req.headers || {};
  var looksApi = /api/i.test(String(req.url || "") + url.pathname + (headers["x-invoke-path"] || ""));
  if (looksApi) {
    sendJson(res, 200, {
      ok: false,
      error: "unmatched-api",
      url: req.url,
      pathname: url.pathname,
      invoke: headers["x-invoke-path"] || null,
      forwarded: headers["x-forwarded-uri"] || null
    });
    return;
  }
  var file = safeFile(url.pathname);
  if (!file) {
    send(res, 403, "Forbidden");
    return;
  }
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      send(res, 404, "Not found");
      return;
    }
    serveFile(res, file);
  });
}

var server = http.createServer(handler);

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", function () {
    console.log("hockey-stats http://localhost:" + PORT);
  });
}

handler.server = server;
handler.buildMatchups = buildMatchups;
handler.runBacktest = runBacktest;
handler.PORT = PORT;
module.exports = handler;
