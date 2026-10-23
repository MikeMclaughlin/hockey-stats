(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./stats.js"));
  } else {
    root.HockeyCardLeague = factory(root.HockeyStats);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (stats) {
  "use strict";

  // The nine stats already on the matchup card. Higher is better for each,
  // so rank 1 is the largest value and a positive gap or 5-day delta is good.
  var FIELDS = [
    "sogShare", "xgfPct5v5", "cfPct", "pdo", "last5SvPct",
    "last5AvgGd", "gfMinusXg", "hdcfPct", "stXg"
  ];

  function num(v) {
    if (v == null || v === "" || !isFinite(Number(v))) return null;
    return Number(v);
  }

  function compactDate(value) {
    return String(value || "").replace(/-/g, "").slice(0, 8);
  }

  function valuesFromProfile(profile) {
    var out = {};
    FIELDS.forEach(function (key) {
      out[key] = num(profile && profile[key]);
    });
    return out;
  }

  function add(sum, game, key) {
    var v = num(game && game[key]);
    return v == null ? sum : sum + v;
  }

  /**
   * Season-to-date card stats from games strictly before cutoffDate.
   * Schedule games supply last-five goal differential. MoneyPuck game
   * rows supply the rate stats. A missing log leaves those null.
   */
  function priorStats(log, scheduleGames, abbrev, cutoffDate) {
    var cut = compactDate(cutoffDate);
    var dashCut = String(cutoffDate || "").slice(0, 10);
    var games = (log || []).filter(function (g) {
      var day = compactDate(g && g.gameDate);
      return day && cut && day < cut;
    });
    var gf = 0;
    var ga = 0;
    var sf = 0;
    var sa = 0;
    var xgf = 0;
    var xgf5 = 0;
    var xga5 = 0;
    var hdf = 0;
    var hda = 0;
    var cf = 0;
    var ca = 0;
    var pp = 0;
    var pk = 0;
    var used = 0;
    games.forEach(function (g) {
      if (num(g.sf) == null && num(g.cf) == null && num(g.xgf5) == null) return;
      used += 1;
      gf = add(gf, g, "gf");
      ga = add(ga, g, "ga");
      sf = add(sf, g, "sf");
      sa = add(sa, g, "sa");
      xgf = add(xgf, g, "xgf");
      xgf5 = add(xgf5, g, "xgf5");
      xga5 = add(xga5, g, "xga5");
      hdf = add(hdf, g, "hdf");
      hda = add(hda, g, "hda");
      cf = add(cf, g, "cf");
      ca = add(ca, g, "ca");
      pp = add(pp, g, "ppXgf");
      pk = add(pk, g, "pkXga");
    });
    var before = (scheduleGames || []).filter(function (g) {
      if (!g || Number(g.gameType) !== 2) return false;
      var date = String(g.gameDate || "").slice(0, 10);
      return date && dashCut && date < dashCut;
    });
    var last5 = stats && stats.last5GoalDiff ? stats.last5GoalDiff(before, abbrev) : null;
    var svGames = games.filter(function (g) { return num(g.sa) != null; });
    var out = {
      sogShare: used && (sf + sa) ? stats.sogShare(sf, sa) : null,
      xgfPct5v5: used && (xgf5 + xga5) ? stats.sogShare(xgf5, xga5) : null,
      cfPct: used && (cf + ca) ? stats.sogShare(cf, ca) : null,
      pdo: used ? stats.pdoFromShots(gf, ga, sf, sa) : null,
      last5SvPct: svGames.length ? stats.last5SavePct(svGames) : null,
      last5AvgGd: last5 ? last5.avg : null,
      gfMinusXg: used ? stats.round(gf - xgf, 2) : null,
      hdcfPct: used && (hdf + hda) ? stats.sogShare(hdf, hda) : null,
      stXg: used ? stats.round(pp - pk, 2) : null
    };
    var any = FIELDS.some(function (key) { return out[key] != null; });
    return any ? out : null;
  }

  function ordinal(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return n + "th";
    var last = n % 10;
    if (last === 1) return n + "st";
    if (last === 2) return n + "nd";
    if (last === 3) return n + "rd";
    return n + "th";
  }

  function rankLabel(rank, tied) {
    if (rank == null) return "—";
    var text = ordinal(rank);
    return tied ? "T-" + text : text;
  }

  /**
   * Competition rank, 1 = highest. Ties share the best rank (T-6th, then 8th).
   * gap is the value minus the mean of teams that have a number.
   */
  function rankBoards(teams) {
    var boards = {};
    FIELDS.forEach(function (field) {
      var rows = [];
      (teams || []).forEach(function (team) {
        var value = num(team && team.values && team.values[field]);
        if (value == null) return;
        rows.push({ abbrev: team.abbrev, value: value });
      });
      rows.sort(function (a, b) { return b.value - a.value; });
      var sum = 0;
      rows.forEach(function (row) { sum += row.value; });
      var avg = rows.length ? sum / rows.length : null;
      var byAbbrev = {};
      var i = 0;
      while (i < rows.length) {
        var j = i + 1;
        while (j < rows.length && rows[j].value === rows[i].value) j += 1;
        var rank = i + 1;
        var tied = j - i > 1;
        for (var k = i; k < j; k++) {
          byAbbrev[rows[k].abbrev] = {
            rank: rank,
            tied: tied,
            gap: avg == null ? null : rows[k].value - avg
          };
        }
        i = j;
      }
      boards[field] = { avg: avg, n: rows.length, byAbbrev: byAbbrev };
    });
    return boards;
  }

  return {
    FIELDS: FIELDS,
    valuesFromProfile: valuesFromProfile,
    priorStats: priorStats,
    ordinal: ordinal,
    rankLabel: rankLabel,
    rankBoards: rankBoards
  };
});
