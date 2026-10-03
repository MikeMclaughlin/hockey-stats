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
var streaks = require("./public/js/streaks.js");
var teamStats = require("./public/js/teamStats.js");

var ROOT = __dirname;
var PORT = Number(process.env.PORT || 3080);
var CACHE_MS = 5 * 60 * 1000;
var matchupCache = Object.create(null);

function productVersion() {
  try {
    var parts = String(require("./package.json").version || "1.7.0").split(".");
    return (parts[0] || "1") + "." + (parts[1] || "7");
  } catch (e) {
    return "1.7";
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
  https.get(urlStr, { headers: { "User-Agent": "hockey-stats/1.7", Accept: "*/*" } }, function (up) {
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
  var day = cleanDate(date);
  var score = await getJson(day
    ? "https://api-web.nhle.com/v1/score/" + day
    : "https://api-web.nhle.com/v1/score/now");
  rememberScoreboard(day || "now", score);
  var standings = await getJson("https://api-web.nhle.com/v1/standings/now");
  var liveOdds = await fetchPartnerOdds(null);
  if (day) {
    var datedOdds = await fetchPartnerOdds(day);
    Object.keys(datedOdds).forEach(function (id) { liveOdds[id] = datedOdds[id]; });
  }
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
          formMap[ab] = backtest.scheduleForm(games, ab, score.currentDate);
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
      return !score.currentDate || String(g.date || "").slice(0, 10) < String(score.currentDate).slice(0, 10);
    });
    if (!prior.length) return null;
    return restDaysBetween(prior[prior.length - 1].date, score.currentDate);
  }

  function last5Save(ab, preseason) {
    var fromMp = stats.last5SavePctFromMp(mpGamesCache, ab, score.currentDate);
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
    var rsRest = restDaysBetween((formMap[ab] || {}).lastDate, score.currentDate);
    var restFromPre = rsRest == null;
    var rest = rsRest != null ? rsRest : preseasonRest(ab);
    var fill = rec.gamesPlayed ? null : preseasonFill(ab);
    var flags = {};
    if (!fill && restFromPre && rest != null) flags.rest = true;
    var p = stats.buildTeamProfile({
      abbrev: ab,
      name: meta.name || (teamObj.name && teamObj.name.default) || ab,
      logo: teamObj.logo,
      stand: alignStand(sameSeasonRow(standMap[ab], statsSeason), sameSeasonRow(sumMap[ab], statsSeason)),
      summary: sameSeasonRow(sumMap[ab], statsSeason) || {},
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
      gameDate: g.gameDate || score.currentDate,
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
      why: stats.explainEdge(edge, away, home),
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
  matchups.forEach(function (m) {
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
    currentDate: score.currentDate,
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
  var persisted = true;
  var storageError = null;
  try {
    await saveEstimates(est);
  } catch (e) {
    persisted = false;
    storageError = String(e.message || e);
  }
  var graded = await estimatesPayload(est);
  graded.persisted = persisted;
  graded.storage = store.storageMode();
  graded.storageError = storageError;
  return graded;
}

var CRON_SCHEDULES = ["0 4 * * *", "0 13 * * *", "0 21 * * *"];
var CRON_AUTH_HINT = "Set CRON_SECRET on the Vercel project and send Authorization: Bearer <CRON_SECRET>. Vercel Cron adds that header automatically.";

function cronSecret() {
  return String(process.env.CRON_SECRET || "").trim();
}

function cronAuthorized(req) {
  var secret = cronSecret();
  var header = "";
  if (req && req.headers) header = String(req.headers.authorization || "");
  if (secret) return header === "Bearer " + secret;
  return !process.env.VERCEL;
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
  matchupCache.now = { at: Date.now(), body: body };
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

var BACKTEST_SEASONS = ["20212022", "20222023", "20232024", "20242025", "20252026"];

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
  var seasons = seasonMeta(seasonId, statsSeason, standingsSnapshot(standings, statsSeason).maxGp);
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
  var blob = parts.filter(Boolean).join(" ").toLowerCase();
  if (/\.(html|css|js|json|svg|png|ico)(\s|$|\?)/i.test(blob) && blob.indexOf("/api/") === -1) return p;
  var fromApi = blob.indexOf("/api/") !== -1 || /(^|\s)api\//.test(blob);
  if (!fromApi) return p;
  if (blob.indexOf("/api/scores") !== -1 || blob.indexOf("api/scores") !== -1) return "/api/scores";
  if (blob.indexOf("cron") !== -1) return "/api/cron";
  if (blob.indexOf("grade") !== -1) return "/api/estimates/grade";
  if (blob.indexOf("seed") !== -1) return "/api/seed";
  if (blob.indexOf("version") !== -1) return "/api/version";
  if (blob.indexOf("health") !== -1) return "/api/health";
  if (blob.indexOf("matchup") !== -1) return "/api/matchups";
  if (blob.indexOf("backtest") !== -1) return "/api/backtest";
  if (blob.indexOf("streak") !== -1) return "/api/streaks";
  if (blob.indexOf("/teams") !== -1 || blob.indexOf("api/teams") !== -1) return "/api/teams";
  if (blob.indexOf("estimate") !== -1) return "/api/estimates";
  return p;
}

function handleApi(req, res, url) {
  var pathname = detectRoute(req, url);
  if (pathname === "/api/seed" && (req.method === "POST" || req.method === "GET")) {
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
  if (pathname === "/api/scores") {
    var scoreDate = cleanDate(url.searchParams.get("date"));
    loadScoreboard(scoreDate)
      .then(function (packed) { sendJson(res, 200, scorePayload(packed)); })
      .catch(function (err) {
        sendJson(res, 502, { error: String(err.message || err), games: [] });
      });
    return true;
  }
  if (pathname === "/api/matchups") {
    var boardDate = cleanDate(url.searchParams.get("date"));
    var cacheKey = boardDate || "now";
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
        sendBoard(body, !boardDate);
      })
      .catch(function (err) {
        store.readJson(store.KEYS.matchups, null).then(function (fallback) {
          if (fallback && !boardDate) {
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
  if (/\.(html|css|js|json|svg|png|ico)$/i.test(p)) return p;
  if (p === "/health" || p === "/api/health") return "/api/health";
  if (p === "/version" || p === "/api/version") return "/api/version";
  if (p === "/cron" || p === "/api/cron") return "/api/cron";
  if (p === "/seed" || p === "/api/seed") return "/api/seed";
  if (p === "/scores" || p === "/api/scores") return "/api/scores";
  if (p === "/matchups" || p === "/api/matchups") return "/api/matchups";
  if (p === "/backtest" || p === "/api/backtest") return "/api/backtest";
  if (p === "/streaks" || p === "/api/streaks") return "/api/streaks";
  if (p === "/teams" || p === "/api/teams") return "/api/teams";
  if (p === "/api/estimates/grade") return "/api/estimates/grade";
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
handler.PORT = PORT;
module.exports = handler;
