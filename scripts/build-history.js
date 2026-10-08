"use strict";

/**
 * Build static backtest files for 2021-22 through 2025-26 and test score-model
 * changes. Writes public/data/backtest-SEASON.json. Does not upload anything.
 *
 * Resume: cached downloads live in /tmp/hs17/. Delete that directory to refetch.
 */

var fs = require("fs");
var path = require("path");
var https = require("https");
var stats = require("../public/js/stats.js");
var backtest = require("../public/js/backtest.js");
var archive = require("../public/js/archive.js");

var ROOT = path.join(__dirname, "..");
var OUT = path.join(ROOT, "public", "data");
var CACHE = "/tmp/hs17";
var SEASONS = ["20212022", "20222023", "20232024", "20242025", "20252026"];
var UA = "hockey-stats/1.8";

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

function getBuf(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { headers: { "User-Agent": UA, Accept: "*/*" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        var next = res.headers.location;
        if (next.indexOf("http") !== 0) next = "https://moneypuck.com" + next;
        return getBuf(next).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(res.statusCode + " " + url));
      }
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve(Buffer.concat(chunks)); });
    });
    req.on("error", reject);
    req.setTimeout(60000, function () { req.destroy(new Error("timeout " + url)); });
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function teamsFor(season) {
  var list = stats.TEAMS.map(function (t) { return t.abbrev; });
  if (Number(String(season).slice(0, 4)) <= 2023) {
    list = list.filter(function (ab) { return ab !== "UTA"; });
    list.push("ARI");
  }
  return list;
}

function mpTeams() {
  var list = stats.TEAMS.map(function (t) { return t.abbrev; });
  if (list.indexOf("ARI") === -1) list.push("ARI");
  return list;
}

async function loadSchedules() {
  var file = path.join(CACHE, "games.json");
  if (fs.existsSync(file)) {
    console.log("schedules cached");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  var games = [];
  for (var s = 0; s < SEASONS.length; s++) {
    var season = SEASONS[s];
    var abbrevs = teamsFor(season);
    var schedules = [];
    for (var i = 0; i < abbrevs.length; i += 6) {
      var slice = abbrevs.slice(i, i + 6);
      var part = await Promise.all(slice.map(function (ab) {
        var url = "https://api-web.nhle.com/v1/club-schedule-season/" + ab + "/" + season;
        return getBuf(url).then(function (buf) { return JSON.parse(buf.toString("utf8")); }).catch(function (e) {
          console.log("schedule miss", ab, season, e.message);
          return { games: [] };
        });
      }));
      schedules = schedules.concat(part);
    }
    var collected = backtest.collectGames(schedules);
    collected.forEach(function (g) { g.season = season; });
    console.log(season, "finals", collected.length);
    games = games.concat(collected);
  }
  fs.writeFileSync(file, JSON.stringify(games));
  return games;
}

async function loadMoneyPuck() {
  var file = path.join(CACHE, "mp.json");
  if (fs.existsSync(file)) {
    console.log("moneypuck cached");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  var rows = [];
  var teams = mpTeams();
  for (var i = 0; i < teams.length; i++) {
    var ab = teams[i];
    var url = "https://moneypuck.com/moneypuck/playerData/careers/gameByGame/regular/teams/" + ab + ".csv";
    var text;
    try {
      text = (await getBuf(url)).toString("utf8");
    } catch (e) {
      console.log("mp miss", ab, e.message);
      continue;
    }
    SEASONS.forEach(function (season) {
      var year = season.slice(0, 4);
      rows = rows.concat(backtest.parseTeamGameCsv(text, year));
    });
    console.log("mp", ab, "rows", rows.length);
    await sleep(150);
  }
  fs.writeFileSync(file, JSON.stringify(rows));
  return rows;
}

function starterOf(list) {
  var found = null;
  (list || []).forEach(function (g) {
    if (g && g.starter) found = g;
  });
  return found;
}

async function loadGoalies(games) {
  var file = path.join(CACHE, "goalies.json");
  var saved = {};
  if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, "utf8"));
  var pending = games.filter(function (g) { return !saved[String(g.id)]; });
  console.log("goalie boxscores", pending.length, "remaining of", games.length);
  var cursor = 0;
  var inflight = 0;
  var failed = 0;
  await new Promise(function (resolve) {
    function finishOne() {
      inflight -= 1;
      if (cursor >= pending.length && inflight === 0) resolve();
      else pump();
    }
    function pump() {
      while (inflight < 6 && cursor < pending.length) {
        var g = pending[cursor++];
        inflight += 1;
        (function (game) {
          var url = "https://api-web.nhle.com/v1/gamecenter/" + game.id + "/boxscore";
          getBuf(url).then(function (buf) {
            var box = JSON.parse(buf.toString("utf8"));
            var pb = box.playerByGameStats || {};
            function pack(side) {
              var st = starterOf((pb[side] || {}).goalies);
              if (!st) return null;
              return {
                id: st.playerId,
                sa: Number(st.shotsAgainst) || 0,
                sv: Number(st.saves) || 0
              };
            }
            saved[String(game.id)] = { away: pack("awayTeam"), home: pack("homeTeam") };
          }).catch(function () {
            failed += 1;
            saved[String(game.id)] = { away: null, home: null, miss: true };
          }).then(function () {
            if ((cursor % 200) === 0) {
              fs.writeFileSync(file, JSON.stringify(saved));
              console.log("goalies", Object.keys(saved).length, "fail", failed);
            }
            finishOne();
          });
        })(g);
      }
      if (cursor >= pending.length && inflight === 0) resolve();
    }
    pump();
  });
  fs.writeFileSync(file, JSON.stringify(saved));
  console.log("goalies done", Object.keys(saved).length, "fail", failed);
  return saved;
}

