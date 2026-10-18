"use strict";

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var { URL } = require("url");
var stats = require("./public/js/stats.js");
var dates = require("./public/js/dates.js");
var edgeModel = require("./public/js/edge-model.js");
var archive = require("./public/js/archive.js");
var backtest = require("./public/js/backtest.js");
var store = require("./public/js/store.js");
var auth = require("./lib/auth.js");
var streaks = require("./public/js/streaks.js");
var teamStats = require("./public/js/teamStats.js");
var trends = require("./public/js/trends.js");

var ROOT = __dirname;
var PORT = Number(process.env.PORT || 3080);
var CACHE_MS = 5 * 60 * 1000;
var matchupCache = Object.create(null);
var periodGoalMemory = { season: null, games: {} };
var xgLogMemory = Object.create(null);

function productVersion() {
  try {
    var parts = String(require("./package.json").version || "2.4").split(".");
    var major = parts[0] || "2";
    var minor = parts[1] || "0";
    if (parts.length < 3 || parts[2] === "") return major + "." + minor;
    return major + "." + minor + "." + parts[2];
  } catch (e) {
    return "2.4";
  }
}

function formatSeason(id) {
  var n = Number(id);
  if (!isFinite(n) || n < 10000000) return id == null ? "" : String(id);
  var start = Math.floor(n / 10000);
  var end = String(n % 10000).slice(-2);
  return start + "-" + end;
}

var LIVE_STATS_SEASON = 20262027;
var LIVE_BACKTEST_SEASON = "20262027";
var EARLY_SEASON_GP = 10;
var statsSeasonMemory = null;

function seasonMeta(scoreSeason, statsSeason, maxGp) {
  var scoreLabel = formatSeason(scoreSeason);
  var statsLabel = formatSeason(statsSeason);
  var prior = Number(statsSeason) < Number(scoreSeason);
  var early = Number(statsSeason) === LIVE_STATS_SEASON && maxGp != null && maxGp > 0 && maxGp < EARLY_SEASON_GP;
  var note = "";
  if (prior) {
    note = "No " + scoreLabel + " regular-season game is final yet, so records and rates are the " + statsLabel + " regular season.";
  } else if (early) {
    note = statsLabel + " is early. Records and rates use a small sample.";
  }
  return {
    scoreboardSeason: scoreSeason,
    statsSeason: statsSeason,
    scoreboardSeasonLabel: scoreLabel,
    statsSeasonLabel: statsLabel,
    earlySample: early,
    note: note
  };
}

