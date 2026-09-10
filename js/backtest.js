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
        byId[g.id] = {
          id: g.id,
          gameDate: g.gameDate,
          startTimeUTC: g.startTimeUTC,
          awayAbbrev: away.abbrev,
          homeAbbrev: home.abbrev,
          actualAway: Number(away.score),
          actualHome: Number(home.score)
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
      xgf5: 0, xga5: 0, gds: [], w: 0, l: 0, otl: 0
    };
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
      xgfPct5v5: (st.xgf5 + st.xga5) > 0 ? stats.sogShare(st.xgf5, st.xga5) : null
    };
  }

  function profileFromState(abbrev, st) {
    var snap = snapshotStats(st);
    return {
      abbrev: abbrev,
      name: abbrev,
      gamesPlayed: st.gp || 1,
      goalsFor: st.gf,
      goalsAgainst: st.ga,
      xGoalsFor: st.gf,
      last5AvgGd: snap.last5AvgGd,
      pdo: snap.pdo,
      xgfPct5v5: snap.xgfPct5v5,
      hdcfPct: 50
    };
  }

  function applyGame(st, gf, ga, winKind, extra) {
    extra = extra || {};
    st.gp += 1;
    st.gf += gf;
    st.ga += ga;
    if (extra.sf) st.sf += extra.sf;
    if (extra.sa) st.sa += extra.sa;
    if (extra.xgf5) st.xgf5 += extra.xgf5;
    if (extra.xga5) st.xga5 += extra.xga5;
    st.gds.push(gf - ga);
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
      if (sit !== "all" && sit !== "5on5") continue;
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
      if (sit === "all") {
        row.sf = Number(cols[idx.shotsOnGoalFor]) || 0;
        row.sa = Number(cols[idx.shotsOnGoalAgainst]) || 0;
        row.gf = Number(cols[idx.goalsFor]) || 0;
        row.ga = Number(cols[idx.goalsAgainst]) || 0;
      } else {
        row.xgf5 = Number(cols[idx.xGoalsFor]) || 0;
        row.xga5 = Number(cols[idx.xGoalsAgainst]) || 0;
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
      var proj = stats.estimateScore(profileFromState(g.awayAbbrev, ast), profileFromState(g.homeAbbrev, hst));
      var row = {
        id: g.id,
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
      var amp = mpIndex[g.id + ":" + g.awayAbbrev] || {};
      var hmp = mpIndex[g.id + ":" + g.homeAbbrev] || {};
      applyGame(ast, g.actualAway, g.actualHome, awayWin ? "W" : "L", amp);
      applyGame(hst, g.actualHome, g.actualAway, homeWin ? "W" : awayWin ? "L" : "OTL", hmp);
    });
    var graded = rows.filter(function (r) { return r.graded; });
    var sum = archive.summarize(graded);
    var mae = 0;
    graded.forEach(function (r) { mae += r.totalErr; });
    sum.maeGoals = graded.length ? stats.round(mae / graded.length, 2) : null;
    sum.skipped = rows.length - graded.length;
    sum.games = rows.length;
    return { season: "20252026", rows: rows, summary: sum };
  }

  return {
    collectGames: collectGames,
    run: run,
    profileFromState: profileFromState,
    parseTeamGameCsv: parseTeamGameCsv,
    snapshotStats: snapshotStats
  };
});