function attachGoaliePriors(games, box) {
  var career = Object.create(null);
  games.forEach(function (g) {
    var rec = box[String(g.id)] || {};
    function prior(side) {
      var st = rec[side];
      if (!st || !st.id || st.sa < 1) return null;
      var c = career[st.id];
      if (!c || c.starts < 3 || c.sa < 30) return null;
      return stats.round(100 * c.sv / c.sa, 2);
    }
    g.awayGoalieSv = prior("away");
    g.homeGoalieSv = prior("home");
    ["away", "home"].forEach(function (side) {
      var st = rec[side];
      if (!st || !st.id) return;
      if (!career[st.id]) career[st.id] = { starts: 0, sa: 0, sv: 0 };
      career[st.id].starts += 1;
      career[st.id].sa += st.sa || 0;
      career[st.id].sv += st.sv || 0;
    });
  });
}

function scoreMetrics(rows) {
  var n = 0;
  var win = 0;
  var tot = 0;
  var mar = 0;
  rows.forEach(function (r) {
    if (!r.graded) return;
    n += 1;
    if (r.winnerCorrect) win += 1;
    var err = archive.scoreErrors(r);
    tot += err.totalGoalsError || 0;
    mar += err.marginError || 0;
  });
  return {
    n: n,
    winner: n ? win / n : 0,
    winnerPct: n ? Math.round((win / n) * 1000) / 10 : null,
    total: n ? tot / n : 0,
    margin: n ? mar / n : 0,
    wins: win
  };
}

function beats(next, base) {
  return next.winner >= base.winner + 0.005 &&
    next.total <= base.total - 0.02 &&
    next.margin <= base.margin - 0.02;
}

function fmt(m) {
  return m.winnerPct + "% (" + m.wins + "/" + m.n + ") total " + m.total.toFixed(3) + " margin " + m.margin.toFixed(3);
}

function runAll(games, mpGames, scoreOpts) {
  var rows = [];
  SEASONS.forEach(function (season) {
    var subset = games.filter(function (g) { return g.season === season; });
    var out = backtest.run(subset, { minGp: 5, mpGames: mpGames, season: season, score: scoreOpts });
    rows = rows.concat(out.rows);
  });
  return rows;
}

function tryGrid(games, mpGames, base, baseOpts) {
  var report = [];
  var best = null;
  var bestOpts = null;
  function attempt(label, extra) {
    var opts = Object.assign({}, baseOpts, extra);
    var rows = runAll(games, mpGames, opts);
    var m = scoreMetrics(rows);
    var ok = beats(m, base);
    report.push({ label: label, opts: extra, metrics: m, kept: ok });
    console.log((ok ? "KEEP " : "skip "), label, fmt(m));
    if (ok && (!best || m.winner > best.winner || (m.winner === best.winner && m.total < best.total))) {
      best = m;
      bestOpts = extra;
    }
    return m;
  }

  var homes = [0.15, 0.22, 0.28, 0.32, 0.40, 0.48];
  homes.forEach(function (v) { if (v !== 0.32) attempt("homeIce " + v, { homeIce: v }); });
  [0.05, 0.10, 0.15, 0.25, 0.35].forEach(function (v) {
    if (v !== 0.15) attempt("b2b " + v, { b2b: v });
  });
  [0, 0.05, 0.08, 0.15].forEach(function (v) {
    if (v !== 0.08) attempt("restBump " + v, { restBump: v });
  });
  [
    { wGf: 0.50, wXg: 0.25, wOpp: 0.25 },
    { wGf: 0.30, wXg: 0.45, wOpp: 0.25 },
    { wGf: 0.45, wXg: 0.35, wOpp: 0.20 },
    { wGf: 0.35, wXg: 0.35, wOpp: 0.30 }
  ].forEach(function (w) { attempt("weights " + w.wGf + "/" + w.wXg + "/" + w.wOpp, w); });
  [0.8, 1.0, 1.2].forEach(function (v) { if (v !== 1.2) attempt("floor " + v, { floor: v }); });
  [0].forEach(function (v) { attempt("minGoals " + v, { minGoals: v }); });
  [0.08, 0.12, 0.20, 0.30].forEach(function (v) { attempt("last5 " + v, { last5: v }); });
  [0.6, 0.8, 1, 1.2, 1.6, 2].forEach(function (v) {
    attempt("scaled margin " + v, { marginMode: "scaled", marginScale: v });
  });
  [4, 8, 12, 20].forEach(function (v) { attempt("goalie " + v, { goalie: v }); });

  return { report: report, best: best, bestOpts: bestOpts };
}

