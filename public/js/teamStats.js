(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyTeamStats = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function lastPeriodType(g) {
    return (g.gameOutcome && g.gameOutcome.lastPeriodType) ||
      (g.periodDescriptor && g.periodDescriptor.periodType) ||
      "REG";
  }

  function last5Form(games, abbrev, opts) {
    opts = opts || {};
    var types = opts.types || [1, 2];
    var venue = opts.venue || null;
    var used = [];
    (games || []).slice().reverse().forEach(function (g) {
      if (used.length >= 5) return;
      var st = String(g.gameState || "").toUpperCase();
      if (st !== "OFF" && st !== "FINAL" && st.indexOf("FINAL") !== 0) return;
      if (g.gameType && types.indexOf(Number(g.gameType)) === -1) return;
      var away = g.awayTeam || {};
      var home = g.homeTeam || {};
      var isAway = away.abbrev === abbrev;
      var isHome = home.abbrev === abbrev;
      if (!isAway && !isHome) return;
      if (venue === "home" && !isHome) return;
      if (venue === "away" && !isAway) return;
      var as = Number(away.score);
      var hs = Number(home.score);
      if (!isFinite(as) || !isFinite(hs)) return;
      var gf = isHome ? hs : as;
      var ga = isHome ? as : hs;
      var result = "W";
      if (gf < ga) {
        var pt = String(lastPeriodType(g) || "REG").toUpperCase();
        result = (pt === "OT" || pt === "SO") ? "OT" : "L";
      }
      used.push({
        gf: gf,
        ga: ga,
        result: result,
        date: g.gameDate,
        gameType: g.gameType,
        opponent: isHome ? away.abbrev : home.abbrev,
        venue: isHome ? "home" : "away",
        score: gf + "–" + ga
      });
    });
    var w = 0, l = 0, ot = 0, gf = 0, ga = 0;
    used.forEach(function (g) {
      if (g.result === "W") w += 1;
      else if (g.result === "OT") ot += 1;
      else l += 1;
      gf += g.gf;
      ga += g.ga;
    });
    var n = used.length || 0;
    return {
      games: n,
      w: w,
      l: l,
      ot: ot,
      gf: gf,
      ga: ga,
      gfGp: n ? Math.round((gf / n) * 100) / 100 : null,
      gaGp: n ? Math.round((ga / n) * 100) / 100 : null,
      list: used
    };
  }

  function row(team, stand, summary, form) {
    stand = stand || {};
    summary = summary || {};
    form = form || { games: 0, w: 0, l: 0, ot: 0, gfGp: null, gaGp: null };
    var gp = stand.gamesPlayed || summary.gamesPlayed || 0;
    var sog = summary.shotsForPerGame;
    var soga = summary.shotsAgainstPerGame;
    if (sog == null && summary.shotsFor != null && gp) sog = summary.shotsFor / gp;
    if (soga == null && summary.shotsAgainst != null && gp) soga = summary.shotsAgainst / gp;
    return {
      abbrev: team.abbrev,
      name: team.name,
      wins: stand.wins != null ? stand.wins : summary.wins,
      losses: stand.losses != null ? stand.losses : summary.losses,
      otl: stand.otLosses != null ? stand.otLosses : summary.otLosses,
      sogGp: sog != null ? Math.round(Number(sog) * 10) / 10 : null,
      sogaGp: soga != null ? Math.round(Number(soga) * 10) / 10 : null,
      l5w: form.w,
      l5l: form.l,
      l5ot: form.ot,
      l5gfGp: form.gfGp,
      l5gaGp: form.gaGp,
      ptsPct: stand.pointPct != null ? stand.pointPct : (gp ? Math.round(((num(stand.points) || ((num(stand.wins) * 2) + num(stand.otLosses))) / (gp * 2)) * 1000) / 1000 : null),
      goalDiff: stand.goalDifferential != null ? stand.goalDifferential : null,
      lastFive: form.list || []
    };
  }

  return { last5Form: last5Form, row: row };
});