function cleanDate(value) {
  var s = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function alignStand(stand, summary) {
  var rec = teamStats.recordFromSources(stand, summary);
  var next = Object.assign({}, stand || {});
  next.wins = rec.wins;
  next.losses = rec.losses;
  next.otLosses = rec.otl;
  if (rec.gamesPlayed != null) next.gamesPlayed = rec.gamesPlayed;
  if (rec.goalDiff != null) next.goalDifferential = rec.goalDiff;
  if (rec.ptsPct != null) next.pointPct = rec.ptsPct;
  if (rec.goalsFor != null) next.goalFor = rec.goalsFor;
  if (rec.goalsAgainst != null) next.goalAgainst = rec.goalsAgainst;
  return next;
}
var ESTIMATES_FILE = path.join(ROOT, "data", "estimates.json");
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
  https.get(urlStr, { headers: { "User-Agent": "hockey-stats/1.9", Accept: "*/*" } }, function (up) {
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

function httpsRequest(method, urlStr, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    var u = new URL(urlStr);
    var body = options.body || "";
    var headers = Object.assign({
      "User-Agent": "hockey-stats/2.0",
      Accept: "application/json"
    }, options.headers || {});
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    var req = https.request({
      method: method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: headers
    }, function (up) {
      var chunks = [];
      up.on("data", function (c) { chunks.push(c); });
      up.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        if (up.statusCode !== 200) {
          reject(new Error("HTTP " + up.statusCode));
          return;
        }
        try { resolve(JSON.parse(text)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

function redirect(res, status, location, cookies) {
  var headers = {
    Location: location,
    "Cache-Control": "no-store"
  };
  if (cookies && cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(status, headers);
  res.end();
}

function requireAdmin(req, res) {
  var session = auth.readSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return null;
  }
  if (!auth.isAdmin(session)) {
    sendJson(res, 403, { ok: false, error: "forbidden" });
    return null;
  }
  return session;
}

var PREF_SECTIONS = { teams: true, backtest: true, review: true, matchups: true, streaks: true };

function cleanPrefs(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  var out = {};
  Object.keys(PREF_SECTIONS).forEach(function (key) {
    var value = input[key];
    if (value && typeof value === "object" && !Array.isArray(value)) out[key] = value;
  });
  var text = JSON.stringify(out);
  if (text.length > 60000) return null;
  return JSON.parse(text);
}

function prefsName(session) {
  return "user-prefs/" + auth.emailHash(session.email) + ".json";
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

function isFinalState(state) {
  var st = String(state || "").toUpperCase();
  return st === "OFF" || st === "FINAL" || st.indexOf("FINAL") === 0;
}

function mapPool(items, limit, fn) {
  var list = items || [];
  if (!list.length) return Promise.resolve();
  var i = 0;
  var n = Math.max(1, Math.min(limit || 1, list.length));
  function worker() {
    if (i >= list.length) return Promise.resolve();
    var idx = i++;
    return Promise.resolve(fn(list[idx], idx)).then(worker, worker);
  }
  var jobs = [];
  for (var w = 0; w < n; w++) jobs.push(worker());
  return Promise.all(jobs);
}

function mapPoolValues(items, limit, fn) {
  var list = items || [];
  var out = new Array(list.length);
  var i = 0;
  var n = Math.max(1, Math.min(limit || 1, list.length || 1));
  if (!list.length) return Promise.resolve(out);
  function worker() {
    if (i >= list.length) return Promise.resolve();
    var idx = i++;
    return Promise.resolve(fn(list[idx], idx)).then(function (value) {
      out[idx] = value;
      return worker();
    }, function () {
      out[idx] = null;
      return worker();
    });
  }
  var jobs = [];
  for (var w = 0; w < n; w++) jobs.push(worker());
  return Promise.all(jobs).then(function () { return out; });
}

function restDaysBetween(lastDate, currentDate) {
  if (!lastDate || !currentDate) return null;
  var a = Date.parse(String(lastDate).slice(0, 10) + "T00:00:00Z");
  var b = Date.parse(String(currentDate).slice(0, 10) + "T00:00:00Z");
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

var shotMemo = Object.create(null);

function fetchGameShots(id) {
  var key = String(id);
  if (!shotMemo[key]) {
    shotMemo[key] = getJson("https://api-web.nhle.com/v1/gamecenter/" + key + "/right-rail").then(function (rail) {
      var rows = (rail && rail.teamGameStats) || [];
      var sog = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].category === "sog") { sog = rows[i]; break; }
      }
      if (!sog) return null;
      var away = Number(sog.awayValue);
      var home = Number(sog.homeValue);
      if (!isFinite(away) || !isFinite(home)) return null;
      return { away: away, home: home };
    }).catch(function () { return null; });
  }
  return shotMemo[key];
}

function loadShotMap(ids) {
  var unique = [];
  var seen = Object.create(null);
  (ids || []).forEach(function (id) {
    var key = String(id || "");
    if (!key || seen[key]) return;
    seen[key] = true;
    unique.push(key);
  });
  var map = Object.create(null);
  return mapPool(unique, 6, function (id) {
    return fetchGameShots(id).then(function (shots) { map[id] = shots; });
  }).then(function () { return map; });
}

function shotIdsForTeam(games, abbrev, opts) {
  opts = opts || {};
  var ids = [];
  var rs = teamStats.finishedGames(games, abbrev, 2);
  var pre = teamStats.finishedGames(games, abbrev, 1);
  function pushLast(list) {
    list.slice(-5).forEach(function (g) { if (g.id != null) ids.push(g.id); });
  }
  pushLast(rs.length ? rs : pre);
  if (opts.splits) {
    ["home", "away"].forEach(function (venue) {
      var rsV = rs.filter(function (g) { return g.venue === venue; });
      var preV = pre.filter(function (g) { return g.venue === venue; });
      pushLast(rsV.length ? rsV : preV);
    });
  }
  if (opts.preseasonTotals) {
    pre.forEach(function (g) { if (g.id != null) ids.push(g.id); });
  }
  return ids;
}

function priorSeasonId(seasonId) {
  var n = Number(seasonId);
  if (!isFinite(n) || n < 10000000) return 20252026;
  return n - 10001;
}

function standingsSnapshot(payload, seasonId) {
  var rows = (payload && payload.standings) || [];
  var maxGp = 0;
  var played = false;
  rows.forEach(function (row) {
    if (Number(row.seasonId) !== Number(seasonId)) return;
    var gp = Number(row.gamesPlayed) || 0;
    if (gp > maxGp) maxGp = gp;
    if (gp > 0) played = true;
  });
  return { played: played, maxGp: maxGp };
}

function sameSeasonRow(row, seasonId) {
  if (!row) return null;
  if (row.seasonId == null) return row;
  if (Number(row.seasonId) !== Number(seasonId)) return null;
  return row;
}

function venueSplit(stand, prefix) {
  if (!stand) return null;
  var w = stand[prefix + "Wins"];
  var l = stand[prefix + "Losses"];
  var o = stand[prefix + "OtLosses"];
  if (w == null && l == null && o == null) return null;
  return stats.recordString(Number(w) || 0, Number(l) || 0, Number(o) || 0);
}

async function readStatsSeasonLock() {
  if (statsSeasonMemory && statsSeasonMemory.locked && Number(statsSeasonMemory.statsSeason) >= LIVE_STATS_SEASON) {
    return statsSeasonMemory;
  }
  var cached = await store.readJson(store.KEYS.statsSeason, null);
  if (cached && cached.locked && Number(cached.statsSeason) >= LIVE_STATS_SEASON) {
    statsSeasonMemory = {
      statsSeason: Number(cached.statsSeason),
      locked: true,
      source: cached.source || "cache"
    };
    return statsSeasonMemory;
  }
  return null;
}

async function detectFinalRegularGame(seasonId) {
  var startYear = Math.floor(Number(seasonId) / 10000);
  var cursor = startYear + "-09-01";
  var today = new Date().toISOString().slice(0, 10);
  var guard = 0;
  while (cursor <= today && guard < 16) {
    guard += 1;
    try {
      var sched = await getJson("https://api-web.nhle.com/v1/schedule/" + cursor);
      var found = false;
      var foundDate = null;
      (sched.gameWeek || []).forEach(function (week) {
        (week.games || []).forEach(function (g) {
          if (found) return;
          if (Number(g.season) !== Number(seasonId)) return;
          if (Number(g.gameType) !== 2) return;
          if (!isFinalState(g.gameState)) return;
          found = true;
          foundDate = g.gameDate || cursor;
        });
      });
      if (found) return { yes: true, source: "schedule", date: foundDate };
      var next = sched.nextStartDate;
      if (!next || next <= cursor) cursor = shiftDate(cursor, 7);
      else cursor = next;
    } catch (e) {
      cursor = shiftDate(cursor, 7);
    }
  }
  try {
    var est = await store.readJson(store.KEYS.estimates, null);
    var byId = (est && est.byId) || {};
    var ids = Object.keys(byId);
    for (var i = 0; i < ids.length; i++) {
      var row = byId[ids[i]];
      if (!row || Number(row.seasonId) !== Number(seasonId)) continue;
      if (row.graded || row.actualAway != null || row.actualHome != null) {
        return { yes: true, source: "archive", date: row.gameDate || null };
      }
    }
    var arch = await store.readJson(store.KEYS.matchupArchive, null);
    var games = (arch && arch.games) || (arch && arch.byId) || null;
    if (games && typeof games === "object") {
      var keys = Object.keys(games);
      for (var j = 0; j < keys.length; j++) {
        var g = games[keys[j]];
        if (!g || Number(g.seasonId) !== Number(seasonId)) continue;
        if (Number(g.gameType) && Number(g.gameType) !== 2) continue;
        if (g.graded || g.actualAway != null || g.actualHome != null || isFinalState(g.gameState)) {
          if (g.actualAway != null || g.actualHome != null || g.graded) {
            return { yes: true, source: "archive", date: g.gameDate || null };
          }
        }
      }
    }
  } catch (e) { /* archive is optional evidence */ }
  return { yes: false, source: "none" };
}

/**
 * Stats season is global: once any live-season regular-season game is final,
 * every viewed date uses that season. The lock is cached and is not cleared.
 */
async function resolveStatsSeason(scoreboardSeason, standingsPayload) {
  var locked = await readStatsSeasonLock();
  if (!locked) {
    var snap = standingsPayload ? standingsSnapshot(standingsPayload, LIVE_STATS_SEASON) : { played: false, maxGp: 0 };
    var detected = snap.played
      ? { yes: true, source: "standings" }
      : await detectFinalRegularGame(LIVE_STATS_SEASON);
    if (detected.yes) {
      var body = {
        locked: true,
        statsSeason: LIVE_STATS_SEASON,
        detectedAt: new Date().toISOString(),
        source: detected.source,
        throughDate: detected.date || null
      };
      statsSeasonMemory = { statsSeason: LIVE_STATS_SEASON, locked: true, source: detected.source };
      try { await store.writeJson(store.KEYS.statsSeason, body); } catch (e) { /* keep the in-memory lock */ }
      locked = statsSeasonMemory;
    }
  }
  var board = Number(scoreboardSeason) || priorSeasonId(LIVE_STATS_SEASON);
  var statsSeason = locked ? Number(locked.statsSeason) : (board >= LIVE_STATS_SEASON ? priorSeasonId(board) : board);
  return {
    statsSeason: statsSeason,
    locked: !!locked,
    source: locked ? (locked.source || "cache") : "prior"
  };
}

function mpSeasonYear(seasonId) {
  return String(Math.floor(Number(seasonId) / 10000));
}

async function fetchPartnerOdds(date) {
  var url = "https://api-web.nhle.com/v1/partner-game/US/" + (date || "now");
  try {
    var partner = await getJson(url);
    var name = partner.bettingPartner && partner.bettingPartner.name;
    var map = Object.create(null);
    (partner.games || []).forEach(function (og) {
      var parsed = stats.parsePartnerOdds(og);
      parsed.partner = name || null;
      if (parsed.awayMl == null && parsed.homeMl == null && parsed.total == null) return;
      map[String(og.gameId)] = parsed;
    });
    return map;
  } catch (e) {
    return Object.create(null);
  }
}

function publicOdds(row) {
  var lines = archive.oddsLines(row);
  if (!lines) return null;
  lines.saved = true;
  lines.locked = !!(row && row.locked);
  return lines;
}

async function loadOddsStore() {
  var data = await store.readJson(store.KEYS.odds, null);
  if (data && data.byId) return data;
  return { version: 1, byId: {} };
}

/**
 * Snapshot every game's moneyline and total. Live partner odds (DraftKings
 * when that book is posted) update the line until puck drop. After start,
 * the saved line is what the card shows. Past dates are also asked of the
 * NHL partner feed; a 404 leaves recovery to the odds store and matchup archive.
 */
async function applyOddsSnapshots(matchups, liveById) {
  var oddsStore = await loadOddsStore();
  var arch = await store.readJson(store.KEYS.matchupArchive, null);
  var archById = (arch && arch.byId) || {};
  var needDates = Object.create(null);
  (matchups || []).forEach(function (m) {
    var id = String(m.id);
    var started = archive.hasStarted(m, Date.now());
    var saved = oddsStore.byId[id];
    var live = liveById[id];
    if (started && !archive.oddsLines(saved) && !archive.oddsLines(live)) needDates[m.gameDate] = true;
  });
  var recovered = Object.create(null);
  var dates = Object.keys(needDates);
  for (var i = 0; i < dates.length; i++) {
    if (!dates[i]) continue;
    var fetched = await fetchPartnerOdds(dates[i]);
    Object.keys(fetched).forEach(function (id) { recovered[id] = fetched[id]; });
  }
  var wrote = false;
  (matchups || []).forEach(function (m) {
    var id = String(m.id);
    var started = archive.hasStarted(m, Date.now());
    var live = liveById[id] || recovered[id] || null;
    var fromArchive = archById[id] && archById[id].odds;
    var seed = live || (started ? fromArchive : null);
    var result = archive.snapshotOdds(oddsStore, {
      id: m.id,
      gameDate: m.gameDate,
      startTimeUTC: m.startTimeUTC,
      gameState: m.gameState,
      awayAbbrev: m.away && m.away.abbrev,
      homeAbbrev: m.home && m.home.abbrev,
      odds: seed
    });
    if (result.wrote) wrote = true;
    var savedOdds = publicOdds(result.row);
    if (started) {
      m.odds = savedOdds;
      m.oddsMissing = !savedOdds;
    } else {
      m.odds = (live && archive.oddsLines(live)) ? Object.assign({ saved: !!result.row, locked: false }, archive.oddsLines(live)) : savedOdds;
      m.oddsMissing = false;
    }
  });
  if (wrote) {
    try { await store.writeJson(store.KEYS.odds, oddsStore); }
    catch (e) { /* board still returns the in-memory lines */ }
  }
  return oddsStore;
}

async function buildMatchups(date) {
  var day = cleanDate(date) || dates.etSlateDate(new Date());
  var score = await getJson("https://api-web.nhle.com/v1/score/" + day);
  rememberScoreboard(day, score);
  var standings = await getJson("https://api-web.nhle.com/v1/standings/now");
  var liveOdds = await fetchPartnerOdds(null);
  var datedOdds = await fetchPartnerOdds(day);
  Object.keys(datedOdds).forEach(function (id) { liveOdds[id] = datedOdds[id]; });
  var seasonId = seasonIdFromScore(score);
  var resolved = await resolveStatsSeason(seasonId, standings);
  var statsSeason = resolved.statsSeason;
  var summaryUrl =
    "https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId=" +
    statsSeason + "%20and%20gameTypeId=2";
  var summary = await getJson(summaryUrl);

  var mp = {};
  try {
    // MoneyPuck publishes regular-season team rows only. 2026 preseason
    // seasonSummary returns 404, so advanced rates are not filled from it.
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

  var mpGamesCache = mpSeasonYear(statsSeason) === "2025"
    ? await store.readJson(store.KEYS.mpGames, [])
    : [];
  var last5Map = {};
  var formMap = {};
  var schedMap = {};
  var abbrevs = Object.keys(needed);
  await Promise.all(
    abbrevs.map(function (ab) {
      var url = "https://api-web.nhle.com/v1/club-schedule-season/" + ab + "/" + statsSeason;
      return getJson(url)
        .then(function (sched) {
          var games = sched.games || [];
          schedMap[ab] = games;
          var regular = games.filter(function (g) {
            return !g.gameType || Number(g.gameType) === 2;
          });
          last5Map[ab] = last5FromSchedule({ games: regular }, ab);
          formMap[ab] = backtest.scheduleForm(games, ab, day);
        })
        .catch(function () {
          schedMap[ab] = [];
          last5Map[ab] = null;
          formMap[ab] = { lastDate: null, dates: [], results: [] };
        });
    })
  );

  function teamRecord(ab) {
    return teamStats.recordFromSources(
      sameSeasonRow(standMap[ab], statsSeason),
      sameSeasonRow(sumMap[ab], statsSeason)
    );
  }

  var shotIds = [];
  abbrevs.forEach(function (ab) {
    var rec = teamRecord(ab);
    shotIds = shotIds.concat(shotIdsForTeam(schedMap[ab] || [], ab, {
      preseasonTotals: !rec.gamesPlayed
    }));
  });
  var shotById = await loadShotMap(shotIds);

  function preseasonRest(ab) {
    var prior = teamStats.finishedGames(schedMap[ab] || [], ab, 1).filter(function (g) {
      return !day || String(g.date || "").slice(0, 10) < String(day).slice(0, 10);
    });
    if (!prior.length) return null;
    return restDaysBetween(prior[prior.length - 1].date, day);
  }

  function last5Save(ab, preseason) {
    var fromMp = stats.last5SavePctFromMp(mpGamesCache, ab, day);
    if (fromMp != null && !preseason) return fromMp;
    var games = schedMap[ab] || [];
    var rs = teamStats.finishedGames(games, ab, 2);
    var src = preseason ? teamStats.finishedGames(games, ab, 1) : rs;
    var last = teamStats.attachShots(src, shotById).slice(-5);
    return teamStats.last5SavePct(last);
  }

  function preseasonFill(ab) {
    var games = schedMap[ab] || [];
    var pre = teamStats.attachShots(teamStats.finishedGames(games, ab, 1), shotById);
    var tot = teamStats.totalsFromGames(pre);
    if (!tot.games) return null;
    var preOnly = games.filter(function (g) { return Number(g.gameType) === 1; });
    var last = pre.slice(-5);
    return {
      gamesPlayed: tot.games,
      wins: tot.wins,
      losses: tot.losses,
      otl: tot.otl,
      goalsFor: tot.gf,
      goalsAgainst: tot.ga,
      pdo: tot.sf != null ? teamStats.pdoFromShots(tot.gf, tot.ga, tot.sf, tot.sa) : null,
      sogShare: tot.sf != null ? stats.sogShare(tot.sf, tot.sa) : null,
      last5: stats.last5GoalDiff(preOnly, ab),
      last5SvPct: teamStats.last5SavePct(last),
      restDays: preseasonRest(ab)
    };
  }

  function profile(teamObj) {
    var ab = teamObj.abbrev;
    var meta = stats.teamByAbbrev(ab) || {};
    var rec = teamRecord(ab);
    var rsRest = restDaysBetween((formMap[ab] || {}).lastDate, day);
    var restFromPre = rsRest == null;
    var rest = rsRest != null ? rsRest : preseasonRest(ab);
    var fill = rec.gamesPlayed ? null : preseasonFill(ab);
    var flags = {};
    if (!fill && restFromPre && rest != null) flags.rest = true;
    var standRow = sameSeasonRow(standMap[ab], statsSeason);
    var p = stats.buildTeamProfile({
      abbrev: ab,
      name: meta.name || (teamObj.name && teamObj.name.default) || ab,
      logo: teamObj.logo,
      stand: alignStand(standRow, sameSeasonRow(sumMap[ab], statsSeason)),
      summary: sameSeasonRow(sumMap[ab], statsSeason) || {},
      homeRecord: venueSplit(standRow, "home"),
      roadRecord: venueSplit(standRow, "road"),
      moneypuck: mp[ab] || {},
      last5: last5Map[ab],
      last5SvPct: rec.gamesPlayed ? last5Save(ab, false) : null,
      restDays: fill ? null : rest,
      restFromPreseason: !fill && restFromPre && rest != null,
      preseasonFlags: flags,
      preseasonFill: fill
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
    var odds = liveOdds[String(g.id)] || null;
    var market = stats.marketSide(odds);
    var marketDisagree = !!(market && market !== "even" && edge.winner && edge.winner !== market);
    return {
      id: g.id,
      gameDate: g.gameDate || day,
      startTimeUTC: g.startTimeUTC,
      venue: g.venue && g.venue.default,
      gameState: g.gameState,
      gameType: g.gameType,
      gameTypeLabel: stats.gameLabel(g.gameType),
      scoreboard: stats.presentScore(g),
      away: away,
      home: home,
      edge: edge,
      edgeTeam: winnerTeam ? winnerTeam.abbrev : "EVEN",
      edgeName: winnerTeam ? winnerTeam.name : "Even matchup",
      why: stats.explainEdge(edge, away, home, edgeModel.fromMatchup({
        away: away,
        home: home,
        projected: projected,
        edge: edge,
        gameDate: g.gameDate || day
      }).pick),
      projected: projected,
      odds: odds,
      marketSide: market,
      marketDisagree: marketDisagree,
      notes: backtest.buildNotes(
        { gameDate: g.gameDate, awayAbbrev: away.abbrev, homeAbbrev: home.abbrev },
        formMap[away.abbrev] || { lastDate: null, dates: [], results: [] },
        formMap[home.abbrev] || { lastDate: null, dates: [], results: [] },
        projected,
        odds
      )
    };
  });

  await applyOddsSnapshots(matchups, liveOdds);
  var xgYear = mpSeasonYear(statsSeason);
  await mapPool(abbrevs, 4, function (ab) { return loadTeamXgLog(ab, xgYear); });
  matchups.forEach(function (m) {
    var before = m.gameDate || day;
    m.away.last5XgfPct = last5XgShare(xgLogMemory[xgYear + ":" + m.away.abbrev], m.away.abbrev, before);
    m.home.last5XgfPct = last5XgShare(xgLogMemory[xgYear + ":" + m.home.abbrev], m.home.abbrev, before);
    var market = stats.marketSide(m.odds);
    m.marketSide = market;
    m.marketDisagree = !!(market && market !== "even" && m.edge && m.edge.winner && m.edge.winner !== market);
    m.notes = backtest.buildNotes(
      { gameDate: m.gameDate, awayAbbrev: m.away.abbrev, homeAbbrev: m.home.abbrev },
      formMap[m.away.abbrev] || { lastDate: null, dates: [], results: [] },
      formMap[m.home.abbrev] || { lastDate: null, dates: [], results: [] },
      m.projected,
      m.odds
    );
  });

  var seasons = seasonMeta(seasonId, statsSeason, standingsSnapshot(standings, statsSeason).maxGp);
  return {
    generatedAt: new Date().toISOString(),
    currentDate: day,
    prevDate: score.prevDate,
    nextDate: score.nextDate,
    seasonId: seasonId,
    statsSeason: statsSeason,
    statsSeasonSource: resolved.source,
    statsSeasonLocked: resolved.locked,
    earlySample: seasons.earlySample,
    scoreboardSeason: seasons.scoreboardSeason,
    scoreboardSeasonLabel: seasons.scoreboardSeasonLabel,
    statsSeasonLabel: seasons.statsSeasonLabel,
    note: seasons.note,
    preseasonLabel: formatSeason(statsSeason) + " preseason",
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
    }, { relock: true });
    var row = storeEst.byId[String(m.id)];
    if (row) {
      row.liveAway = proj.away;
      row.liveHome = proj.home;
      row.liveLabel = proj.away + "–" + proj.home;
      row.liveMatchesLock = row.projectedAway === proj.away && row.projectedHome === proj.home;
    }
    var as = m.away && m.away.score;
    var hs = m.home && m.home.score;
    if (row && archive.isFinalState(m.gameState) && as != null && hs != null) {
      archive.applyResult(row, as, hs, m.gameState);
    }
    if (row && m.edge && m.edge.winner) {
      var edgeAbbrev = m.edge.winner === "away"
        ? (m.away && m.away.abbrev)
        : (m.home && m.home.abbrev);
      archive.rememberEdge(row, {
        edgeWinner: m.edge.winner,
        edgeScore: m.edge.score,
        edgeAbbrev: edgeAbbrev,
        edgeTossUp: stats.isTossUp(m.edge),
        gameState: m.gameState,
        startTimeUTC: m.startTimeUTC
      }, Date.now());
    }
  });
  await saveEstimates(storeEst);
  var arch = await store.readJson(store.KEYS.matchupArchive, archive.emptyStore());
  (body.matchups || []).forEach(function (m) {
    var proj = m.projected || {};
    var odds = m.odds || null;
    archive.freezeMatchupArchive(arch, {
      id: m.id,
      seasonId: body.seasonId,
      gameDate: m.gameDate,
      startTimeUTC: m.startTimeUTC,
      venue: m.venue,
      gameType: m.gameType,
      awayAbbrev: m.away && m.away.abbrev,
      homeAbbrev: m.home && m.home.abbrev,
      estimatedAway: proj.away,
      estimatedHome: proj.home,
      awayPills: archive.teamPills(m.away),
      homePills: archive.teamPills(m.home),
      odds: odds ? {
        awayMl: odds.awayMl,
        homeMl: odds.homeMl,
        awayImplied: stats.impliedWinPct(odds.awayMl),
        homeImplied: stats.impliedWinPct(odds.homeMl),
        hold: stats.twoWayHold(odds.awayMl, odds.homeMl),
        total: odds.total,
        overPrice: odds.overPrice,
        underPrice: odds.underPrice,
        partner: odds.partner || null
      } : null
    });
  });
  try { await store.writeJson(store.KEYS.matchupArchive, arch); } catch (e) { /* ignore */ }
  return storeEst;
}

var SCORE_CACHE_MS = 45 * 1000;
var scoreCache = Object.create(null);

function rememberScoreboard(key, score) {
  if (!score) return;
  scoreCache[key || "now"] = { at: Date.now(), score: score };
}

async function loadScoreboard(date) {
  var key = date || "now";
  var hit = scoreCache[key];
  if (hit && hit.score && Date.now() - hit.at < SCORE_CACHE_MS) return hit;
  var url = date
    ? "https://api-web.nhle.com/v1/score/" + date
    : "https://api-web.nhle.com/v1/score/now";
  var score = await getJson(url);
  rememberScoreboard(key, score);
  return scoreCache[key];
}

function scorePayload(packed) {
  var score = (packed && packed.score) || {};
  var games = (score.games || []).map(function (g) {
    var presented = stats.presentScore(g);
    return {
      id: g.id,
      away: presented.away,
      home: presented.home,
      state: presented.state,
      live: presented.live,
      final: presented.final,
      status: presented.status,
      period: presented.period,
      clock: presented.clock,
      awayAbbrev: g.awayTeam && g.awayTeam.abbrev,
      homeAbbrev: g.homeTeam && g.homeTeam.abbrev
    };
  });
  return {
    currentDate: score.currentDate || null,
    prevDate: score.prevDate || null,
    nextDate: score.nextDate || null,
    cachedAt: packed && packed.at ? new Date(packed.at).toISOString() : new Date().toISOString(),
    games: games
  };
}

async function overlayScores(body, date) {
  var packed;
  try {
    packed = await loadScoreboard(date || null);
  } catch (e) {
    return body;
  }
  var byId = {};
  ((packed.score && packed.score.games) || []).forEach(function (g) {
    byId[String(g.id)] = g;
  });
  (body.matchups || []).forEach(function (m) {
    var game = byId[String(m.id)];
    var prev = m.scoreboard || {};
    if (!game) return;
    var fresh = stats.presentScore(game);
    if (fresh.away == null && prev.final && prev.away != null && prev.home != null) {
      fresh.away = prev.away;
      fresh.home = prev.home;
      fresh.final = true;
      fresh.live = false;
      fresh.status = fresh.status || prev.status || "Final";
    }
    m.scoreboard = fresh;
    if (fresh.state) m.gameState = fresh.state;
    if (fresh.away != null && m.away) m.away.score = fresh.away;
    if (fresh.home != null && m.home) m.home.score = fresh.home;
  });
  return body;
}

function edgePickFrom(row, archRow, awayAbbrev, homeAbbrev) {
  if (row && row.edgeWinner) {
    return {
      winner: row.edgeWinner,
      score: row.edgeScore != null ? row.edgeScore : null,
      abbrev: row.edgeAbbrev || (row.edgeWinner === "away" ? awayAbbrev : homeAbbrev),
      tossUp: !!row.edgeTossUp,
      source: "saved"
    };
  }
  if (!archRow || !archRow.awayPills || !archRow.homePills) return null;
  var edge = stats.matchupEdge(archRow.awayPills, archRow.homePills);
  if (!edge || edge.score == null) return null;
  var winner = edge.winner === "away" ? "away" : "home";
  return {
    winner: winner,
    score: edge.score,
    abbrev: winner === "away" ? awayAbbrev : homeAbbrev,
    tossUp: stats.isTossUp(edge),
    source: "archive"
  };
}

function performanceView(matchup, row, archRow) {
  var board = matchup.scoreboard || {};
  var actualAway = board.away;
  var actualHome = board.home;
  if ((actualAway == null || actualHome == null) && row && row.actualAway != null && row.actualHome != null) {
    actualAway = row.actualAway;
    actualHome = row.actualHome;
  }
  var final = !!(board.final || (row && row.graded));
  if (!final || actualAway == null || actualHome == null) return null;
  if (board.away == null) {
    matchup.scoreboard = Object.assign({}, board, {
      away: actualAway,
      home: actualHome,
      final: true,
      live: false,
      status: board.status || "Final"
    });
  }
  var projectedAway = row && row.projectedAway != null ? Number(row.projectedAway) : null;
  var projectedHome = row && row.projectedHome != null ? Number(row.projectedHome) : null;
  var missingEstimate = projectedAway == null || projectedHome == null;
  var exact = null;
  var winnerCorrect = null;
  var errs = { totalGoalsError: null, marginError: null };
  if (!missingEstimate) {
    exact = projectedAway === Number(actualAway) && projectedHome === Number(actualHome);
    winnerCorrect = archive.winnerOf(projectedAway, projectedHome) === archive.winnerOf(actualAway, actualHome);
    errs = archive.scoreErrors({
      projectedAway: projectedAway,
      projectedHome: projectedHome,
      actualAway: actualAway,
      actualHome: actualHome
    });
  }
  var pick = edgePickFrom(row, archRow, matchup.away && matchup.away.abbrev, matchup.home && matchup.home.abbrev);
  var actualWinner = archive.winnerOf(actualAway, actualHome);
  var edgeCorrect = null;
  if (pick && !pick.tossUp && pick.winner && pick.winner !== "even" && actualWinner && actualWinner !== "tie") {
    edgeCorrect = pick.winner === actualWinner;
  }
  return {
    estimateLabel: missingEstimate ? null : projectedAway + "–" + projectedHome,
    actualLabel: Number(actualAway) + "–" + Number(actualHome),
    exact: exact,
    winnerCorrect: winnerCorrect,
    totalGoalsError: errs.totalGoalsError,
    marginError: errs.marginError,
    edgeAbbrev: pick ? pick.abbrev : null,
    edgeWinner: pick ? pick.winner : null,
    edgeCorrect: edgeCorrect,
    tossUp: !!(pick && pick.tossUp),
    edgeSource: pick ? pick.source : null,
    missingEstimate: missingEstimate,
    missingEdge: !pick
  };
}

async function attachHistory(body) {
  var est = await loadEstimates();
  var arch = await store.readJson(store.KEYS.matchupArchive, archive.emptyStore());
  (body.matchups || []).forEach(function (m) {
    var id = String(m.id);
    var row = est.byId && est.byId[id];
    var archRow = arch.byId && arch.byId[id];
    var awayAbbrev = m.away && m.away.abbrev;
    var homeAbbrev = m.home && m.home.abbrev;
    var pick = edgePickFrom(row, archRow, awayAbbrev, homeAbbrev);
    if (!row && !pick) {
      m.saved = null;
      m.performance = null;
      return;
    }
    m.saved = {
      projectedAway: row ? row.projectedAway : null,
      projectedHome: row ? row.projectedHome : null,
      projectedLabel: row ? row.projectedLabel : null,
      edgeWinner: pick ? pick.winner : null,
      edgeScore: pick ? pick.score : null,
      edgeAbbrev: pick ? pick.abbrev : null,
      edgeTossUp: pick ? !!pick.tossUp : false,
      edgeSource: pick ? pick.source : null,
      graded: !!(row && row.graded),
      actualAway: row ? row.actualAway : null,
      actualHome: row ? row.actualHome : null
    };
    m.performance = performanceView(m, row, archRow);
  });
  return body;
}

function annotateReviewRow(row, archRow, oddsRow) {
  var errs = archive.scoreErrors(row);
  row.totalGoalsError = errs.totalGoalsError;
  row.marginError = errs.marginError;
  row.projectedTotal = errs.projectedTotal;
  row.actualTotal = errs.actualTotal;
  var pick = edgePickFrom(row, archRow, row.awayAbbrev, row.homeAbbrev);
  row.edgeWinnerView = pick ? pick.winner : null;
  row.edgeAbbrevView = pick ? pick.abbrev : null;
  row.edgeScoreView = pick ? pick.score : null;
  row.edgeTossUpView = !!(pick && pick.tossUp);
  row.edgeSource = pick ? pick.source : null;
  var lines = oddsRow ? archive.oddsLines(oddsRow) : null;
  var hasMl = !!(lines && lines.awayMl != null && lines.homeMl != null);
  var hasTotal = !!(lines && lines.total != null);
  row.savedOdds = hasMl || hasTotal;
  row.oddsMissing = !row.savedOdds;
  row.marketSide = hasMl ? stats.marketSide(lines) : null;
  row.ouLine = hasTotal ? lines.total : null;
  var actualWinner = row.graded ? archive.winnerOf(row.actualAway, row.actualHome) : null;
  row.edgePickWon = null;
  if (row.graded && pick && !pick.tossUp && pick.winner && pick.winner !== "even" && actualWinner && actualWinner !== "tie") {
    row.edgePickWon = pick.winner === actualWinner;
  }
  row.favoriteWon = null;
  if (row.graded && hasMl && row.marketSide && row.marketSide !== "even" && actualWinner && actualWinner !== "tie") {
    row.favoriteWon = row.marketSide === actualWinner;
  }
  row.edgeAgreesFavorite = null;
  if (pick && !pick.tossUp && hasMl && row.marketSide && row.marketSide !== "even" && pick.winner !== "even") {
    row.edgeAgreesFavorite = pick.winner === row.marketSide;
  }
  row.ouPick = null;
  row.ouHit = null;
  if (hasTotal && row.projectedAway != null && row.projectedHome != null) {
    var projectedTotal = Number(row.projectedAway) + Number(row.projectedHome);
    if (projectedTotal > lines.total) row.ouPick = "over";
    else if (projectedTotal < lines.total) row.ouPick = "under";
    else row.ouPick = "push";
    if (row.graded && row.actualAway != null && row.actualHome != null && row.ouPick !== "push") {
      var actualTotal = Number(row.actualAway) + Number(row.actualHome);
      if (actualTotal === Number(lines.total)) row.ouHit = null;
      else row.ouHit = (actualTotal > lines.total ? "over" : "under") === row.ouPick;
    }
  }
  return row;
}

async function estimatesPayload(est) {
  est = est || await loadEstimates();
  var arch = await store.readJson(store.KEYS.matchupArchive, archive.emptyStore());
  var oddsStore = await store.readJson(store.KEYS.odds, { byId: {} });
  var estimates = archive.listEstimates(est).map(function (row) {
    return annotateReviewRow(
      row,
      arch.byId && arch.byId[String(row.id)],
      oddsStore.byId && oddsStore.byId[String(row.id)]
    );
  }).sort(function (a, b) {
    return String(a.gameDate || "").localeCompare(String(b.gameDate || "")) ||
      String(a.startTimeUTC || "").localeCompare(String(b.startTimeUTC || ""));
  });
  var payload = {
    generatedAt: new Date().toISOString(),
    estimates: estimates,
    summary: archive.summarize(estimates)
  };
  try {
    var score = await getJson("https://api-web.nhle.com/v1/score/now");
    var standings = await getJson("https://api-web.nhle.com/v1/standings/now");
    var seasonId = seasonIdFromScore(score);
    var resolved = await resolveStatsSeason(seasonId, standings);
    var seasons = seasonMeta(seasonId, resolved.statsSeason, standingsSnapshot(standings, resolved.statsSeason).maxGp);
    payload.statsSeason = resolved.statsSeason;
    payload.statsSeasonLabel = seasons.statsSeasonLabel;
    payload.scoreboardSeason = seasonId;
    payload.scoreboardSeasonLabel = seasons.scoreboardSeasonLabel;
    payload.note = seasons.note;
    payload.earlySample = seasons.earlySample;
    payload.asOf = score.currentDate || null;
  } catch (e) { /* review still loads without the season line */ }
  return payload;
}

async function gradeEstimates() {
  var loaded = await store.readJsonResult(store.KEYS.estimates, null);
  var raw = loaded.value;
  var est = raw && raw.byId ? raw : archive.emptyStore();
  var before = JSON.stringify(est);
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
  var changed = JSON.stringify(est) !== before;
  var persisted = false;
  var storageError = null;
  var writeSkipped = null;
  if (loaded.source === "fallback") {
    writeSkipped = "bundled-fallback";
  } else if (!changed) {
    writeSkipped = "unchanged";
    persisted = true;
  } else {
    try {
      await saveEstimates(est);
      persisted = true;
    } catch (e) {
      persisted = false;
      storageError = String(e.message || e);
    }
  }
  var graded = await estimatesPayload(est);
  graded.persisted = persisted;
  graded.storage = store.storageMode();
  graded.storageError = storageError;
  graded.writeSkipped = writeSkipped;
  return graded;
}

var CRON_SCHEDULES = ["0 4 * * *"];
var CRON_AUTH_HINT = "Set CRON_SECRET on the Vercel project and send Authorization: Bearer <CRON_SECRET>. Vercel Cron adds that header automatically.";

function cronSecret() {
  return String(process.env.CRON_SECRET || "").trim();
}

function cronAuthorized(req) {
  var secret = cronSecret();
  var header = "";
  if (req && req.headers) header = String(req.headers.authorization || "");
  if (secret && header === "Bearer " + secret) return true;
  if (auth.isAdmin(auth.readSession(req))) return true;
  if (!secret) return !process.env.VERCEL;
  return false;
}

async function runScheduledUpdate() {
  var started = new Date().toISOString();
  var body = await buildMatchups(null);
  var storageError = null;
  try {
    await store.writeJson(store.KEYS.matchups, body);
    await persistMatchups(body);
  } catch (e) {
    storageError = String(e.message || e);
  }
  matchupCache[body.currentDate || dates.etSlateDate(new Date())] = { at: Date.now(), body: body };
  var graded;
  try {
    graded = await gradeEstimates();
  } catch (e) {
    graded = {
      persisted: false,
      storage: store.storageMode(),
      storageError: String(e.message || e),
      summary: archive.summarize([])
    };
  }
  if (!storageError && graded.storageError) storageError = graded.storageError;
  var status = {
    ok: !storageError,
    ranAt: started,
    finishedAt: new Date().toISOString(),
    currentDate: body.currentDate || null,
    matchupCount: body.matchupCount || 0,
    scoreboardSeasonLabel: body.scoreboardSeasonLabel || null,
    statsSeasonLabel: body.statsSeasonLabel || null,
    summary: graded.summary || null,
    persisted: !!(graded.persisted && !storageError),
    storage: store.storageMode(),
    auth: store.blobAuthMode(),
    hint: storageError ? (store.blobHint() || storageError) : store.blobHint(),
    storageError: storageError
  };
  try {
    var liveBt = await refreshLiveBacktest({ writeStore: true });
    status.liveBacktest = liveBt;
  } catch (e) {
    status.liveBacktestError = String(e.message || e);
  }
  try {
    var scorersBody = await refreshScorers();
    status.scorers = {
      players: scorersBody.playerCount || 0,
      writeSkipped: scorersBody.writeSkipped || null
    };
  } catch (e) {
    status.scorersError = String(e.message || e);
  }
  try {
    var trendsStarted = Date.now();
    var trendsBody = await buildTeamTrends(true);
    status.trends = {
      teams: trendsBody && trendsBody.teams ? trendsBody.teams.length : 0,
      ms: Date.now() - trendsStarted
    };
  } catch (e) {
    status.trendsError = String(e.message || e);
  }
  try {
    await store.writeJson(store.KEYS.cronStatus, status);
  } catch (e) {
    status.statusWriteError = String(e.message || e);
  }
  return status;
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

var BACKTEST_SEASONS = ["20212022", "20222023", "20232024", "20242025", "20252026", "20262027"];

function backtestFile(season) {
  return "backtest-" + season + ".json";
}

function backtestPublicPath(season) {
  return path.join(ROOT, "public", "data", backtestFile(season));
}

function readBacktestFile(season) {
  try {
    return JSON.parse(fs.readFileSync(backtestPublicPath(season), "utf8"));
  } catch (e) {
    return null;
  }
}

function listBacktestSeasons() {
  var seasons = BACKTEST_SEASONS.map(function (id) {
    return { id: id, label: formatSeason(id), available: !!readBacktestFile(id) };
  });
  var ready = seasons.every(function (s) { return s.available; });
  return [{ id: "all", label: "All seasons", available: ready }].concat(seasons);
}

async function runBacktest(season) {
  season = /^\d{8}$/.test(String(season || "")) ? String(season) : "20252026";
  var teams = stats.TEAMS.map(function (t) { return t.abbrev; });
  var schedules = [];
  for (var i = 0; i < teams.length; i++) {
    schedules.push(await getJson("https://api-web.nhle.com/v1/club-schedule-season/" + teams[i] + "/" + season));
  }
  var games = backtest.collectGames(schedules);
  var mpGames = [];
  try { mpGames = await loadMoneyPuckGames(); } catch (e) { mpGames = []; }
  var out = backtest.run(games, { minGp: 5, mpGames: mpGames, season: season });
  out.generatedAt = new Date().toISOString();
  out.source = "walk-forward from NHL " + formatSeason(season) + " regular-season finals; xG/HDCF fall back to prior scoring rates";
  out.rows = out.rows.filter(function (r) { return r.graded; });
  out.seasons = listBacktestSeasons();
  return out;
}

function shiftDate(iso, days) {
  var d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sumPeriods(side) {
  side = side || {};
  return (side.p1 || 0) + (side.p2 || 0) + (side.p3 || 0) + (side.ot || 0);
}

function tallyPlayByPlay(pbp) {
  pbp = pbp || {};
  var awayId = pbp.awayTeam && pbp.awayTeam.id;
  var homeId = pbp.homeTeam && pbp.homeTeam.id;
  var away = { p1: 0, p2: 0, p3: 0, ot: 0 };
  var home = { p1: 0, p2: 0, p3: 0, ot: 0 };
  (pbp.plays || []).forEach(function (play) {
    if (!play || play.typeDescKey !== "goal") return;
    var pd = play.periodDescriptor || {};
    var type = String(pd.periodType || "").toUpperCase();
    var bucket = null;
    if (type === "REG" && Number(pd.number) === 1) bucket = "p1";
    else if (type === "REG" && Number(pd.number) === 2) bucket = "p2";
    else if (type === "REG" && Number(pd.number) === 3) bucket = "p3";
    else if (type === "OT") bucket = "ot";
    else return;
    var owner = play.details && play.details.eventOwnerTeamId;
    var side = owner === awayId ? away : owner === homeId ? home : null;
    if (side && bucket) side[bucket] += 1;
  });
  return {
    awayAbbrev: pbp.awayTeam && pbp.awayTeam.abbrev,
    homeAbbrev: pbp.homeTeam && pbp.homeTeam.abbrev,
    away: away,
    home: home
  };
}

function periodGameOk(tally, game) {
  if (!tally || !tally.awayAbbrev || !tally.homeAbbrev) return false;
  var as = Number(game.awayTeam && game.awayTeam.score);
  var hs = Number(game.homeTeam && game.homeTeam.score);
  if (!isFinite(as) || !isFinite(hs)) return false;
  var a = sumPeriods(tally.away);
  var h = sumPeriods(tally.home);
  if (a === as && h === hs) return true;
  var pt = String((game.gameOutcome && game.gameOutcome.lastPeriodType) || "").toUpperCase();
  if (pt === "SO") {
    if (as === a + 1 && hs === h) return true;
    if (hs === h + 1 && as === a) return true;
  }
  return false;
}

function finalsForPeriodGoals(schedMap) {
  var byId = Object.create(null);
  Object.keys(schedMap || {}).forEach(function (ab) {
    (schedMap[ab] || []).forEach(function (g) {
      if (!g || !g.id || Number(g.gameType) !== 2 || !isFinalState(g.gameState)) return;
      if (!g.awayTeam || !g.homeTeam) return;
      byId[String(g.id)] = g;
    });
  });
  return Object.keys(byId).sort(function (a, b) { return Number(a) - Number(b); }).map(function (id) {
    return byId[id];
  });
}

async function ensurePeriodGoals(schedMap, statsSeason) {
  var season = String(statsSeason);
  if (periodGoalMemory.season !== season) {
    periodGoalMemory = { season: season, games: {} };
    try {
      var stored = await store.readJson(store.KEYS.periodGoals, null);
      if (stored && String(stored.season) === season && stored.games && typeof stored.games === "object") {
        periodGoalMemory.games = stored.games;
      }
    } catch (e) { /* keep the empty memory cache */ }
  }
  var games = finalsForPeriodGoals(schedMap);
  var missing = games.filter(function (g) { return !periodGoalMemory.games[String(g.id)]; });
  var batch = missing.slice(0, 160);
  var added = 0;
  await mapPool(batch, 6, function (g) {
    return getJson("https://api-web.nhle.com/v1/gamecenter/" + g.id + "/play-by-play").then(function (pbp) {
      var tally = tallyPlayByPlay(pbp);
      if (!periodGameOk(tally, g)) return;
      periodGoalMemory.games[String(g.id)] = {
        id: g.id,
        awayAbbrev: tally.awayAbbrev,
        homeAbbrev: tally.homeAbbrev,
        away: tally.away,
        home: tally.home
      };
      added += 1;
    }).catch(function () {});
  });
  var byTeam = Object.create(null);
  games.forEach(function (g) {
    var saved = periodGoalMemory.games[String(g.id)];
    if (!saved) return;
    [[saved.awayAbbrev, saved.away], [saved.homeAbbrev, saved.home]].forEach(function (part) {
      var ab = part[0];
      var goals = part[1];
      if (!ab || !goals) return;
      if (!byTeam[ab]) byTeam[ab] = { p1: 0, p2: 0, p3: 0, ot: 0, games: 0 };
      byTeam[ab].p1 += goals.p1 || 0;
      byTeam[ab].p2 += goals.p2 || 0;
      byTeam[ab].p3 += goals.p3 || 0;
      byTeam[ab].ot += goals.ot || 0;
      byTeam[ab].games += 1;
    });
  });
  var have = games.filter(function (g) { return !!periodGoalMemory.games[String(g.id)]; }).length;
  var schedule = Object.create(null);
  games.forEach(function (g) {
    var away = g.awayTeam || {};
    var home = g.homeTeam || {};
    var pt = String((g.gameOutcome && g.gameOutcome.lastPeriodType) || "").toUpperCase();
    function add(ab, score, won) {
      if (!ab) return;
      if (!schedule[ab]) schedule[ab] = { gf: 0, games: 0 };
      var gf = Number(score) || 0;
      if (pt === "SO" && won) gf -= 1;
      schedule[ab].gf += gf;
      schedule[ab].games += 1;
    }
    var as = Number(away.score);
    var hs = Number(home.score);
    add(away.abbrev, as, as > hs);
    add(home.abbrev, hs, hs > as);
  });
  return {
    byTeam: byTeam,
    schedule: schedule,
    complete: games.length > 0 && have === games.length,
    expected: games.length,
    have: have,
    added: added
  };
}

function attachPeriodGoals(rows, report) {
  var mismatch = [];
  (rows || []).forEach(function (row) {
    var tot = report && report.byTeam && report.byTeam[row.abbrev];
    var sched = report && report.schedule && report.schedule[row.abbrev];
    var played = sched ? sched.games : 0;
    if (!played) {
      row.goalsP1 = 0;
      row.goalsP2 = 0;
      row.goalsP3 = 0;
      row.goalsOt = 0;
      return;
    }
    var sum = tot ? tot.p1 + tot.p2 + tot.p3 + tot.ot : null;
    var match = !!(report && report.complete && tot && sum === sched.gf && tot.games === played);
    if (report && report.complete && !match) mismatch.push(row.abbrev + " " + sum + " vs " + (sched && sched.gf));
    row.goalsP1 = match ? tot.p1 : null;
    row.goalsP2 = match ? tot.p2 : null;
    row.goalsP3 = match ? tot.p3 : null;
    row.goalsOt = match ? tot.ot : null;
  });
  var totalsMatch = !!(report && report.complete && !mismatch.length);
  if (totalsMatch || (report && report.added)) {
    var body = {
      season: periodGoalMemory.season,
      games: periodGoalMemory.games,
      totalsMatch: totalsMatch,
      checkedAt: new Date().toISOString()
    };
    if (totalsMatch) {
      store.writeJson(store.KEYS.periodGoals, body).catch(function () {});
    }
  }
  return { totalsMatch: totalsMatch, mismatch: mismatch, have: report && report.have, expected: report && report.expected };
}

function isoDay(value) {
  var s = String(value || "");
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
  return s.slice(0, 10);
}

function last5XgShare(rows, abbrev, beforeDate) {
  var cutoff = isoDay(beforeDate);
  var list = (rows || []).filter(function (r) {
    return r && r.team === abbrev && r.gameDate && (!cutoff || isoDay(r.gameDate) < cutoff);
  });
  list.sort(function (a, b) {
    return isoDay(a.gameDate).localeCompare(isoDay(b.gameDate)) || (Number(a.gameId) - Number(b.gameId));
  });
  var last = list.slice(-5);
  var f = 0;
  var a = 0;
  var n = 0;
  last.forEach(function (r) {
    var xf = r.xgf5 != null ? r.xgf5 : r.xgf;
    var xa = r.xga5 != null ? r.xga5 : r.xga;
    if (xf == null && xa == null) return;
    f += Number(xf) || 0;
    a += Number(xa) || 0;
    n += 1;
  });
  if (!n || f + a <= 0) return null;
  return Math.round((1000 * f) / (f + a)) / 10;
}

async function loadTeamXgLog(abbrev, year) {
  var key = String(year) + ":" + abbrev;
  if (Object.prototype.hasOwnProperty.call(xgLogMemory, key)) return xgLogMemory[key];
  try {
    var text = await getText(
      "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/regular/teams/" + abbrev + ".csv"
    );
    xgLogMemory[key] = backtest.parseTeamGameCsv(text, String(year));
  } catch (e) {
    xgLogMemory[key] = [];
  }
  return xgLogMemory[key];
}

var TRENDS_CACHE_VERSION = 2;
var MP_ALL_TEAMS_CSV = "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv";
var REGULAR_SEASON_GAME_ID = /^2\d{3}02\d{4}$/;
var trendsInflight = null;

function trendsCacheUsable(cache, currentSeason, previousSeason) {
  if (!cache || Number(cache.version) !== TRENDS_CACHE_VERSION) return false;
  if (String(cache.currentSeason) !== String(currentSeason)) return false;
  if (String(cache.previousSeason) !== String(previousSeason)) return false;
  if (!cache.teams) return false;
  return stats.TEAMS.every(function (t) {
    var games = cache.teams[t.abbrev] && cache.teams[t.abbrev].games;
    return games && games.length >= 40;
  });
}

function scheduleFinal(g, abbrev) {
  if (!g || Number(g.gameType) !== 2 || !isFinalState(g.gameState)) return null;
  var away = g.awayTeam || {};
  var home = g.homeTeam || {};
  var isAway = away.abbrev === abbrev;
  var isHome = home.abbrev === abbrev;
  if (!isAway && !isHome) return null;
  var ascore = Number(away.score);
  var hscore = Number(home.score);
  if (!isFinite(ascore) || !isFinite(hscore)) return null;
  var gf = isHome ? hscore : ascore;
  var ga = isHome ? ascore : hscore;
  var side = isHome ? home : away;
  return {
    id: g.id,
    date: g.gameDate,
    season: String(g.season || ""),
    gf: gf,
    win: gf > ga ? 1 : 0,
    sf: null,
    home: isHome ? 1 : 0,
    logo: side.logo || null
  };
}

async function fetchTeamShotLog(teamId, season) {
  var rows = [];
  var start = 0;
  var total = null;
  while (total == null || start < total) {
    var exp = encodeURIComponent("teamId=" + teamId + " and gameTypeId=2 and seasonId=" + season);
    var sort = encodeURIComponent("[{\"property\":\"gameDate\",\"direction\":\"ASC\"}]");
    var url = "https://api.nhle.com/stats/rest/en/team/summary?isAggregate=false&isGame=true&limit=100&start=" +
      start + "&sort=" + sort + "&cayenneExp=" + exp;
    var data = await getJson(url);
    var batch = (data && data.data) || [];
    total = Number(data && data.total);
    if (!isFinite(total)) total = rows.length + batch.length;
    rows = rows.concat(batch);
    if (!batch.length) break;
    start += batch.length;
    if (start > 400) break;
  }
  var byId = Object.create(null);
  rows.forEach(function (row) {
    if (!row || row.gameId == null || Number(row.gamesPlayed) !== 1) return;
    var shots = Number(row.shotsForPerGame);
    if (!isFinite(shots)) return;
    byId[String(row.gameId)] = Math.round(shots);
  });
  return byId;
}

function applyShotMap(games, byId) {
  (games || []).forEach(function (g) {
    if (!g || g.sf != null) return;
    var n = byId && byId[String(g.id)];
    if (n == null || !isFinite(Number(n))) return;
    g.sf = Number(n);
  });
}

async function fillMissingShots(games) {
  var missing = (games || []).filter(function (g) { return g && g.sf == null && g.id != null; });
  if (!missing.length) return;
  var map = await loadShotMap(missing.map(function (g) { return g.id; }));
  missing.forEach(function (g) {
    var shots = map[String(g.id)];
    if (!shots) return;
    var n = g.home ? shots.home : shots.away;
    if (isFinite(Number(n))) g.sf = Number(n);
  });
}

function previousComplete(games, previousSeason) {
  var rows = (games || []).filter(function (g) {
    return String(g.season) === String(previousSeason) && g.sf != null;
  });
  return rows.length >= 80;
}

async function loadTeamTrendGames(team, seasons, cachedGames) {
  var prev = String(seasons.previous);
  var curr = String(seasons.current);
  var kept = previousComplete(cachedGames, prev)
    ? cachedGames.filter(function (g) { return String(g.season) === prev; })
    : [];
  var fetchSeasons = kept.length ? [curr] : [prev, curr];
  var games = kept.slice();
  var logo = null;
  for (var i = 0; i < fetchSeasons.length; i++) {
    var season = fetchSeasons[i];
    var sched = await getJson("https://api-web.nhle.com/v1/club-schedule-season/" + team.abbrev + "/" + season);
    var finals = [];
    (sched.games || []).forEach(function (g) {
      var row = scheduleFinal(g, team.abbrev);
      if (row) finals.push(row);
    });
    var shots = {};
    try { shots = await fetchTeamShotLog(team.id, season); }
    catch (e) { shots = {}; }
    applyShotMap(finals, shots);
    finals.forEach(function (g) {
      if (g.logo && String(g.season) === curr) logo = g.logo;
      else if (g.logo && !logo) logo = g.logo;
    });
    games = games.filter(function (g) { return String(g.season) !== String(season); }).concat(finals);
  }
  await fillMissingShots(games);
  games.sort(function (a, b) {
    return String(a.date || "").localeCompare(String(b.date || "")) || (Number(a.id) - Number(b.id));
  });
  kept.forEach(function (g) { if (!logo && g.logo) logo = g.logo; });
  return { logo: logo, games: games };
}

function trendsPayloadFromCache(cache) {
  var currentSeason = cache.currentSeason;
  var previousSeason = cache.previousSeason;
  var teams = stats.TEAMS.map(function (t) {
    var saved = (cache.teams && cache.teams[t.abbrev]) || { games: [] };
    var snap = trends.snapshots(saved.games || [], currentSeason);
    var through = "";
    (saved.games || []).forEach(function (g) {
      if (String(g.season) === String(currentSeason) && g.date && String(g.date) > through) through = String(g.date);
    });
    return {
      abbrev: t.abbrev,
      name: t.name,
      logo: saved.logo || null,
      throughDate: through || null,
      current: snap.current,
      ago1: snap.ago1,
      ago5: snap.ago5,
      ago10: snap.ago10,
      ago15: snap.ago15,
      ago20: snap.ago20
    };
  });
  var through = "";
  teams.forEach(function (t) {
    if (t.throughDate && t.throughDate > through) through = t.throughDate;
  });
  return {
    generatedAt: new Date().toISOString(),
    cachedAt: cache.updatedAt || null,
    currentSeason: currentSeason,
    previousSeason: previousSeason,
    currentSeasonLabel: formatSeason(currentSeason),
    previousSeasonLabel: formatSeason(previousSeason),
    throughDate: through || null,
    definition: trends.definition(formatSeason(currentSeason), formatSeason(previousSeason)),
    teams: teams
  };
}

function csvNum(cols, index) {
  var value = Number(cols[index]);
  return isFinite(value) ? value : 0;
}

function openMoneyPuckStream(urlStr, attempt) {
  attempt = attempt || 1;
  return new Promise(function (resolve, reject) {
    var req = https.get(urlStr, {
      headers: { "User-Agent": "hockey-stats/1.9", Accept: "*/*" }
    }, function (up) {
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
        up.resume();
        var next = up.headers.location;
        if (next.indexOf("http") !== 0) {
          var base = new URL(urlStr);
          next = new URL(next, base).href;
        }
        openMoneyPuckStream(next, attempt).then(resolve, reject);
        return;
      }
      if (up.statusCode === 429 && attempt < 5) {
        up.resume();
        var wait = Number(up.headers["retry-after"]);
        if (!isFinite(wait) || wait < 1) wait = Math.min(60, 3 * attempt);
        setTimeout(function () {
          openMoneyPuckStream(urlStr, attempt + 1).then(resolve, reject);
        }, wait * 1000);
        return;
      }
      if (up.statusCode !== 200) {
        up.resume();
        reject(new Error("HTTP " + up.statusCode + " " + urlStr));
        return;
      }
      resolve(up);
    });
    req.on("error", reject);
  });
}

function streamMoneyPuckTrendIndex(years) {
  var needles = [];
  Object.keys(years).forEach(function (year) {
    if (year && year !== "NaN") needles.push("," + year + ",");
  });
  var started = Date.now();
  var startRss = process.memoryUsage().rss;
  var startHeap = process.memoryUsage().heapUsed;
  var peakRss = startRss;
  var peakHeap = startHeap;
  function noteMem() {
    var usage = process.memoryUsage();
    if (usage.rss > peakRss) peakRss = usage.rss;
    if (usage.heapUsed > peakHeap) peakHeap = usage.heapUsed;
  }
  return openMoneyPuckStream(MP_ALL_TEAMS_CSV).then(function (up) {
    return new Promise(function (resolve, reject) {
      var pending = "";
      var header = null;
      var failed = false;
      var byId = Object.create(null);
      var byDate = Object.create(null);
      var rows = 0;
      var iTeam = 0;
      var iSeason = 0;
      var iId = 0;
      var iDate = 0;
      var iSit = 0;
      var iSf = 0;
      var iSa = 0;
      var iCf = 0;
      var iCa = 0;
      var iXf = 0;
      var iXa = 0;

      function takeLine(line) {
        if (!line) return;
        if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
        if (!header) {
          header = line.split(",");
          var idx = Object.create(null);
          header.forEach(function (name, i) { idx[name] = i; });
          var required = [
            "team", "season", "gameId", "gameDate", "situation",
            "xGoalsFor", "xGoalsAgainst", "shotsOnGoalFor", "shotsOnGoalAgainst",
            "shotAttemptsFor", "shotAttemptsAgainst"
          ];
          for (var r = 0; r < required.length; r++) {
            if (idx[required[r]] == null) throw new Error("MoneyPuck all_teams.csv is missing " + required[r]);
          }
          iTeam = idx.team;
          iSeason = idx.season;
          iId = idx.gameId;
          iDate = idx.gameDate;
          iSit = idx.situation;
          iSf = idx.shotsOnGoalFor;
          iSa = idx.shotsOnGoalAgainst;
          iCf = idx.shotAttemptsFor;
          iCa = idx.shotAttemptsAgainst;
          iXf = idx.xGoalsFor;
          iXa = idx.xGoalsAgainst;
          return;
        }
        var yearHit = false;
        for (var n = 0; n < needles.length; n++) {
          if (line.indexOf(needles[n]) >= 0) { yearHit = true; break; }
        }
        if (!yearHit) return;
        if (line.indexOf(",all,") < 0 && line.indexOf(",5on5,") < 0) return;
        var cols = line.split(",");
        var season = cols[iSeason];
        if (!years[season]) return;
        var sit = cols[iSit];
        if (sit !== "all" && sit !== "5on5") return;
        var id = cols[iId];
        if (!REGULAR_SEASON_GAME_ID.test(id)) return;
        var team = cols[iTeam];
        if (!team) return;
        var key = team + ":" + id;
        var row = byId[key];
        if (!row) {
          var date = String(cols[iDate] || "");
          row = byId[key] = { date: date };
          rows += 1;
          var dateKey = team + ":" + date;
          var other = byDate[dateKey];
          if (!other) byDate[dateKey] = row;
          else if (other !== row) {
            other.dateClash = true;
            row.dateClash = true;
          }
        }
        if (sit === "all") {
          row.mSf = Math.round(csvNum(cols, iSf));
          row.mSa = Math.round(csvNum(cols, iSa));
          row.mCf = Math.round(csvNum(cols, iCf));
          row.mCa = Math.round(csvNum(cols, iCa));
        } else {
          row.x5f = Math.round(csvNum(cols, iXf) * 10000) / 10000;
          row.x5a = Math.round(csvNum(cols, iXa) * 10000) / 10000;
        }
      }

      up.on("data", function (chunk) {
        if (failed) return;
        try {
          noteMem();
          pending += chunk.toString("utf8");
          var nl = pending.indexOf("\n");
          while (nl >= 0) {
            var line = pending.slice(0, nl);
            pending = pending.slice(nl + 1);
            takeLine(line);
            nl = pending.indexOf("\n");
          }
          noteMem();
        } catch (err) {
          failed = true;
          up.destroy();
          reject(err);
        }
      });
      up.on("end", function () {
        if (failed) return;
        try {
          if (pending) takeLine(pending);
          noteMem();
          if (!header) throw new Error("MoneyPuck all_teams.csv had no header");
          resolve({
            byId: byId,
            byDate: byDate,
            rows: rows,
            ms: Date.now() - started,
            startRss: startRss,
            startHeap: startHeap,
            peakRss: peakRss,
            peakHeap: peakHeap
          });
        } catch (err) {
          reject(err);
        }
      });
      up.on("error", reject);
    });
  });
}

function trendCountRow(index, abbrev, game) {
  if (!index || !game) return null;
  var id = String(game.id == null ? "" : game.id);
  var hit = index.byId[abbrev + ":" + id];
  if (hit) return hit;
  var date = String(game.date || "").replace(/-/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(date)) return null;
  var byDate = index.byDate[abbrev + ":" + date];
  if (!byDate || byDate.dateClash) return null;
  return byDate;
}

function attachTrendCounts(games, abbrev, index) {
  (games || []).forEach(function (game) {
    if (!game) return;
    var row = trendCountRow(index, abbrev, game);
    if (row && row.mSf != null && row.mSa != null) {
      game.mSf = row.mSf;
      game.mSa = row.mSa;
    } else {
      delete game.mSf;
      delete game.mSa;
    }
    if (row && row.mCf != null && row.mCa != null) {
      game.mCf = row.mCf;
      game.mCa = row.mCa;
    } else {
      delete game.mCf;
      delete game.mCa;
    }
    if (row && row.x5f != null && row.x5a != null) {
      game.x5f = row.x5f;
      game.x5a = row.x5a;
    } else {
      delete game.x5f;
      delete game.x5a;
    }
  });
}

async function loadMoneyPuckTrendIndex(currentSeason, previousSeason) {
  var years = Object.create(null);
  years[mpSeasonYear(currentSeason)] = true;
  years[mpSeasonYear(previousSeason)] = true;
  var index = await streamMoneyPuckTrendIndex(years);
  console.log(
    "team trends MoneyPuck rows " + index.rows +
    " ms " + index.ms +
    " rssStart " + index.startRss +
    " rssPeak " + index.peakRss +
    " heapStart " + index.startHeap +
    " heapPeak " + index.peakHeap
  );
  return index;
}

async function buildTeamTrendsInner(refresh) {
  var currentSeason = String(LIVE_STATS_SEASON);
  var previousSeason = String(priorSeasonId(LIVE_STATS_SEASON));
  var cache = null;
  try { cache = await store.readJson(store.KEYS.teamTrends, null); }
  catch (e) { cache = null; }
  // A page request serves the saved cache. The 127 MB MoneyPuck file is
  // rebuilt on cron and on ?refresh=1, which each have their own 60s limit.
  if (!refresh && trendsCacheUsable(cache, currentSeason, previousSeason)) {
    return trendsPayloadFromCache(cache);
  }
  var mpPromise = loadMoneyPuckTrendIndex(currentSeason, previousSeason).catch(function (err) {
    console.error("team trends MoneyPuck fetch failed: " + (err && err.message ? err.message : err));
    return null;
  });
  var teams = Object.create(null);
  if (cache && cache.teams) {
    Object.keys(cache.teams).forEach(function (ab) { teams[ab] = cache.teams[ab]; });
  }
  await mapPool(stats.TEAMS, 4, function (team) {
    var prior = teams[team.abbrev] && teams[team.abbrev].games;
    return loadTeamTrendGames(team, { current: currentSeason, previous: previousSeason }, prior || [])
      .then(function (loaded) {
        teams[team.abbrev] = {
          logo: loaded.logo || (teams[team.abbrev] && teams[team.abbrev].logo) || null,
          games: loaded.games
        };
      })
      .catch(function () {
        if (!teams[team.abbrev]) teams[team.abbrev] = { logo: null, games: [] };
      });
  });
  var mpIndex = await mpPromise;
  if (mpIndex && mpIndex.rows > 0) {
    stats.TEAMS.forEach(function (team) {
      var saved = teams[team.abbrev];
      if (saved) attachTrendCounts(saved.games, team.abbrev, mpIndex);
    });
  }
  var next = {
    version: TRENDS_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    currentSeason: currentSeason,
    previousSeason: previousSeason,
    teams: teams
  };
  try { await store.writeJson(store.KEYS.teamTrends, next); }
  catch (e) { /* the page still returns the log it just built */ }
  return trendsPayloadFromCache(next);
}

function buildTeamTrends(refresh) {
  if (trendsInflight && !refresh) return trendsInflight;
  trendsInflight = buildTeamTrendsInner(!!refresh).then(function (body) {
    trendsInflight = null;
    return body;
  }, function (err) {
    trendsInflight = null;
    throw err;
  });
  return trendsInflight;
}

async function buildTeamStats() {
  var score = await getJson("https://api-web.nhle.com/v1/score/now");
  var standings = await getJson("https://api-web.nhle.com/v1/standings/now");
  var seasonId = seasonIdFromScore(score);
  var resolved = await resolveStatsSeason(seasonId, standings);
  var statsSeason = resolved.statsSeason;
  var summary = await getJson(
    "https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId=" +
      statsSeason + "%20and%20gameTypeId=2"
  );
  var standMap = indexStandings(standings);
  var sumMap = indexSummary(summary);
  var types = resolved.locked ? [2] : [1, 2];
  if (!resolved.locked) {
    try {
      var probe = await getJson("https://api-web.nhle.com/v1/club-schedule-season/TOR/" + statsSeason);
      if ((probe.games || []).some(function (g) {
        return Number(g.gameType) === 2 && isFinalState(g.gameState);
      })) types = [2];
    } catch (e) { /* keep preseason+regular */ }
  }
  var schedMap = Object.create(null);
  await mapPool(stats.TEAMS, 6, function (t) {
    return getJson("https://api-web.nhle.com/v1/club-schedule-season/" + t.abbrev + "/" + statsSeason)
      .then(function (sched) { schedMap[t.abbrev] = sched.games || []; })
      .catch(function () { schedMap[t.abbrev] = []; });
  });
  var shotIds = [];
  stats.TEAMS.forEach(function (t) {
    var rec = teamStats.recordFromSources(
      sameSeasonRow(standMap[t.abbrev], statsSeason),
      sameSeasonRow(sumMap[t.abbrev], statsSeason)
    );
    shotIds = shotIds.concat(shotIdsForTeam(schedMap[t.abbrev] || [], t.abbrev, {
      splits: true,
      preseasonTotals: !rec.gamesPlayed
    }));
  });
  var shotById = await loadShotMap(shotIds);
  var rows = [];
  var latest = "";
  stats.TEAMS.forEach(function (t) {
    var games = schedMap[t.abbrev] || [];
    var empty = { games: 0, w: 0, l: 0, ot: 0, gfGp: null, gaGp: null, list: [] };
    var form = games.length ? teamStats.last5Form(games, t.abbrev, { types: types }) : empty;
    var homeForm = games.length ? teamStats.last5Form(games, t.abbrev, { types: types, venue: "home" }) : empty;
    var awayForm = games.length ? teamStats.last5Form(games, t.abbrev, { types: types, venue: "away" }) : empty;
    teamStats.annotateShots(form, shotById);
    teamStats.annotateShots(homeForm, shotById);
    teamStats.annotateShots(awayForm, shotById);
    var standRow = sameSeasonRow(standMap[t.abbrev], statsSeason);
    var sumRow = sameSeasonRow(sumMap[t.abbrev], statsSeason);
    var row = teamStats.row(t, standRow, sumRow, form);
    var b2b = teamStats.b2bFromGames(games, t.abbrev);
    row.b2bWinPct = b2b.b2bWinPct;
    row.b2bRecord = b2b.b2bRecord;
    row.b2bGames = b2b.b2bGames;
    row.homeSplit = teamStats.row(t, standRow, sumRow, homeForm);
    row.awaySplit = teamStats.row(t, standRow, sumRow, awayForm);
    teamStats.applyPreseason(row, games, t.abbrev, shotById, null);
    teamStats.applyPreseason(row.homeSplit, games, t.abbrev, shotById, "home");
    teamStats.applyPreseason(row.awaySplit, games, t.abbrev, shotById, "away");
    (row.lastFive || []).forEach(function (g) {
      if (g.date && g.date > latest) latest = g.date;
    });
    rows.push(row);
  });
  rows.sort(function (a, b) { return (b.wins || 0) - (a.wins || 0); });
  var periodReport = { byTeam: {}, schedule: {}, complete: false, have: 0, expected: 0, added: 0 };
  try { periodReport = await ensurePeriodGoals(schedMap, statsSeason); } catch (e) { periodReport.error = String(e.message || e); }
  var periodCheck = attachPeriodGoals(rows, periodReport);
  var seasons = seasonMeta(seasonId, statsSeason, standingsSnapshot(standings, statsSeason).maxGp);
  if (!periodCheck.totalsMatch && periodCheck.expected) {
    var periodNote = periodCheck.mismatch && periodCheck.mismatch.length
      ? "Period goals were withheld because they did not add up to team goals."
      : "Period goals cover " + periodCheck.have + " of " + periodCheck.expected + " finals.";
    seasons.note = seasons.note ? seasons.note + " " + periodNote : periodNote;
  }
  return {
    generatedAt: new Date().toISOString(),
    seasonId: statsSeason,
    statsSeason: statsSeason,
    statsSeasonSource: resolved.source,
    statsSeasonLocked: resolved.locked,
    earlySample: seasons.earlySample,
    scoreboardSeason: seasonId,
    statsSeasonLabel: seasons.statsSeasonLabel,
    scoreboardSeasonLabel: seasons.scoreboardSeasonLabel,
    note: seasons.note,
    preseasonLabel: formatSeason(statsSeason) + " preseason",
    formTypes: types,
    throughDate: latest || null,
    periodGoals: periodCheck,
    teams: rows
  };
}

async function buildPlayerStreaks(query) {
  query = query || {};
  var explicit = !!(query.get && query.get("length"));
  var requested = explicit ? Number(query.get("length")) : 5;
  var opts = {
    length: Math.max(1, Math.min(15, requested || 5)),
    minGoals: query.get && query.get("minGoals"),
    minAssists: query.get && query.get("minAssists"),
    minPoints: query.get && query.get("minPoints"),
    minAttempts: query.get && query.get("minAttempts"),
    minSog: query.get && query.get("minSog"),
    minGoalieSv: query.get && query.get("minGoalieSv"),
    activeOnly: query.get && query.get("activeOnly") === "1",
    preferRegular: query.get && query.get("preferRegular") === "1"
  };
  var cache = await store.readJson(store.KEYS.playerGames, { rows: [], games: {} });
  if (!cache.games) cache.games = {};
  if (!cache.rows) cache.rows = [];
  var score = await getJson("https://api-web.nhle.com/v1/score/now");
  var today = score.currentDate || new Date().toISOString().slice(0, 10);
  var ids = [];
  var seen = {};
  for (var d = 0; d < 14; d++) {
    var day = shiftDate(today, -d);
    try {
      var board = d === 0 ? score : await getJson("https://api-web.nhle.com/v1/score/" + day);
      (board.games || []).forEach(function (g) {
        var st = String(g.gameState || "").toUpperCase();
        if (st !== "OFF" && st !== "FINAL" && st.indexOf("FINAL") !== 0) return;
        if (!g.id || seen[g.id]) return;
        seen[g.id] = true;
        ids.push({ id: g.id, date: g.gameDate || day });
      });
    } catch (e) { /* skip day */ }
  }
  var fetched = 0;
  var cap = process.env.VERCEL ? 12 : 40;
  for (var i = 0; i < ids.length; i++) {
    if (cache.games[String(ids[i].id)]) continue;
    if (fetched >= cap) break;
    try {
      var box = await getJson("https://api-web.nhle.com/v1/gamecenter/" + ids[i].id + "/boxscore");
      var parsed = streaks.parseBoxscore(box);
      cache.games[String(ids[i].id)] = true;
      cache.rows = cache.rows.concat(parsed);
      fetched += 1;
    } catch (e) { /* skip game */ }
  }
  if (fetched) {
    try { await store.writeJson(store.KEYS.playerGames, cache); } catch (e) { /* ignore */ }
  }
  var plan = streaks.resolveLength(cache.rows, requested, {
    explicit: explicit,
    strict: query.get && query.get("strict") === "1"
  });
  opts.length = plan.length;
  var built = streaks.buildTables(cache.rows, opts);
  built.generatedAt = new Date().toISOString();
  built.gameCount = Object.keys(cache.games).length;
  built.playerRowCount = cache.rows.length;
  built.fetchedThisCall = fetched;
  built.lengthRequested = plan.requested;
  built.earlySeason = plan.early;
  built.softened = plan.softened;
  try {
    var streakSeasonId = seasonIdFromScore(score);
    var streakStandings = null;
    try { streakStandings = await getJson("https://api-web.nhle.com/v1/standings/now"); } catch (e) { streakStandings = null; }
    var streakResolved = await resolveStatsSeason(streakSeasonId, streakStandings);
    var streakSeasons = seasonMeta(
      streakSeasonId,
      streakResolved.statsSeason,
      standingsSnapshot(streakStandings, streakResolved.statsSeason).maxGp
    );
    built.statsSeason = streakResolved.statsSeason;
    built.statsSeasonLabel = streakSeasons.statsSeasonLabel;
    built.scoreboardSeason = streakSeasonId;
    built.scoreboardSeasonLabel = streakSeasons.scoreboardSeasonLabel;
    built.seasonNote = streakSeasons.note;
    built.earlySample = streakSeasons.earlySample;
  } catch (e) { /* streaks still return without the season label */ }
  built.maxPlayerGames = plan.maxGames;
  built.emptyHint = streaks.emptyHint(plan);
  return built;
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.default) return String(value.default);
  return String(value);
}

function skaterName(row) {
  if (!row) return "Player";
  if (row.skaterFullName) return String(row.skaterFullName);
  var first = textOf(row.firstName);
  var last = textOf(row.lastName);
  var name = (first + " " + last).trim();
  return name || "Player";
}

function teamAbbrevOf(value) {
  var text = textOf(value);
  if (!text) return "";
  return text.split(",")[0].trim();
}

function statsRestUrl(gameRows, start, limit) {
  var exp = "seasonId=" + LIVE_STATS_SEASON + " and gameTypeId=2";
  if (!gameRows) exp += " and goals>=1";
  // goals alone is not unique, so offset pages skip and repeat rows.
  var sort = gameRows
    ? "[{\"property\":\"gameId\",\"direction\":\"ASC\"},{\"property\":\"playerId\",\"direction\":\"ASC\"}]"
    : "[{\"property\":\"playerId\",\"direction\":\"ASC\"}]";
  return "https://api.nhle.com/stats/rest/en/skater/summary?isAggregate=false&isGame=" +
    (gameRows ? "true" : "false") +
    "&start=" + start + "&limit=" + limit +
    "&sort=" + encodeURIComponent(sort) +
    "&cayenneExp=" + encodeURIComponent(exp);
}

function skaterRowKey(gameRows, row) {
  if (!row || row.playerId == null) return null;
  if (!gameRows) return String(row.playerId);
  if (row.gameId == null) return null;
  return String(row.playerId) + ":" + String(row.gameId);
}

async function fetchAllSkaterRows(gameRows) {
  var rows = [];
  var seen = Object.create(null);
  var start = 0;
  var total = 1;
  var limit = 500;
  while (start < total && start < 20000) {
    var body = await getJson(statsRestUrl(gameRows, start, limit));
    var data = (body && body.data) || [];
    var reported = Number(body && body.total);
    total = isFinite(reported) ? reported : start + data.length;
    data.forEach(function (row) {
      var key = skaterRowKey(gameRows, row);
      if (!key || seen[key]) return;
      seen[key] = true;
      rows.push(row);
    });
    if (!data.length) break;
    start += data.length;
  }
  return rows;
}

function sumSeq(seq) {
  var n = 0;
  for (var i = 0; i < (seq || []).length; i++) n += Number(seq[i]) || 0;
  return n;
}

function playerLogMismatches(players) {
  var out = [];
  (players || []).forEach(function (p) {
    var goalSum = sumSeq(p.goalsByGame);
    var pointSum = sumSeq(p.pointsByGame);
    var games = (p.goalsByGame || []).length;
    var pointGames = (p.pointsByGame || []).length;
    var why = [];
    if (goalSum !== Number(p.goals)) why.push("goals");
    if (pointSum !== Number(p.points)) why.push("points");
    if (games !== Number(p.gp) || pointGames !== Number(p.gp)) why.push("gp");
    if (why.length) {
      out.push({
        id: p.id,
        name: p.name,
        why: why.join(","),
        goals: p.goals,
        goalSum: goalSum,
        points: p.points,
        pointSum: pointSum,
        gp: p.gp,
        games: games
      });
    }
  });
  return out;
}

function scorersBodyOk(body) {
  if (!body || body.error || !Array.isArray(body.players) || !body.players.length) return false;
  if (body.totalsMatch === false) return false;
  return playerLogMismatches(body.players).length === 0;
}

var SCORERS_TTL_MS = 6 * 60 * 60 * 1000;
var scorersMem = { at: 0, body: null };

function scorersSignature(body) {
  return (body && body.players || []).map(function (p) {
    return p.id + ":" + p.goals + ":" + p.points + ":" + p.gp + ":" + (p.goalsByGame || []).join(",");
  }).join("|");
}

async function buildScorers() {
  var summary = await fetchAllSkaterRows(false);
  var games = await fetchAllSkaterRows(true);
  var leaders = await getJson(
    "https://api-web.nhle.com/v1/skater-stats-leaders/" + LIVE_STATS_SEASON + "/2?categories=goals,points&limit=40"
  );
  var byPlayer = Object.create(null);
  games.forEach(function (g) {
    var id = g.playerId;
    if (id == null) return;
    if (!byPlayer[id]) byPlayer[id] = [];
    byPlayer[id].push(g);
  });
  Object.keys(byPlayer).forEach(function (id) {
    byPlayer[id].sort(function (a, b) {
      var da = String(a.gameDate || "");
      var db = String(b.gameDate || "");
      if (da < db) return -1;
      if (da > db) return 1;
      return (Number(a.gameId) || 0) - (Number(b.gameId) || 0);
    });
  });
  var leaderGoals = Object.create(null);
  var leaderPoints = Object.create(null);
  ((leaders && leaders.goals) || []).forEach(function (r) { leaderGoals[r.id] = Number(r.value); });
  ((leaders && leaders.points) || []).forEach(function (r) { leaderPoints[r.id] = Number(r.value); });
  function sequencesFor(id) {
    var log = byPlayer[id] || [];
    var goalSeq = [];
    var pointSeq = [];
    var seenGame = Object.create(null);
    log.forEach(function (g) {
      var gid = String(g.gameId || g.gameDate || goalSeq.length);
      if (seenGame[gid]) return;
      seenGame[gid] = true;
      var gGoals = Number(g.goals) || 0;
      var gAssists = Number(g.assists) || 0;
      goalSeq.push(gGoals);
      pointSeq.push(gGoals + gAssists);
    });
    return { goalSeq: goalSeq, pointSeq: pointSeq };
  }
  var players = [];
  var mismatches = [];
  summary.forEach(function (s) {
    var goals = Number(s.goals) || 0;
    if (goals < 1) return;
    var id = s.playerId;
    var seq = sequencesFor(id);
    var goalSeq = seq.goalSeq;
    var pointSeq = seq.pointSeq;
    var gp = Number(s.gamesPlayed) || 0;
    var assists = Number(s.assists) || 0;
    var points = Number(s.points);
    if (!isFinite(points)) points = goals + assists;
    var name = skaterName(s);
    if (leaderGoals[id] != null && leaderGoals[id] !== goals) {
      mismatches.push({ id: id, name: name, stat: "goals", summary: goals, leader: leaderGoals[id] });
    }
    if (leaderPoints[id] != null && leaderPoints[id] !== points) {
      mismatches.push({ id: id, name: name, stat: "points", summary: points, leader: leaderPoints[id] });
    }
    var gpg = gp ? Math.round((goals / gp) * 100) / 100 : 0;
    players.push({
      id: id,
      name: name,
      team: teamAbbrevOf(s.teamAbbrevs || s.teamAbbrev),
      gp: gp,
      goals: goals,
      assists: assists,
      points: points,
      gpg: gpg,
      goalsByGame: goalSeq,
      pointsByGame: pointSeq
    });
  });
  ((leaders && leaders.goals) || []).forEach(function (r) {
    var found = false;
    for (var i = 0; i < players.length; i++) {
      if (Number(players[i].id) === Number(r.id)) { found = true; break; }
    }
    if (!found) mismatches.push({ id: r.id, name: skaterName(r), stat: "goals", summary: null, leader: Number(r.value) });
  });
  var have = Object.create(null);
  players.forEach(function (p) { have[String(p.id)] = true; });
  ((leaders && leaders.points) || []).forEach(function (r) {
    if (r == null || r.id == null || have[String(r.id)]) return;
    var seq = sequencesFor(r.id);
    var goals = 0;
    var logPoints = 0;
    for (var i = 0; i < seq.goalSeq.length; i++) goals += seq.goalSeq[i];
    for (var j = 0; j < seq.pointSeq.length; j++) logPoints += seq.pointSeq[j];
    var points = Number(r.value);
    if (!isFinite(points)) points = logPoints;
    if (points < 1 && goals < 1) return;
    var gp = seq.goalSeq.length;
    var name = skaterName(r);
    if (seq.pointSeq.length && logPoints !== points) {
      mismatches.push({ id: r.id, name: name, stat: "points", summary: logPoints, leader: points });
    }
    players.push({
      id: r.id,
      name: name,
      team: teamAbbrevOf(r.teamAbbrev),
      gp: gp,
      goals: goals,
      assists: Math.max(0, points - goals),
      points: points,
      gpg: gp ? Math.round((goals / gp) * 100) / 100 : 0,
      goalsByGame: seq.goalSeq,
      pointsByGame: seq.pointSeq
    });
    have[String(r.id)] = true;
  });
  players.sort(function (a, b) {
    if (b.goals !== a.goals) return b.goals - a.goals;
    if (b.gpg !== a.gpg) return b.gpg - a.gpg;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  var maxGames = 0;
  var goalScorers = 0;
  players.forEach(function (p) {
    if ((Number(p.goals) || 0) < 1) return;
    goalScorers += 1;
    if (p.gp > maxGames) maxGames = p.gp;
    if (p.goalsByGame.length > maxGames) maxGames = p.goalsByGame.length;
  });
  var logMismatches = playerLogMismatches(players);
  var totalsMatch = logMismatches.length === 0 && goalScorers > 0;
  if (!totalsMatch) {
    console.error("scorers log mismatch", logMismatches.length, logMismatches.slice(0, 8).map(function (m) {
      return m.name + " " + m.why + " G" + m.goalSum + "/" + m.goals + " P" + m.pointSum + "/" + m.points + " GP" + m.games + "/" + m.gp;
    }).join("; "));
  }
  return {
    ok: totalsMatch,
    season: LIVE_STATS_SEASON,
    seasonLabel: formatSeason(LIVE_STATS_SEASON),
    generatedAt: new Date().toISOString(),
    maxGames: maxGames,
    playerCount: goalScorers,
    gameRows: games.length,
    totalsMatch: totalsMatch,
    mismatchCount: logMismatches.length,
    totalsMatchLeaders: mismatches.length === 0,
    leaderMismatches: mismatches.slice(0, 12),
    players: totalsMatch ? players : []
  };
}

async function buildScorersChecked() {
  var last = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(400);
    last = await buildScorers();
    if (last && last.totalsMatch) return last;
  }
  return last || {
    ok: false,
    error: "Scorer game logs do not add up to season totals",
    totalsMatch: false,
    mismatchCount: 0,
    players: []
  };
}

function scorersMismatchError(body) {
  return {
    ok: false,
    error: "Scorer game logs do not add up to season totals",
    totalsMatch: false,
    mismatchCount: body && body.mismatchCount || 0,
    players: []
  };
}

async function readGoodScorersBlob() {
  try {
    var stored = await store.readJsonResult(store.KEYS.scorers, null);
    if (!stored || (stored.source !== "blob" && stored.source !== "local") || !stored.value) return null;
    if (!scorersBodyOk(stored.value)) return null;
    if (stored.value.totalsMatch !== true) {
      return Object.assign({}, stored.value, { ok: true, totalsMatch: true, mismatchCount: 0 });
    }
    return stored.value;
  } catch (e) {
    return null;
  }
}

async function scorersPayload() {
  if (scorersMem.body && scorersBodyOk(scorersMem.body) && Date.now() - scorersMem.at < SCORERS_TTL_MS) {
    return scorersMem.body;
  }
  var stored = await readGoodScorersBlob();
  if (stored && stored.generatedAt) {
    var age = Date.now() - Date.parse(stored.generatedAt);
    if (isFinite(age) && age >= 0 && age < SCORERS_TTL_MS) {
      scorersMem = { at: Date.now(), body: stored };
      return stored;
    }
  }
  var body = await buildScorersChecked();
  if (!body || !body.totalsMatch || !scorersBodyOk(body)) {
    if (scorersMem.body && scorersBodyOk(scorersMem.body)) return scorersMem.body;
    if (stored && scorersBodyOk(stored)) {
      scorersMem = { at: Date.now(), body: stored };
      return stored;
    }
    return scorersMismatchError(body);
  }
  scorersMem = { at: Date.now(), body: body };
  return body;
}

async function refreshScorers() {
  var body = await buildScorersChecked();
  if (!body || !body.totalsMatch || !scorersBodyOk(body)) {
    if (scorersMem.body && scorersBodyOk(scorersMem.body)) {
      return Object.assign({ writeSkipped: "mismatch" }, scorersMem.body);
    }
    var kept = await readGoodScorersBlob();
    if (kept) return Object.assign({ writeSkipped: "mismatch" }, kept);
    var err = new Error("Scorer game logs do not add up to season totals");
    err.mismatchCount = body && body.mismatchCount || 0;
    throw err;
  }
  scorersMem = { at: Date.now(), body: body };
  var prev = null;
  try { prev = await store.readJsonResult(store.KEYS.scorers, null); } catch (e) { prev = null; }
  var canSkip = prev && (prev.source === "blob" || prev.source === "local") &&
    prev.value && scorersBodyOk(prev.value) && scorersSignature(prev.value) === scorersSignature(body);
  if (canSkip) return Object.assign({ writeSkipped: "unchanged" }, prev.value);
  await store.writeJson(store.KEYS.scorers, body);
  return body;
}

function liveBacktestLimits() {
  return [
    "Regular-season finals for 2026-27. Older seasons stay in their own files. A row with a final score is graded. Both clubs still need five prior games before the sample matches the fitted backtest; earlier finals stay in the file and are marked as a short sample.",
    "Shots, expected goals, Corsi (shot attempts), high-danger shots, and special-teams expected goals come from MoneyPuck game logs. A row with no MoneyPuck line leaves those blank.",
    "Special-teams expected goals are 5-on-4 expected goals for minus 4-on-5 expected goals against.",
    "No historical moneylines are stored. Favorite means the club with the higher points percentage before the game.",
    "Arizona is ARI through 2023-24. Utah is UTA from 2024-25.",
    "Starting goalies were tested from NHL boxscore starters (prior save percentage, at least 3 starts and 30 shots). The factor did not beat the current score model, so it is not applied and rows do not store goalie save percentage. There is no live projected-starter feed. Injuries are not included."
  ];
}

async function fetchSeasonFinals(season) {
  var teams = stats.TEAMS.map(function (t) { return t.abbrev; });
  var schedules = await mapPoolValues(teams, 6, function (ab) {
    return getJson("https://api-web.nhle.com/v1/club-schedule-season/" + ab + "/" + season).catch(function () {
      return { games: [] };
    });
  });
  var games = backtest.collectGames(schedules);
  games.forEach(function (g) { g.season = String(season); });
  return games;
}

async function loadMoneyPuckYear(year) {
  var teams = stats.TEAMS.map(function (t) { return t.abbrev; });
  var all = [];
  var sawRows = false;
  for (var i = 0; i < teams.length; i++) {
    var text;
    try {
      text = await getText(
        "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/regular/teams/" + teams[i] + ".csv"
      );
    } catch (e) {
      if (String(e.message || e).indexOf("429") !== -1) break;
      if (!sawRows) continue;
      continue;
    }
    var rows = backtest.parseTeamGameCsv(text, String(year));
    if (!sawRows && !rows.length) return [];
    sawRows = true;
    all = all.concat(rows);
    if (i < teams.length - 1) await sleep(200);
  }
  return all;
}

function packLiveBacktest(season, rows, generatedAt) {
  var list = rows || [];
  return {
    season: String(season),
    generatedAt: generatedAt,
    source: "Walk-forward NHL club-schedule-season finals plus MoneyPuck team game logs when a line exists.",
    favoriteMethod: "points-percentage",
    favoriteLabel: "Higher points percentage before the game. Not a betting line.",
    modelNote: "Score model constants are the 1.6 formula. No replay change beat winner accuracy by 0.5 points and both errors by 0.02 goals.",
    limits: liveBacktestLimits(),
    summary: archive.summarize(list),
    rows: list
  };
}

function backtestSignature(rows) {
  return (rows || []).map(function (r) {
    return [
      r.id, r.projectedLabel, r.actualLabel, r.awayPdo, r.homePdo,
      r.awayXgf5, r.homeXgf5, r.awayLast5, r.homeLast5, r.graded ? 1 : 0,
      r.awayPtsPct == null ? "" : r.awayPtsPct,
      r.openingAwayMl == null ? "" : r.openingAwayMl
    ].join(":");
  }).join("|");
}

async function readServedBacktest(season) {
  if (String(season) === LIVE_BACKTEST_SEASON) {
    try {
      var stored = await store.readJsonResult(store.KEYS.liveBacktest, null);
      if (stored && stored.source === "blob" && stored.value && Array.isArray(stored.value.rows)) {
        return stored.value;
      }
    } catch (e) { /* public file */ }
  }
  return readBacktestFile(season);
}

async function refreshLiveBacktest(opts) {
  opts = opts || {};
  var season = LIVE_BACKTEST_SEASON;
  var games = await fetchSeasonFinals(season);
  var mpGames = [];
  try { mpGames = await loadMoneyPuckYear(String(season).slice(0, 4)); } catch (e) { mpGames = []; }
  var out = backtest.run(games, { minGp: 5, mpGames: mpGames, season: season });
  var oddsStore = { byId: {} };
  try { oddsStore = await store.readJson(store.KEYS.odds, { byId: {} }); } catch (e) { oddsStore = { byId: {} }; }
  var prev = null;
  if (opts.writeStore) {
    try {
      var storedPrev = await store.readJsonResult(store.KEYS.liveBacktest, null);
      if (storedPrev && storedPrev.source === "blob" && storedPrev.value && Array.isArray(storedPrev.value.rows)) {
        prev = storedPrev.value;
      }
    } catch (e) { prev = null; }
  } else {
    prev = readBacktestFile(season);
  }
  var generatedAt = new Date().toISOString();
  var prevById = Object.create(null);
  ((prev && prev.rows) || []).forEach(function (r) { prevById[String(r.id)] = r; });
  (out.rows || []).forEach(function (r) {
    var earlier = prevById[String(r.id)];
    if (earlier && earlier.openingAwayMl != null) {
      r.openingAwayMl = earlier.openingAwayMl;
      r.openingHomeMl = earlier.openingHomeMl;
      r.openingTotal = earlier.openingTotal != null ? earlier.openingTotal : null;
      return;
    }
    var saved = oddsStore.byId && oddsStore.byId[String(r.id)];
    var lines = saved ? archive.oddsLines(saved) : null;
    if (lines && lines.awayMl != null && lines.homeMl != null) {
      r.openingAwayMl = lines.awayMl;
      r.openingHomeMl = lines.homeMl;
      r.openingTotal = lines.total;
    }
  });
  var body = packLiveBacktest(season, out.rows, generatedAt);
  var changed = !prev || backtestSignature(prev.rows) !== backtestSignature(body.rows);
  if (!changed && prev && prev.generatedAt) body.generatedAt = prev.generatedAt;
  var appended = 0;
  if (changed) {
    var prevIds = Object.create(null);
    ((prev && prev.rows) || []).forEach(function (r) { prevIds[String(r.id)] = true; });
    body.rows.forEach(function (r) { if (!prevIds[String(r.id)]) appended += 1; });
  }
  if (opts.writePublic) {
    fs.writeFileSync(backtestPublicPath(season), JSON.stringify(body));
  }
  if (opts.writeStore && changed) {
    await store.writeJson(store.KEYS.liveBacktest, body);
  }
  return {
    ok: true,
    season: season,
    finals: games.length,
    rows: body.rows.length,
    changed: changed,
    appended: appended,
    mp: mpGames.length
  };
}

function detectRoute(req, url) {
  var p = (url && url.pathname ? url.pathname : "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (/\.(html|css|js|json|svg|png|ico|map)$/i.test(p)) return p;
  var headers = req.headers || {};
  var parts = [
    req.url,
    p,
    headers["x-invoke-path"],
    headers["x-vercel-original-path"],
    headers["x-forwarded-uri"],
    headers["x-matched-path"]
  ];
  var blob = parts.filter(Boolean).map(function (part) {
    var text = String(part);
    var q = text.indexOf("?");
    return (q >= 0 ? text.slice(0, q) : text);
  }).join(" ").toLowerCase();
  var authPath = blob.match(/\/api\/auth\/(login|logout|me|callback\/google)/);
  if (authPath) return "/api/auth/" + authPath[1];
  if (blob.indexOf("/api/prefs") !== -1 || /(^|\s)api\/prefs/.test(blob)) return "/api/prefs";
  if (/\.(html|css|js|json|svg|png|ico)(\s|$|\?)/i.test(blob) && blob.indexOf("/api/") === -1) return p;
  var fromApi = blob.indexOf("/api/") !== -1 || /(^|\s)api\//.test(blob);
  if (!fromApi) return p;
  if (blob.indexOf("/api/scorers") !== -1 || blob.indexOf("api/scorers") !== -1) return "/api/scorers";
  if (blob.indexOf("/api/scores") !== -1 || blob.indexOf("api/scores") !== -1) return "/api/scores";
  if (blob.indexOf("cron") !== -1) return "/api/cron";
  if (blob.indexOf("grade") !== -1) return "/api/estimates/grade";
  if (blob.indexOf("seed") !== -1) return "/api/seed";
  if (blob.indexOf("version") !== -1) return "/api/version";
  if (blob.indexOf("health") !== -1) return "/api/health";
  if (blob.indexOf("matchup") !== -1) return "/api/matchups";
  if (blob.indexOf("backtest") !== -1) return "/api/backtest";
  if (blob.indexOf("streak") !== -1) return "/api/streaks";
  if (blob.indexOf("trend") !== -1) return "/api/trends";
  if (blob.indexOf("/teams") !== -1 || blob.indexOf("api/teams") !== -1) return "/api/teams";
  if (blob.indexOf("estimate") !== -1) return "/api/estimates";
  return p;
}

function handleApi(req, res, url) {
  var pathname = detectRoute(req, url);
  if (pathname === "/api/auth/login" && req.method === "GET") {
    if (!auth.enabled()) {
      sendJson(res, 404, { ok: false, error: "sign-in is not configured" });
      return true;
    }
    var issued = auth.issueState(url.searchParams.get("next"));
    redirect(res, 302, auth.loginLocation(req, issued.nonce), [issued.cookie]);
    return true;
  }
  if (pathname === "/api/auth/logout" && (req.method === "GET" || req.method === "POST")) {
    redirect(res, 302, auth.safeNext(url.searchParams.get("next")), auth.clearCookies());
    return true;
  }
  if (pathname === "/api/auth/me" && req.method === "GET") {
    if (!auth.enabled()) {
      sendJson(res, 200, { enabled: false, user: null, admin: false });
      return true;
    }
    var me = auth.readSession(req);
    sendJson(res, 200, {
      enabled: true,
      user: me ? { name: me.name } : null,
      admin: auth.isAdmin(me)
    });
    return true;
  }
  if (pathname === "/api/auth/callback/google" && req.method === "GET") {
    if (!auth.enabled()) {
      redirect(res, 302, "/", []);
      return true;
    }
    var saved = auth.readState(req);
    var code = url.searchParams.get("code");
    var state = url.searchParams.get("state");
    if (!saved || !code || !state || state !== saved.s) {
      redirect(res, 302, "/?auth=failed", auth.clearCookies());
      return true;
    }
    var form = new URLSearchParams();
    form.set("code", code);
    form.set("client_id", String(process.env.GOOGLE_CLIENT_ID).trim());
    form.set("client_secret", String(process.env.GOOGLE_CLIENT_SECRET).trim());
    form.set("redirect_uri", auth.redirectUri(req));
    form.set("grant_type", "authorization_code");
    httpsRequest("POST", "https://oauth2.googleapis.com/token", {
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    }).then(function (token) {
      if (!token || !token.access_token) throw new Error("no token");
      return httpsRequest("GET", "https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + token.access_token }
      });
    }).then(function (profile) {
      var email = profile && profile.email ? String(profile.email).trim().toLowerCase() : "";
      if (!email || profile.email_verified !== true) {
        redirect(res, 302, "/?auth=unverified", auth.clearCookies());
        return;
      }
      var name = String(profile.name || email.split("@")[0] || "Signed in").slice(0, 80);
      redirect(res, 302, saved.n || "/", [
        auth.sessionCookie({ email: email, name: name, verified: true }),
        auth.clearCookies()[1]
      ]);
    }).catch(function () {
      redirect(res, 302, "/?auth=failed", auth.clearCookies());
    });
    return true;
  }
  if (pathname === "/api/prefs" && req.method === "GET") {
    var reader = auth.readSession(req);
    if (!reader) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return true;
    }
    store.readJson(prefsName(reader), {}).then(function (prefs) {
      sendJson(res, 200, { ok: true, prefs: cleanPrefs(prefs) || {} });
    }).catch(function (err) {
      sendJson(res, 502, { ok: false, error: String(err.message || err) });
    });
    return true;
  }
  if (pathname === "/api/prefs" && req.method === "POST") {
    var writer = auth.readSession(req);
    if (!writer) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return true;
    }
    readBody(req, 80000).then(function (text) {
      var incoming = cleanPrefs(JSON.parse(text || "{}"));
      if (!incoming) throw new Error("preferences are too large");
      var name = prefsName(writer);
      return store.readJson(name, {}).then(function (prev) {
        var merged = Object.assign({}, cleanPrefs(prev) || {}, incoming);
        return store.writeJson(name, merged).then(function () {
          sendJson(res, 200, { ok: true, prefs: merged });
        });
      });
    }).catch(function (err) {
      sendJson(res, 400, { ok: false, error: String(err.message || err) });
    });
    return true;
  }
  if (pathname === "/api/seed" && (req.method === "POST" || req.method === "GET")) {
    if (!requireAdmin(req, res)) return true;
    var names = [store.KEYS.estimates, store.KEYS.backtest, store.KEYS.mpGames, store.KEYS.playerGames, store.KEYS.matchups, store.KEYS.matchupArchive];
    Promise.all(names.map(function (n) {
      var local = store.readLocal(n, null);
      if (local == null) return Promise.resolve({ name: n, skipped: true });
      return store.writeJson(n, local).then(function () { return { name: n, ok: true }; });
    })).then(function (result) {
      sendJson(res, 200, { ok: true, blob: store.usesBlob(), result: result, lastWrite: store.lastWrite() });
    }).catch(function (err) {
      sendJson(res, 502, { ok: false, error: String(err.message || err) });
    });
    return true;
  }
  if (pathname === "/api/cron" && (req.method === "GET" || req.method === "POST")) {
    if (!cronAuthorized(req)) {
      sendJson(res, 401, {
        ok: false,
        error: "unauthorized",
        hint: CRON_AUTH_HINT
      });
      return true;
    }
    runScheduledUpdate().then(function (status) {
      sendJson(res, status.ok ? 200 : 502, status);
    }).catch(function (err) {
      sendJson(res, 502, { ok: false, error: String(err.message || err) });
    });
    return true;
  }
  if (pathname === "/api/version") {
    sendJson(res, 200, { version: productVersion(), service: "hockey-stats" });
    return true;
  }
  if (pathname === "/api/health") {
    var lw = store.lastWrite ? store.lastWrite() : {};
    Promise.all([
      store.listStored(),
      store.readJson(store.KEYS.cronStatus, null),
      store.writeTest()
    ]).then(function (pair) {
      var writeTest = pair[2];
      var hint = store.blobHint();
      if (writeTest && writeTest.ok === false && writeTest.error) {
        var fail = "Blob write test failed (" + writeTest.mode + "): " + writeTest.error;
        hint = hint ? hint + " " + fail : fail;
      }
      if (process.env.VERCEL && !cronSecret()) {
        hint = hint ? hint + " " + CRON_AUTH_HINT : CRON_AUTH_HINT;
      }
      sendJson(res, 200, {
        ok: true,
        service: "hockey-stats",
        version: productVersion(),
        port: PORT,
        blob: store.usesBlob(),
        storage: store.storageMode(),
        auth: store.blobAuthMode(),
        writeTest: writeTest,
        blobWriteAt: lw.at || null,
        blobWriteName: lw.name || null,
        blobWriteError: lw.error || null,
        hint: hint,
        cronSecret: !!cronSecret(),
        cronSchedulesUTC: CRON_SCHEDULES,
        cron: pair[1],
        files: pair[0]
      });
    }).catch(function (err) {
      sendJson(res, 200, {
        ok: true,
        service: "hockey-stats",
        version: productVersion(),
        port: PORT,
        blob: store.usesBlob(),
        storage: store.storageMode(),
        auth: store.blobAuthMode(),
        writeTest: { ok: false, skipped: false, error: String(err.message || err), at: null, mode: store.blobAuthMode() },
        hint: store.blobHint() || String(err.message || err),
        cronSecret: !!cronSecret(),
        cronSchedulesUTC: CRON_SCHEDULES
      });
    });
    return true;
  }
  if (pathname === "/api/scorers" && req.method === "GET") {
    scorersPayload()
      .then(function (body) {
        if (!body || body.totalsMatch !== true) {
          sendJson(res, 502, scorersMismatchError(body));
          return;
        }
        sendJson(res, 200, body);
      })
      .catch(function (err) {
        sendJson(res, 502, {
          ok: false,
          error: String(err.message || err),
          totalsMatch: false,
          mismatchCount: 0,
          players: []
        });
      });
    return true;
  }
  if (pathname === "/api/scores") {
    var scoreDate = cleanDate(url.searchParams.get("date")) || dates.etSlateDate(new Date());
    loadScoreboard(scoreDate)
      .then(function (packed) { sendJson(res, 200, scorePayload(packed)); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), games: [] });
      });
    return true;
  }
  if (pathname === "/api/matchups") {
    var explicitDate = cleanDate(url.searchParams.get("date"));
    var boardDate = explicitDate || dates.etSlateDate(new Date());
    var cacheKey = boardDate;
    var hit = matchupCache[cacheKey];
    function sendBoard(body, persist) {
      var chain = persist
        ? persistMatchups(body).catch(function (err) {
          body.storageError = String(err.message || err);
          body.storage = store.storageMode();
        })
        : Promise.resolve();
      chain.then(function () {
        return overlayScores(body, boardDate);
      }).then(function () {
        return attachHistory(body);
      }).then(function () {
        sendJson(res, 200, body);
      }).catch(function (err) {
        body.scoreError = String(err.message || err);
        sendJson(res, 200, body);
      });
    }
    if (hit && hit.body && Date.now() - hit.at < CACHE_MS && url.searchParams.get("refresh") !== "1") {
        sendBoard(hit.body, false);
      return true;
    }
    buildMatchups(boardDate)
      .then(function (body) {
        matchupCache[cacheKey] = { at: Date.now(), body: body };
        sendBoard(body, !explicitDate);
      })
      .catch(function (err) {
        store.readJson(store.KEYS.matchups, null).then(function (fallback) {
          if (fallback && !explicitDate) {
            fallback.stale = true;
            fallback.error = String(err.message || err);
            sendBoard(fallback, false);
            return;
          }
          sendJson(res, 502, { error: String(err.message || err), matchups: [] });
        });
      });
    return true;
  }
  if (pathname === "/api/trends" && req.method === "GET") {
    buildTeamTrends(url.searchParams.get("refresh") === "1")
      .then(function (body) { sendJson(res, 200, body); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), teams: [] });
      });
    return true;
  }
  if (pathname === "/api/teams") {
    buildTeamStats()
      .then(function (body) { sendJson(res, 200, body); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), teams: [] });
      });
    return true;
  }
  if (pathname === "/api/streaks") {
    buildPlayerStreaks(url.searchParams)
      .then(function (body) { sendJson(res, 200, body); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), tables: {} });
      });
    return true;
  }
  if (pathname === "/api/backtest") {
    var btSeason = String(url.searchParams.get("season") || "20252026");
    var seasons = listBacktestSeasons();
    if (btSeason === "all") {
      sendJson(res, 200, {
        season: "all",
        seasons: seasons,
        rows: [],
        summary: archive.summarize([]),
        message: "All seasons load from /data/backtest-SEASON.json, one file at a time."
      });
      return true;
    }
    if (!/^\d{8}$/.test(btSeason)) btSeason = "20252026";
    if (btSeason === LIVE_BACKTEST_SEASON) {
      readServedBacktest(btSeason).then(function (cached) {
        if (cached && Array.isArray(cached.rows)) {
          sendJson(res, 200, Object.assign({}, cached, {
            seasons: seasons,
            season: cached.season || btSeason
          }));
          return;
        }
        sendJson(res, 200, {
          season: btSeason,
          seasons: seasons,
          rows: [],
          summary: archive.summarize([]),
          unavailable: true,
          message: "No cached backtest for " + formatSeason(btSeason) + " yet."
        });
      }).catch(function () {
        sendJson(res, 200, {
          season: btSeason,
          seasons: seasons,
          rows: [],
          summary: archive.summarize([]),
          unavailable: true,
          message: "No cached backtest for " + formatSeason(btSeason) + " yet."
        });
      });
      return true;
    }
    var cached = readBacktestFile(btSeason);
    if (cached) {
      cached.seasons = seasons;
      cached.season = cached.season || btSeason;
      sendJson(res, 200, cached);
      return true;
    }
    sendJson(res, 200, {
      season: btSeason,
      seasons: seasons,
      rows: [],
      summary: archive.summarize([]),
      unavailable: true,
      message: "No cached backtest for " + formatSeason(btSeason) + " yet."
    });
    return true;
  }
  if (pathname === "/api/download") {
    downloadPayload()
      .then(function (body) { sendJson(res, 200, body); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), rows: [] });
      });
    return true;
  }
  if (pathname === "/api/estimates") {
    var gradeOnRead = url.searchParams.get("grade") === "1";
    var loadEstimatesView = gradeOnRead
      ? gradeEstimates().catch(function () { return estimatesPayload(); })
      : estimatesPayload();
    loadEstimatesView.then(function (body) { sendJson(res, 200, body); });
    return true;
  }
  if (pathname === "/api/estimates/grade" && (req.method === "POST" || req.method === "GET")) {
    if (!requireAdmin(req, res)) return true;
    gradeEstimates()
      .then(function (body) { sendJson(res, 200, body); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), estimates: [], summary: archive.summarize([]) });
      });
    return true;
  }
  return false;
}