function limitsText() {
  return [
    "Regular-season finals only, 2021-22 through 2025-26.",
    "Shots, expected goals, Corsi (shot attempts), high-danger shots, and special-teams expected goals come from MoneyPuck game logs. A row with no MoneyPuck line leaves those blank.",
    "Special-teams expected goals are 5-on-4 expected goals for minus 4-on-5 expected goals against.",
    "No historical moneylines are stored. Favorite means the club with the higher points percentage before the game.",
    "Arizona is ARI through 2023-24. Utah is UTA from 2024-25.",
    "Starting goalies were tested from NHL boxscore starters (prior save percentage, at least 3 starts and 30 shots). The factor did not beat the current score model, so it is not applied and rows do not store goalie save percentage. There is no live projected-starter feed. Injuries are not included."
  ];
}

function writeSeason(season, rows, generatedAt, modelNote) {
  var graded = rows.filter(function (r) { return r.graded && r.season === season; });
  var sum = archive.summarize(graded);
  var body = {
    season: season,
    generatedAt: generatedAt,
    source: "Walk-forward NHL club-schedule-season finals plus MoneyPuck team game logs.",
    favoriteMethod: "points-percentage",
    favoriteLabel: "Higher points percentage before the game. Not a betting line.",
    modelNote: modelNote,
    limits: limitsText(),
    summary: sum,
    rows: graded
  };
  var name = path.join(OUT, "backtest-" + season + ".json");
  fs.writeFileSync(name, JSON.stringify(body));
  console.log("wrote", name, graded.length, (fs.statSync(name).size / 1024).toFixed(0) + "KB");
}

async function main() {
  ensure(CACHE);
  ensure(OUT);
  var games = await loadSchedules();
  var mpGames = await loadMoneyPuck();
  var box = await loadGoalies(games);
  attachGoaliePriors(games, box);
  var withGoalie = games.filter(function (g) { return g.awayGoalieSv != null && g.homeGoalieSv != null; }).length;
  console.log("games", games.length, "mp", mpGames.length, "both goalie priors", withGoalie);

  var baseRows = runAll(games, mpGames, null);
  var base = scoreMetrics(baseRows);
  console.log("BASELINE", fmt(base));
  var grid = tryGrid(games, mpGames, base, {});
  var chosen = grid.bestOpts;
  var note = "Score model constants are the 1.6 formula. No replay change beat winner accuracy by 0.5 points and both errors by 0.02 goals.";
  if (chosen) {
    note = "Shipped replay change: " + JSON.stringify(chosen);
    console.log("SHIP", note);
  } else {
    console.log("NO MODEL CHANGE");
  }
  var finalOpts = chosen || null;
  var finalRows = runAll(games, mpGames, finalOpts);
  var generatedAt = new Date().toISOString();
  SEASONS.forEach(function (season) {
    writeSeason(season, finalRows, generatedAt, note);
  });
  var report = {
    baseline: base,
    shipped: chosen || null,
    attempts: grid.report.map(function (r) {
      return { label: r.label, kept: r.kept, winnerPct: r.metrics.winnerPct, total: Math.round(r.metrics.total * 1000) / 1000, margin: Math.round(r.metrics.margin * 1000) / 1000 };
    }),
    goalieBoth: withGoalie,
    games: games.length
  };
  fs.writeFileSync(path.join(CACHE, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "backtest-report.json"), JSON.stringify({
    baseline: { winnerPct: base.winnerPct, wins: base.wins, n: base.n, total: Math.round(base.total * 1000) / 1000, margin: Math.round(base.margin * 1000) / 1000 },
    shipped: chosen || null,
    note: note
  }));
  console.log("report", path.join(CACHE, "report.json"));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
