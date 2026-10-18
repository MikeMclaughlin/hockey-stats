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

  function round(n, d) {
    var p = Math.pow(10, d == null ? 0 : d);
    return Math.round(n * p) / p;
  }

  function byGame(a, b) {
    var date = String(a.date || "").localeCompare(String(b.date || ""));
    if (date) return date;
    return Number(a.id) - Number(b.id);
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
      winPct: round((100 * wins) / gp, 1),
      gfPerGame: round(gf / gp, 2),
      sogPerGame: shotGames === gp ? round(sf / gp, 1) : null
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
    return {
      current: currentGames.length ? rate(currentGames) : null,
      ago10: ago(10),
      ago15: ago(15),
      ago20: ago(20)
    };
  }

  function definition(currentLabel, previousLabel) {
    return "Win % is wins divided by games played; overtime and shootout losses count as losses. " +
      "GF/g is goals for per game and SOG/g is shots on goal per game, over the same games. " +
      "Current is the " + currentLabel + " regular season to date. " +
      "10, 15, and 20 games ago are that same season-to-date rate through the game that many games before the team’s most recent regular-season game. " +
      "The count spans the " + previousLabel + " and " + currentLabel + " regular seasons when this season is shorter; the rate uses only games from the season that cutoff game belongs to. " +
      "Playoffs and preseason are excluded.";
  }

  return {
    rate: rate,
    snapshots: snapshots,
    definition: definition
  };
});
