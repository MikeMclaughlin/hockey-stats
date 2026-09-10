"use strict";

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var { URL } = require("url");
var stats = require("./js/stats.js");
var archive = require("./js/archive.js");

var ROOT = __dirname;
var PORT = Number(process.env.PORT || 3080);
var CACHE_MS = 5 * 60 * 1000;
var cache = { at: 0, body: null };
var ESTIMATES_FILE = path.join(ROOT, "data", "estimates.json");

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
  var file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
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

function httpsGet(urlStr, cb) {
  https.get(urlStr, { headers: { "User-Agent": "hockey-stats/1.0", Accept: "*/*" } }, function (up) {
    if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
      up.resume();
      httpsGet(up.headers.location, cb);
      return;
    }
    var chunks = [];
    up.on("data", function (c) { chunks.push(c); });
    up.on("end", function () {
      var buf = Buffer.concat(chunks);
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

  var last5Map = {};
  var abbrevs = Object.keys(needed);
  await Promise.all(
    abbrevs.map(function (ab) {
      var url = "https://api-web.nhle.com/v1/club-schedule-season/" + ab + "/" + statsSeason;
      return getJson(url)
        .then(function (sched) {
          last5Map[ab] = last5FromSchedule(sched, ab);
        })
        .catch(function () {
          last5Map[ab] = null;
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
      last5: last5Map[ab]
    });
    p.score = teamObj.score;
    return p;
  }

  var matchups = games.map(function (g) {
    var away = profile(g.awayTeam || {});
    var home = profile(g.homeTeam || {});
    var edge = stats.matchupEdge(away, home);
    var winnerTeam = edge.winner === "away" ? away : edge.winner === "home" ? home : null;
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
      projected: stats.estimateScore(away, home)
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

function loadEstimates() {
  try {
    return JSON.parse(fs.readFileSync(ESTIMATES_FILE, "utf8"));
  } catch (e) {
    return archive.emptyStore();
  }
}

function saveEstimates(store) {
  fs.writeFileSync(ESTIMATES_FILE, JSON.stringify(store, null, 2));
}

function persistMatchups(body) {
  var store = loadEstimates();
  (body.matchups || []).forEach(function (m) {
    var proj = m.projected || {};
    archive.freezeEstimate(store, {
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
    var row = store.byId[String(m.id)];
    var as = m.away && m.away.score;
    var hs = m.home && m.home.score;
    if (row && archive.isFinalState(m.gameState) && as != null && hs != null) {
      archive.applyResult(row, as, hs, m.gameState);
    }
  });
  saveEstimates(store);
  return store;
}

function estimatesPayload(store) {
  store = store || loadEstimates();
  var estimates = archive.listEstimates(store).sort(function (a, b) {
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
  var store = loadEstimates();
  var rows = archive.listEstimates(store).filter(function (r) { return !r.graded && r.gameDate; });
  var dates = {};
  rows.forEach(function (r) { dates[r.gameDate] = true; });
  var today = new Date().toISOString().slice(0, 10);
  var keys = Object.keys(dates).filter(function (d) { return d <= today; });
  for (var i = 0; i < keys.length; i++) {
    var payload = await getJson("https://api-web.nhle.com/v1/score/" + keys[i]);
    (payload.games || []).forEach(function (g) {
      var row = store.byId[String(g.id)];
      if (!row || !archive.isFinalState(g.gameState)) return;
      var as = g.awayTeam && g.awayTeam.score;
      var hs = g.homeTeam && g.homeTeam.score;
      if (as == null || hs == null) return;
      archive.applyResult(row, as, hs, g.gameState);
    });
  }
  saveEstimates(store);
  return estimatesPayload(store);
}

function handleApi(req, res, url) {
  var pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "hockey-stats", port: PORT });
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
        try {
          fs.writeFileSync(path.join(ROOT, "data", "matchups.json"), JSON.stringify(body, null, 2));
          persistMatchups(body);
        } catch (e) { /* ignore cache write */ }
        sendJson(res, 200, body);
      })
      .catch(function (err) {
        var fallback = null;
        try {
          fallback = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "matchups.json"), "utf8"));
        } catch (e) { /* none */ }
        if (fallback) {
          fallback.stale = true;
          fallback.error = String(err.message || err);
          sendJson(res, 200, fallback);
          return;
        }
        sendJson(res, 502, { error: String(err.message || err), matchups: [] });
      });
    return true;
  }
  if (pathname === "/api/estimates") {
    sendJson(res, 200, estimatesPayload());
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

var server = http.createServer(function (req, res) {
  var url = new URL(req.url, "http://127.0.0.1");
  if (handleApi(req, res, url)) return;
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
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", function () {
    console.log("hockey-stats http://localhost:" + PORT);
  });
}

module.exports = { server, buildMatchups, PORT };
