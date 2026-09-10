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
    return { gp: 0, gf: 0, ga: 0, gds: [], w: 0, l: 0, otl: 0 };
  }

  function profileFromState(abbrev, st) {
    var last = st.gds.slice(-5);
    var last5Avg = last.length ? stats.round(last.reduce(function (s, n) { return s + n; }, 0) / last.length, 2) : 0;
    return {
      abbrev: abbrev,
      name: abbrev,
      gamesPlayed: st.gp || 1,
      goalsFor: st.gf,
      goalsAgainst: st.ga,
      xGoalsFor: st.gf,
      last5AvgGd: last5Avg,
      hdcfPct: 50
    };
  }

  function applyGame(st, gf, ga, winKind) {
    st.gp += 1;
    st.gf += gf;
    st.ga += ga;
    st.gds.push(gf - ga);
    if (winKind === "W") st.w += 1;
    else if (winKind === "OTL") st.otl += 1;
    else st.l += 1;
  }

  function run(games, opts) {
    opts = opts || {};
    var minGp = opts.minGp == null ? 5 : opts.minGp;
    var teams = Object.create(null);
    var rows = [];
    games.forEach(function (g) {
      if (!teams[g.awayAbbrev]) teams[g.awayAbbrev] = emptyTeam();
      if (!teams[g.homeAbbrev]) teams[g.homeAbbrev] = emptyTeam();
      var ast = teams[g.awayAbbrev];
      var hst = teams[g.homeAbbrev];
      var ready = ast.gp >= minGp && hst.gp >= minGp;
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
      applyGame(ast, g.actualAway, g.actualHome, awayWin ? "W" : "L");
      applyGame(hst, g.actualHome, g.actualAway, homeWin ? "W" : awayWin ? "L" : "OTL");
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
    profileFromState: profileFromState
  };
});
