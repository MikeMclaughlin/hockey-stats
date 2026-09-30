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

  function numOrNull(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * Wins/losses/OTL must come from the same season as the shot summary.
   * Live standings (often 0-0-0 before the new season) are ignored when
   * their seasonId does not match the summary season.
   */
  function recordFromSources(stand, summary) {
    stand = stand || {};
    summary = summary || {};
    var standSeason = numOrNull(stand.seasonId);
    var sumSeason = numOrNull(summary.seasonId);
    var seasonsDiffer = standSeason != null && sumSeason != null && standSeason !== sumSeason;
    var sumHas = summary.wins != null || summary.losses != null || summary.otLosses != null ||
      Number(summary.gamesPlayed) > 0;
    var useSummary = (seasonsDiffer && sumHas) ||
      ((stand.wins == null && stand.losses == null) && sumHas);
    var src = useSummary ? summary : stand;
    var wins = src.wins != null ? Number(src.wins) : 0;
    var losses = src.losses != null ? Number(src.losses) : 0;
    var otl = src.otLosses != null ? Number(src.otLosses) : (src.otl != null ? Number(src.otl) : 0);
    var gf = src.goalFor != null ? Number(src.goalFor) : (src.goalsFor != null ? Number(src.goalsFor) : null);
    var ga = src.goalAgainst != null ? Number(src.goalAgainst) : (src.goalsAgainst != null ? Number(src.goalsAgainst) : null);
    var goalDiff = src.goalDifferential != null ? Number(src.goalDifferential) : (gf != null && ga != null ? gf - ga : null);
    var ptsPct = src.pointPct != null ? Number(src.pointPct) : (src.pointPctg != null ? Number(src.pointPctg) : null);
    var gamesPlayed = src.gamesPlayed != null ? Number(src.gamesPlayed) : (wins + losses + otl);
    if (!gamesPlayed) {
      return {
        wins: 0,
        losses: 0,
        otl: 0,
        goalDiff: null,
        ptsPct: null,
        goalsFor: null,
        goalsAgainst: null,
        gamesPlayed: 0,
        source: useSummary ? "summary" : "standings",
        seasonId: useSummary ? sumSeason : standSeason
      };
    }
    return {
      wins: wins,
      losses: losses,
      otl: otl,
      goalDiff: goalDiff,
      ptsPct: ptsPct,
      goalsFor: gf,
      goalsAgainst: ga,
      gamesPlayed: gamesPlayed,
      source: useSummary ? "summary" : "standings",
      seasonId: useSummary ? sumSeason : standSeason
    };
  }

  function row(team, stand, summary, form) {
    stand = stand || {};
    summary = summary || {};
    form = form || { games: 0, w: 0, l: 0, ot: 0, gfGp: null, gaGp: null };
    var rec = recordFromSources(stand, summary);
    var gp = rec.gamesPlayed || stand.gamesPlayed || summary.gamesPlayed || 0;
    var sog = summary.shotsForPerGame;
    var soga = summary.shotsAgainstPerGame;
    if (sog == null && summary.shotsFor != null && gp) sog = summary.shotsFor / gp;
    if (soga == null && summary.shotsAgainst != null && gp) soga = summary.shotsAgainst / gp;
    var ptsPct = rec.ptsPct;
    if (ptsPct == null && gp) {
      ptsPct = Math.round((((rec.wins * 2) + rec.otl) / (gp * 2)) * 1000) / 1000;
    }
    return {
      abbrev: team.abbrev,
      name: team.name,
      wins: rec.wins,
      losses: rec.losses,
      otl: rec.otl,
      sogGp: sog != null ? Math.round(Number(sog) * 10) / 10 : null,
      sogaGp: soga != null ? Math.round(Number(soga) * 10) / 10 : null,
      l5w: form.w,
      l5l: form.l,
      l5ot: form.ot,
      l5gfGp: form.gfGp,
      l5gaGp: form.gaGp,
      ptsPct: ptsPct,
      goalDiff: rec.goalDiff,
      lastFive: form.list || []
    };
  }

  return { last5Form: last5Form, row: row, recordFromSources: recordFromSources };
});