function filled(primary, fallback) {
  if (primary != null && primary !== "") return primary;
  if (fallback != null && fallback !== "") return fallback;
  return null;
}

function inDownloadSeason(row) {
  if (!row) return false;
  var season = row.seasonId != null ? row.seasonId : row.season;
  if (String(season) === LIVE_BACKTEST_SEASON) return true;
  var day = String(row.gameDate || "");
  return day >= "2026-09-01" && day < "2027-07-01";
}

function splitWhen(gameDate, startTimeUTC) {
  var date = dates.formatTableDate(gameDate);
  var time = "";
  if (startTimeUTC) {
    var full = String(dates.formatTableDate(startTimeUTC));
    var m = full.match(/\s(\d{2}:\d{2}\s+\S+)$/);
    if (m) time = m[1];
  }
  return { date: date === "—" ? "" : date, time: time };
}

function btSide(row, side) {
  if (!row) return {};
  var p = side === "away" ? "away" : "home";
  return {
    pdo: row[p + "Pdo"],
    last5AvgGd: row[p + "Last5"],
    last5SvPct: row[p + "Last5Sv"],
    sogShare: row[p + "Sog"],
    gfMinusXg: row[p + "XgDiff"],
    cfPct: row[p + "Cf"],
    hdcfPct: row[p + "Hdcf"],
    xgfPct5v5: row[p + "Xgf5"],
    stXg: row[p + "StXg"],
    last5XgfPct: row[p + "Last5Xgf"],
    b2b: !!row[p + "B2B"],
    ptsPct: row[p + "PtsPct"],
    goalDiff: row[p + "Gd"],
    restDays: row[p + "Rest"]
  };
}

