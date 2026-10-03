(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./stats.js"), require("./archive.js"));
  } else {
    root.HockeyBacktest = factory(root.HockeyStats, root.HockeyArchive);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (stats, archive) {
  "use strict";

  function collectGames(schedules) {
    var byId = Object.create(null);
    (schedules || []).forEach(function (sched) {
      (sched.games || []).forEach(function (g) {
        if (!g || g.gameType !== 2) return;
        if (!archive.isFinalState(g.gameState)) return;
        var away = g.awayTeam || {};
        var home = g.homeTeam || {};
        if (away.score == null || home.score == null) return;
        var outcome = g.gameOutcome || {};
        byId[g.id] = {
          id: g.id,
          gameDate: g.gameDate,
          startTimeUTC: g.startTimeUTC,
          awayAbbrev: away.abbrev,
          homeAbbrev: home.abbrev,
          actualAway: Number(away.score),
          actualHome: Number(home.score),
          lastPeriodType: outcome.lastPeriodType || (g.periodDescriptor && g.periodDescriptor.periodType) || "REG"
        };
      });
    });
    return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
      return String(a.startTimeUTC || a.gameDate).localeCompare(String(b.startTimeUTC || b.gameDate));
    });
  }

  function emptyTeam() {
    return {
      gp: 0, gf: 0, ga: 0, sf: 0, sa: 0,
      xgf: 0, xga: 0, xgf5: 0, xga5: 0,
      hdf: 0, hda: 0, cf: 0, ca: 0, ppXgf: 0, pkXga: 0,
      hasMp: false,
      gds: [], svLog: [], results: [], dates: [],
      lastDate: null, w: 0, l: 0, otl: 0
    };
  }

  function dayDiff(from, to) {
    if (!from || !to) return null;
    var a = Date.parse(String(from).slice(0, 10) + "T00:00:00Z");
    var b = Date.parse(String(to).slice(0, 10) + "T00:00:00Z");
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  function streak(results, kind) {
    var n = 0;
    for (var i = results.length - 1; i >= 0; i--) {
      if (results[i] !== kind) break;
      n += 1;
    }
    return n;
  }

  function loseStreak(results) {
    var n = 0;
    for (var i = results.length - 1; i >= 0; i--) {
      if (results[i] === "W") break;
      n += 1;
    }
    return n;
  }

  function gamesInWindow(dates, gameDate, days) {
    var n = 0;
    for (var i = 0; i < dates.length; i++) {
      var d = dayDiff(dates[i], gameDate);
      if (d != null && d >= 1 && d <= days) n += 1;
    }
    return n;
  }

  function scheduleForm(games, abbrev, beforeDate) {
    var form = { lastDate: null, dates: [], results: [] };
    (games || []).forEach(function (g) {
      if (!g || g.gameType !== 2) return;
      var st = String(g.gameState || "").toUpperCase();
      if (st !== "OFF" && st !== "FINAL" && st.indexOf("FINAL") !== 0) return;
      var date = g.gameDate;
      if (beforeDate && date >= beforeDate) return;
      var away = g.awayTeam || {};
      var home = g.homeTeam || {};
      var isAway = away.abbrev === abbrev;
      var isHome = home.abbrev === abbrev;
      if (!isAway && !isHome) return;
      var as = Number(away.score);
      var hs = Number(home.score);
      if (!isFinite(as) || !isFinite(hs)) return;
      var gf = isHome ? hs : as;
      var ga = isHome ? as : hs;
      var kind = gf > ga ? "W" : (isHome && gf < ga ? "L" : gf < ga ? "L" : "OTL");
      if (gf < ga) kind = "L";
      else if (gf > ga) kind = "W";
      form.dates.push(date);
      form.results.push(kind);
      form.lastDate = date;
    });
    return form;
  }

  function buildNotes(g, ast, hst, proj, odds) {
    var notes = [];
    var awayRest = dayDiff(ast.lastDate, g.gameDate);
    var homeRest = dayDiff(hst.lastDate, g.gameDate);
    var awayB2B = awayRest === 1;
    var homeB2B = homeRest === 1;
    if (awayB2B && homeB2B) notes.push("Both on a back-to-back");
    else if (awayB2B) notes.push(g.awayAbbrev + " played last night");
    else if (homeB2B) notes.push(g.homeAbbrev + " played last night");
    if (homeB2B && !awayB2B && awayRest != null && awayRest >= 2) {
      notes.push(g.awayAbbrev + " is the rested visitor");
    }
    if (awayB2B && !homeB2B && homeRest != null && homeRest >= 2) {
      notes.push("Rested home team vs tired visitor");
    }
    if (!homeB2B && homeRest != null && homeRest >= 3 && homeRest <= 14) {
      notes.push(g.homeAbbrev + " home after " + homeRest + " days rest");
    }
    if (gamesInWindow(ast.dates, g.gameDate, 4) >= 2) {
      notes.push(g.awayAbbrev + " in a 3-in-4");
    }
    if (gamesInWindow(hst.dates, g.gameDate, 4) >= 2) {
      notes.push(g.homeAbbrev + " in a 3-in-4");
    }
    var aw = streak(ast.results, "W");
    var hw = streak(hst.results, "W");
    var al = loseStreak(ast.results);
    var hl = loseStreak(hst.results);
    if (aw >= 3) notes.push(g.awayAbbrev + " on a " + aw + "-game win streak");
    if (hw >= 3) notes.push(g.homeAbbrev + " on a " + hw + "-game win streak");
    if (al >= 3) notes.push(g.awayAbbrev + " on a " + al + "-game skid");
    if (hl >= 3) notes.push(g.homeAbbrev + " on a " + hl + "-game skid");
    var homeDog = (odds && odds.homeMl != null)
      ? odds.homeMl > 0
      : (proj && proj.away > proj.home);
    if (homeDog && !homeB2B && (awayB2B || (homeRest != null && homeRest >= 2 && homeRest <= 14))) {
      notes.push("Rested home underdog (" + g.homeAbbrev + ")");
    }
    if (proj && proj.away === proj.home && (awayB2B || homeB2B)) {
      notes.push("Even projection with fatigue on one side");
    }
    return notes.join(" · ");
  }

  function last5Avg(st) {
    var last = (st.gds || []).slice(-5);
    if (!last.length) return 0;
    return stats.round(last.reduce(function (s, n) { return s + n; }, 0) / last.length, 2);
  }

  function snapshotStats(st) {
    return {
      last5AvgGd: last5Avg(st),
      pdo: (st.sf > 0 && st.sa > 0) ? stats.pdoFromShots(st.gf, st.ga, st.sf, st.sa) : null,
      xgfPct5v5: (st.xgf5 + st.xga5) > 0 ? stats.sogShare(st.xgf5, st.xga5) : null,
      last5SvPct: stats.last5SavePct(st.svLog)
    };
  }

  function lossKind(periodType) {
    var p = String(periodType || "REG").toUpperCase();
    return (p === "OT" || p === "SO") ? "OTL" : "L";
  }

  function profileFromState(abbrev, st, gameDate, goalieSv) {
    var snap = snapshotStats(st);
    var mp = !!st.hasMp;
    return {
      abbrev: abbrev,
      name: abbrev,
      gamesPlayed: st.gp || 1,
      goalsFor: st.gf,
      goalsAgainst: st.ga,
      xGoalsFor: mp ? st.xgf : null,
      last5AvgGd: snap.last5AvgGd,
      pdo: snap.pdo,
      sogShare: mp && st.sf ? stats.sogShare(st.sf, st.sa) : null,
      gfMinusXg: mp ? stats.round(st.gf - st.xgf, 2) : null,
      cfPct: mp && (st.cf + st.ca) ? stats.sogShare(st.cf, st.ca) : null,
      hdcfPct: mp && (st.hdf + st.hda) ? stats.sogShare(st.hdf, st.hda) : null,
      xgfPct5v5: snap.xgfPct5v5,
      stXg: mp ? stats.round(st.ppXgf - st.pkXga, 2) : null,
      ptsPct: st.gp ? stats.round(stats.pointsPct(st.w, st.l, st.otl), 4) : null,
      goalDiff: st.gf - st.ga,
      restDays: dayDiff(st.lastDate, gameDate),
      goalieSv: goalieSv == null ? null : goalieSv
    };
  }

  function applyGame(st, gf, ga, winKind, extra) {
    extra = extra || {};
    st.gp += 1;
    st.gf += gf;
    st.ga += ga;
    if (extra.sf) st.sf += extra.sf;
    if (extra.sa) st.sa += extra.sa;
    if (extra.xgf) st.xgf += extra.xgf;
    if (extra.xga) st.xga += extra.xga;
    if (extra.xgf5) st.xgf5 += extra.xgf5;
    if (extra.xga5) st.xga5 += extra.xga5;
    if (extra.hdf) st.hdf += extra.hdf;
    if (extra.hda) st.hda += extra.hda;
    if (extra.cf) st.cf += extra.cf;
    if (extra.ca) st.ca += extra.ca;
    if (extra.ppXgf) st.ppXgf += extra.ppXgf;
    if (extra.pkXga) st.pkXga += extra.pkXga;
    if (extra.sf || extra.xgf5 || extra.xgf) st.hasMp = true;
    if (extra.sa) st.svLog.push({ sa: extra.sa, ga: extra.ga != null ? extra.ga : ga });
    st.gds.push(gf - ga);
    st.results.push(winKind);
    if (extra.date) {
      st.lastDate = extra.date;
      st.dates.push(extra.date);
    }
    if (winKind === "W") st.w += 1;
    else if (winKind === "OTL") st.otl += 1;
    else st.l += 1;
  }

  function parseTeamGameCsv(text, seasonYear) {
    seasonYear = String(seasonYear || "2025");
    var lines = String(text || "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    var header = lines[0].split(",");
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });
    var byGame = Object.create(null);
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(",");
      if (String(cols[idx.season]) !== seasonYear) continue;
      var sit = cols[idx.situation];
      if (sit !== "all" && sit !== "5on5" && sit !== "5on4" && sit !== "4on5") continue;
      var id = String(cols[idx.gameId] || "");
      if (!id) continue;
      if (!byGame[id]) {
        byGame[id] = {
          gameId: Number(id),
          team: cols[idx.playerTeam] || cols[idx.team],
          gameDate: cols[idx.gameDate]
        };
      }
      var row = byGame[id];
      function col(name) {
        if (idx[name] == null) return 0;
        return Number(cols[idx[name]]) || 0;
      }
      if (sit === "all") {
        row.sf = col("shotsOnGoalFor");
        row.sa = col("shotsOnGoalAgainst");
        row.gf = col("goalsFor");
        row.ga = col("goalsAgainst");
        row.xgf = col("xGoalsFor");
        row.xga = col("xGoalsAgainst");
        row.hdf = col("highDangerShotsFor");
        row.hda = col("highDangerShotsAgainst");
        row.cf = col("shotAttemptsFor");
        row.ca = col("shotAttemptsAgainst");
      } else if (sit === "5on5") {
        row.xgf5 = col("xGoalsFor");
        row.xga5 = col("xGoalsAgainst");
      } else if (sit === "5on4") {
        row.ppXgf = col("xGoalsFor");
      } else if (sit === "4on5") {
        row.pkXga = col("xGoalsAgainst");
      } else {
        continue;
      }
    }
    return Object.keys(byGame).map(function (k) { return byGame[k]; });
  }

  function indexMpGames(list) {
    var out = Object.create(null);
    (list || []).forEach(function (r) {
      if (!r || !r.gameId || !r.team) return;
      out[r.gameId + ":" + r.team] = r;
    });
    return out;
  }

  function run(games, opts) {
    opts = opts || {};
    var minGp = opts.minGp == null ? 5 : opts.minGp;
    var mpIndex = indexMpGames(opts.mpGames || []);
    var teams = Object.create(null);
    var rows = [];
    games.forEach(function (g) {
      if (!teams[g.awayAbbrev]) teams[g.awayAbbrev] = emptyTeam();
      if (!teams[g.homeAbbrev]) teams[g.homeAbbrev] = emptyTeam();
      var ast = teams[g.awayAbbrev];
      var hst = teams[g.homeAbbrev];
      var ready = ast.gp >= minGp && hst.gp >= minGp;
      var awaySnap = snapshotStats(ast);
      var homeSnap = snapshotStats(hst);
      var awayRest = dayDiff(ast.lastDate, g.gameDate);
      var homeRest = dayDiff(hst.lastDate, g.gameDate);
      var awayProfile = profileFromState(g.awayAbbrev, ast, g.gameDate, g.awayGoalieSv);
      var homeProfile = profileFromState(g.homeAbbrev, hst, g.gameDate, g.homeGoalieSv);
      var proj = stats.estimateScore(awayProfile, homeProfile, opts.score || null);
      var edge = stats.matchupEdge(awayProfile, homeProfile);
      var toss = stats.isTossUp(edge);
      var awayPts = awayProfile.ptsPct;
      var homePts = homeProfile.ptsPct;
      var favorite = null;
      if (awayPts != null && homePts != null && awayPts !== homePts) {
        favorite = awayPts > homePts ? "away" : "home";
      }
      var edgeRole = "even";
      if (toss) edgeRole = "toss-up";
      else if (favorite && edge.winner === favorite) edgeRole = "favorite";
      else if (favorite) edgeRole = "underdog";
      var row = {
        id: g.id,
        season: g.season || opts.season || null,
        gameDate: g.gameDate,
        awayAbbrev: g.awayAbbrev,
        homeAbbrev: g.homeAbbrev,
        projectedAway: proj.away,
        projectedHome: proj.home,
        projectedLabel: proj.label,
        actualAway: g.actualAway,
        actualHome: g.actualHome,
        actualLabel: g.actualAway + "–" + g.actualHome,
        awayPdo: awaySnap.pdo,
        homePdo: homeSnap.pdo,
        awayLast5: awaySnap.last5AvgGd,
        homeLast5: homeSnap.last5AvgGd,
        awayXgf5: awaySnap.xgfPct5v5,
        homeXgf5: homeSnap.xgfPct5v5,
        awayLast5Sv: awaySnap.last5SvPct,
        homeLast5Sv: homeSnap.last5SvPct,
        awayB2B: awayRest === 1,
        homeB2B: homeRest === 1,
        edgeAbbrev: edge.winner === "away" ? g.awayAbbrev : g.homeAbbrev,
        edgeTossUp: toss,
        edgeRole: edgeRole,
        favoriteMethod: "points-percentage",
        notes: buildNotes(g, ast, hst, proj),
        skipped: !ready
      };
      if (ready) {
        archive.applyResult(row, g.actualAway, g.actualHome, "OFF");
        row.awayErr = Math.abs(proj.away - g.actualAway);
        row.homeErr = Math.abs(proj.home - g.actualHome);
        row.totalErr = row.awayErr + row.homeErr;
      }
      rows.push(row);
      var awayWin = g.actualAway > g.actualHome;
      var homeWin = g.actualHome > g.actualAway;
      var loser = lossKind(g.lastPeriodType);
      var amp = mpIndex[g.id + ":" + g.awayAbbrev] || {};
      var hmp = mpIndex[g.id + ":" + g.homeAbbrev] || {};
      amp.date = g.gameDate;
      hmp.date = g.gameDate;
      applyGame(ast, g.actualAway, g.actualHome, awayWin ? "W" : loser, amp);
      applyGame(hst, g.actualHome, g.actualAway, homeWin ? "W" : loser, hmp);
    });
    var graded = rows.filter(function (r) { return r.graded; });
    var sum = archive.summarize(graded);
    var mae = 0;
    graded.forEach(function (r) { mae += r.totalErr; });
    sum.maeGoals = graded.length ? stats.round(mae / graded.length, 2) : null;
    sum.skipped = rows.length - graded.length;
    sum.games = rows.length;
    return { season: String((opts && opts.season) || "20252026"), rows: rows, summary: sum };
  }

  return {
    collectGames: collectGames,
    run: run,
    profileFromState: profileFromState,
    scheduleForm: scheduleForm,
    parseTeamGameCsv: parseTeamGameCsv,
    snapshotStats: snapshotStats,
    buildNotes: buildNotes
  };
});
