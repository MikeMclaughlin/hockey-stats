(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyTrends = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Games-ago definition:
  // The log is regular-season finals only (game type 2), previous season
  // then current season, ordered by date. Current is the current regular
  // season to date. N games ago is the season-to-date rate through the game
  // N places before the most recent game in that combined log. When the
  // cutoff game is in the previous season, the rate uses only that season's
  // games through the cutoff (not a blend with the current season).
  // Win % is wins / games played. A win is any game the team outscored the
  // opponent, including overtime and shootouts. Overtime and shootout losses
  // are not wins, so they count as losses. Ties are not wins.
  //
  // Share stats use the same situation split as public/js/stats.js:
  // shots-on-goal share and shot-attempt share are all situations;
  // even-strength expected-goals share is 5-on-5. Each share is
  // sum(for) / (sum(for) + sum(against)) over the games in the span.
  // A span with any game missing that count is null.

  var AGO = [1, 5, 10, 15, 20];

  function round(n, d) {
    var p = Math.pow(10, d == null ? 0 : d);
    return Math.round(n * p) / p;
  }

  function byGame(a, b) {
    var date = String(a.date || "").localeCompare(String(b.date || ""));
    if (date) return date;
    return Number(a.id) - Number(b.id);
  }

  function pairShare(games, forKey, againstKey) {
    var f = 0;
    var a = 0;
    for (var i = 0; i < games.length; i++) {
      var game = games[i];
      var fv = game[forKey];
      var av = game[againstKey];
      if (fv == null || av == null || !isFinite(Number(fv)) || !isFinite(Number(av))) return null;
      f += Number(fv);
      a += Number(av);
    }
    if (!(f + a > 0)) return null;
    return round(f / (f + a), 3);
  }

  function rate(games) {
    if (!games || !games.length) return null;
    var gp = games.length;
    var wins = 0;
    var gf = 0;
    var sf = 0;
    var shotGames = 0;
    games.forEach(function (g) {
      if (Number(g.win) === 1 || g.win === true) wins += 1;
      gf += Number(g.gf) || 0;
      if (g.sf != null && isFinite(Number(g.sf))) {
        sf += Number(g.sf);
        shotGames += 1;
      }
    });
    return {
      gp: gp,
      wins: wins,
      winPct: round(wins / gp, 3),
      gfPerGame: round(gf / gp, 2),
      sogPerGame: shotGames === gp ? round(sf / gp, 1) : null,
      sogShare: pairShare(games, "mSf", "mSa"),
      xgfPct5v5: pairShare(games, "x5f", "x5a"),
      cfPct: pairShare(games, "mCf", "mCa")
    };
  }

  function seasonToDate(log, index) {
    var season = String(log[index].season);
    var slice = [];
    for (var i = 0; i <= index; i++) {
      if (String(log[i].season) === season) slice.push(log[i]);
    }
    return rate(slice);
  }

  function snapshots(games, currentSeason) {
    var log = (games || []).slice().sort(byGame);
    var currentGames = log.filter(function (g) {
      return String(g.season) === String(currentSeason);
    });
    function ago(k) {
      var index = log.length - 1 - k;
      if (index < 0) return null;
      return seasonToDate(log, index);
    }
    var out = {
      current: currentGames.length ? rate(currentGames) : null
    };
    AGO.forEach(function (k) { out["ago" + k] = ago(k); });
    return out;
  }

  function definition(currentLabel, previousLabel) {
    return "Win % is wins divided by games played; overtime and shootout losses count as losses. " +
      "GF/g is goals for per game and SOG/g is shots on goal per game, over the same games. " +
      "Shots-on-goal share is shots on goal for divided by shots for plus shots against, all situations. " +
      "Even-strength expected-goals share is 5-on-5 expected goals for divided by 5-on-5 expected goals for plus against. " +
      "Shot-attempt share is shot attempts for divided by shot attempts for plus against, all situations. " +
      "Each share is the season-to-date total of those counts, not an average of single-game shares. " +
      "A share is n/a when MoneyPuck has no count for any game in that span. " +
      "Current is the " + currentLabel + " regular season to date. " +
      "1, 5, 10, 15, and 20 games ago are that same season-to-date rate through the game that many games before the team’s most recent regular-season game. " +
      "The count spans the " + previousLabel + " and " + currentLabel + " regular seasons when this season is shorter; the rate uses only games from the season that cutoff game belongs to. " +
      "Playoffs and preseason are excluded. " +
      "Each column is shaded by that value’s percentile among the teams with a number in the same column. Higher is greener for every stat. Ties use the mid-rank. " +
      "n/a is not shaded and is left out of that column’s percentile. " +
      "The number under an ago value is current minus that ago value.";
  }

  return {
    rate: rate,
    snapshots: snapshots,
    definition: definition
  };
});