function downloadProfile(abbrev, pills, snap) {
  pills = pills || {};
  snap = snap || {};
  var meta = stats.teamByAbbrev(abbrev) || {};
  return {
    abbrev: abbrev,
    name: meta.name || abbrev,
    record: pills.record || null,
    pdo: filled(snap.pdo, pills.pdo),
    last5AvgGd: filled(snap.last5AvgGd, pills.last5AvgGd),
    last5SvPct: filled(snap.last5SvPct, pills.last5SvPct),
    sogShare: filled(snap.sogShare, pills.sogShare),
    gfMinusXg: filled(snap.gfMinusXg, pills.gfMinusXg),
    cfPct: filled(snap.cfPct, pills.cfPct),
    hdcfPct: filled(snap.hdcfPct, pills.hdcfPct),
    xgfPct5v5: filled(snap.xgfPct5v5, pills.xgfPct5v5),
    stXg: filled(snap.stXg, pills.stXg),
    last5XgfPct: filled(snap.last5XgfPct, pills.last5XgfPct),
    b2b: !!(snap.b2b || pills.restDays === 1),
    ptsPct: filled(snap.ptsPct, pills.ptsPct),
    goalDiff: filled(snap.goalDiff, pills.goalDiff),
    restDays: filled(snap.restDays, pills.restDays)
  };
}

function scorePair(awayAbbrev, homeAbbrev, awayGoals, homeGoals) {
  if (awayGoals == null || homeGoals == null) return "";
  return awayAbbrev + " " + awayGoals + " – " + homeGoals + " " + homeAbbrev;
}

function oddsText(odds, awayAbbrev, homeAbbrev) {
  if (!odds || (odds.awayMl == null && odds.homeMl == null && odds.total == null)) return "";
  var bits = [];
  if (odds.awayMl != null || odds.homeMl != null) {
    bits.push("Moneyline " + awayAbbrev + " " + stats.formatAmerican(odds.awayMl) +
      " · " + homeAbbrev + " " + stats.formatAmerican(odds.homeMl));
  }
  if (odds.total != null) bits.push("Over/under " + odds.total);
  if (odds.partner) bits.push(odds.partner);
  return bits.join(" · ");
}

function downloadResult(estAway, estHome, actAway, actHome, edgePick, toss, awayAbbrev, homeAbbrev) {
  if (actAway == null || actHome == null) return "";
  var bits = [];
  if (estAway == null || estHome == null) bits.push("No saved estimate");
  else {
    bits.push("Estimate " + estAway + "–" + estHome + " vs actual " + actAway + "–" + actHome);
    if (Number(estAway) === Number(actAway) && Number(estHome) === Number(actHome)) bits.push("exact score");
    else {
      var same = archive.winnerOf(Number(estAway), Number(estHome)) === archive.winnerOf(Number(actAway), Number(actHome));
      bits.push(same ? "winner right" : "winner wrong");
    }
  }
  if (!edgePick) bits.push("No saved Edge pick");
  else if (toss) bits.push("Toss-up, no firm pick");
  else {
    var actualWinner = archive.winnerOf(Number(actAway), Number(actHome));
    var edgeSide = edgePick === awayAbbrev ? "away" : edgePick === homeAbbrev ? "home" : null;
    if (!edgeSide || !actualWinner || actualWinner === "tie") bits.push("Edge pick " + edgePick + " not graded");
    else bits.push("Edge pick " + edgePick + (edgeSide === actualWinner ? " was right" : " was wrong"));
  }
  return bits.join(" · ");
}

function downloadRow(team, side, shared) {
  return {
    id: shared.id,
    when: shared.when,
    timeSort: shared.timeSort,
    matchup: shared.matchup,
    date: shared.date,
    time: shared.time,
    team: team.abbrev,
    teamName: team.name,
    side: side,
    record: team.record || "",
    pdo: team.pdo,
    last5SvPct: team.last5SvPct,
    last5AvgGd: team.last5AvgGd,
    gfMinusXg: team.gfMinusXg,
    sogShare: team.sogShare,
    cfPct: team.cfPct,
    hdcfPct: team.hdcfPct,
    xgfPct5v5: team.xgfPct5v5,
    stXg: team.stXg,
    estimatedScore: shared.estimatedScore,
    actualScore: shared.actualScore,
    edgePick: shared.edgePick,
    edgeLabel: shared.edgeLabel,
    winChance: shared.winChance,
    why: shared.why,
    notes: shared.notes,
    odds: shared.odds,
    result: shared.result
  };
}

async function downloadPayload() {
  var bt = await readServedBacktest(LIVE_BACKTEST_SEASON);
  var est = await loadEstimates();
  var arch = await store.readJson(store.KEYS.matchupArchive, archive.emptyStore());
  var oddsStore = await store.readJson(store.KEYS.odds, { byId: {} });
  var byId = Object.create(null);
  ((bt && bt.rows) || []).forEach(function (row) {
    if (!row || row.id == null) return;
    byId[String(row.id)] = { bt: row };
  });
  function slot(id) {
    var key = String(id);
    if (!byId[key]) byId[key] = {};
    return byId[key];
  }
  Object.keys((arch && arch.byId) || {}).forEach(function (id) {
    var row = arch.byId[id];
    if (!inDownloadSeason(row)) return;
    slot(id).arch = row;
  });
  Object.keys((est && est.byId) || {}).forEach(function (id) {
    var row = est.byId[id];
    if (!inDownloadSeason(row)) return;
    slot(id).est = row;
  });
  var games = Object.keys(byId).map(function (id) {
    var pack = byId[id];
    var btRow = pack.bt || null;
    var archRow = pack.arch || null;
    var estRow = pack.est || null;
    var awayAbbrev = (btRow && btRow.awayAbbrev) || (archRow && archRow.awayAbbrev) || (estRow && estRow.awayAbbrev) || "";
    var homeAbbrev = (btRow && btRow.homeAbbrev) || (archRow && archRow.homeAbbrev) || (estRow && estRow.homeAbbrev) || "";
    if (!awayAbbrev || !homeAbbrev) return null;
    var away = downloadProfile(awayAbbrev, archRow && archRow.awayPills, btSide(btRow, "away"));
    var home = downloadProfile(homeAbbrev, archRow && archRow.homePills, btSide(btRow, "home"));
    var gameDate = (btRow && btRow.gameDate) || (archRow && archRow.gameDate) || (estRow && estRow.gameDate) || "";
    var start = (btRow && btRow.startTimeUTC) || (archRow && archRow.startTimeUTC) || (estRow && estRow.startTimeUTC) || "";
    var when = splitWhen(gameDate, start);
    var estAway = filled(btRow && btRow.projectedAway, filled(archRow && archRow.estimatedAway, estRow && estRow.projectedAway));
    var estHome = filled(btRow && btRow.projectedHome, filled(archRow && archRow.estimatedHome, estRow && estRow.projectedHome));
    var actAway = filled(btRow && btRow.actualAway, estRow && estRow.actualAway);
    var actHome = filled(btRow && btRow.actualHome, estRow && estRow.actualHome);
    var storedPick = filled(btRow && btRow.edgeAbbrev, estRow && estRow.edgeAbbrev) || "";
    var toss = !!(btRow && btRow.edgeTossUp) || !!(estRow && estRow.edgeTossUp);
    var edge = stats.matchupEdge(away, home);
    var storedSide = storedPick === awayAbbrev ? "away" : storedPick === homeAbbrev ? "home" : null;
    var model = null;
    try {
      model = edgeModel.fromMatchup({
        away: away,
        home: home,
        projected: { away: estAway, home: estHome },
        edge: edge,
        gameDate: gameDate
      });
    } catch (e) { model = null; }
    var pickSide = model && (model.pick === "away" || model.pick === "home") ? model.pick : storedSide;
    var edgePick = pickSide === "away" ? awayAbbrev : pickSide === "home" ? homeAbbrev : storedPick;
    var why = stats.explainEdge(edge, away, home, pickSide || undefined);
    var winPct = model && pickSide ? (pickSide === "away" ? model.awayProb : model.homeProb) : null;
    var odds = (archRow && archRow.odds) || ((oddsStore.byId || {})[id]) || null;
    if (!odds && btRow && btRow.openingAwayMl != null) {
      odds = { awayMl: btRow.openingAwayMl, homeMl: btRow.openingHomeMl, total: btRow.openingTotal };
    }
    var shared = {
      id: id,
      when: (gameDate || "") + " " + (start || ""),
      timeSort: when.time || "",
      matchup: awayAbbrev + "-" + homeAbbrev,
      date: when.date,
      time: when.time,
      estimatedScore: scorePair(awayAbbrev, homeAbbrev, estAway, estHome),
      actualScore: scorePair(awayAbbrev, homeAbbrev, actAway, actHome),
      edgePick: edgePick,
      edgeLabel: model && model.pick === pickSide ? model.label : "",
      winChance: winPct == null ? "" : edgePick + " " + winPct + "%",
      why: why,
      notes: (btRow && btRow.notes) || "",
      odds: oddsText(odds, awayAbbrev, homeAbbrev),
      result: downloadResult(estAway, estHome, actAway, actHome, storedPick, toss, awayAbbrev, homeAbbrev)
    };
    return [downloadRow(away, "Away", shared), downloadRow(home, "Home", shared)];
  }).filter(Boolean);
  var rows = [];
  games.sort(function (a, b) {
    return String(a[0].when).localeCompare(String(b[0].when)) || String(a[0].matchup).localeCompare(String(b[0].matchup));
  });
  games.forEach(function (pair) { rows.push(pair[0], pair[1]); });
  return {
    season: LIVE_BACKTEST_SEASON,
    seasonLabel: formatSeason(LIVE_BACKTEST_SEASON),
    generatedAt: new Date().toISOString(),
    games: rows.length / 2,
    rows: rows
  };
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
  if (/\.(html|css|js|json|svg|png|ico)$/i.test(p)) return p;
  if (p.indexOf("/api/auth/") === 0) return p;
  if (p === "/api/prefs") return "/api/prefs";
  if (p === "/health" || p === "/api/health") return "/api/health";
  if (p === "/version" || p === "/api/version") return "/api/version";
  if (p === "/cron" || p === "/api/cron") return "/api/cron";
  if (p === "/seed" || p === "/api/seed") return "/api/seed";
  if (p === "/scores" || p === "/api/scores") return "/api/scores";
  if (p === "/api/scorers") return "/api/scorers";
  if (p === "/matchups" || p === "/api/matchups") return "/api/matchups";
  if (p === "/backtest" || p === "/api/backtest") return "/api/backtest";
  if (p === "/streaks" || p === "/api/streaks") return "/api/streaks";
  if (p === "/trends" || p === "/api/trends") return "/api/trends";
  if (p === "/teams" || p === "/api/teams") return "/api/teams";
  if (p === "/api/estimates/grade") return "/api/estimates/grade";
  if (p === "/api/download") return "/api/download";
  if (p === "/estimates" || p === "/api/estimates") return "/api/estimates";
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
handler.refreshLiveBacktest = refreshLiveBacktest;
handler.buildScorers = buildScorers;
handler.PORT = PORT;
module.exports = handler;
