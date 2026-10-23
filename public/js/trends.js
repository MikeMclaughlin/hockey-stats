(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyTrends = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Games-ago definition:
  // Current is the current regular season to date. N games ago is that
  // same season-to-date rate through the current-season game N places
  // before the team's most recent current-season game. Earlier seasons
  // are not included. The shared columns are 1 game ago, then every
  // second game (2, 4, 6, …) that still lands inside the current season
  // for at least one team.
  // Win % is wins / games played. A win is any game the team outscored the
  // opponent, including overtime and shootouts. Overtime and shootout losses
  // are not wins, so they count as losses. Ties are not wins.
  //
  // Share stats use the same situation split as public/js/stats.js:
  // shots-on-goal share and shot-attempt share are all situations;
  // even-strength expected-goals share is 5-on-5. Each share is
  // sum(for) / (sum(for) + sum(against)) over the games in the span
  // that have a MoneyPuck count. Games without one are skipped.
  // Shooting plus save percentage (PDO) is goals for / MoneyPuck shots
  // for, plus (shots against − goals against) / shots against, over the
  // games in the span that have those counts.
  // A share is null only when none of those games have a count.

  // Kept so older callers that read the constant still resolve. The delta
  // line under each cell is no longer shown.
  var EARLY_DELTA_GP = 21;

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
    var used = 0;
    for (var i = 0; i < games.length; i++) {
      var game = games[i];
      var fv = game[forKey];
      var av = game[againstKey];
      if (fv == null || av == null || !isFinite(Number(fv)) || !isFinite(Number(av))) continue;
      f += Number(fv);
      a += Number(av);
      used += 1;
    }
    if (!used || !(f + a > 0)) return null;
    return round(f / (f + a), 3);
  }

  function rate(games) {
    if (!games || !games.length) return null;
    var gp = games.length;
    var wins = 0;
    var gf = 0;
    var ga = 0;
    var gaGames = 0;
    var sf = 0;
    var shotGames = 0;
    games.forEach(function (g) {
      if (Number(g.win) === 1 || g.win === true) wins += 1;
      gf += Number(g.gf) || 0;
      if (g.ga != null && isFinite(Number(g.ga))) {
        ga += Number(g.ga);
        gaGames += 1;
      }
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
      gaPerGame: gaGames === gp ? round(ga / gp, 2) : null,
      sogPerGame: shotGames === gp ? round(sf / gp, 1) : null,
      sogShare: pairShare(games, "mSf", "mSa"),
      sogAgainstShare: pairShare(games, "mSa", "mSf"),
      xgfPct5v5: pairShare(games, "x5f", "x5a"),
      xgaPct5v5: pairShare(games, "x5a", "x5f"),
      cfPct: pairShare(games, "mCf", "mCa"),
      caPct: pairShare(games, "mCa", "mCf"),
      pdo: pdoOf(games)
    };
  }

  function pdoOf(games) {
    var gf = 0;
    var ga = 0;
    var sf = 0;
    var sa = 0;
    var used = 0;
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      if (g.mSf == null || g.mSa == null || !isFinite(Number(g.mSf)) || !isFinite(Number(g.mSa))) continue;
      if (!(Number(g.mSf) > 0) || !(Number(g.mSa) > 0)) continue;
      if (g.gf == null || g.ga == null || !isFinite(Number(g.gf)) || !isFinite(Number(g.ga))) continue;
      gf += Number(g.gf) || 0;
      ga += Number(g.ga) || 0;
      sf += Number(g.mSf);
      sa += Number(g.mSa);
      used += 1;
    }
    if (!used || !sf || !sa) return null;
    return round((gf / sf) + ((sa - ga) / sa), 3);
  }

  // Every completed game this season: 1, 2, 3, … while the offset is still
  // inside the longest current-season log (k < max games played).
  function agoOffsets(maxGp) {
    var gp = Number(maxGp);
    if (!isFinite(gp) || gp < 0) gp = 0;
    var list = [];
    for (var k = 1; k < gp; k += 1) list.push(k);
    return list;
  }

  function snapshots(games, currentSeason, offsets) {
    var log = (games || []).slice().sort(byGame);
    var currentGames = log.filter(function (g) {
      return String(g.season) === String(currentSeason);
    });
    var list = offsets && offsets.length ? offsets.slice() : agoOffsets(currentGames.length);
    var ago = {};
    list.forEach(function (k) {
      var n = Number(k);
      var index = currentGames.length - 1 - n;
      ago[String(n)] = index < 0 ? null : rate(currentGames.slice(0, index + 1));
    });
    return {
      current: currentGames.length ? rate(currentGames) : null,
      ago: ago,
      offsets: list,
      gp: currentGames.length
    };
  }

  function definition(currentLabel) {
    return "Win % is wins divided by games played; overtime and shootout losses count as losses. " +
      "GF/g is goals for per game and SOG/g is shots on goal per game, over the same games. " +
      "Shots-on-goal share is shots on goal for divided by shots for plus shots against, all situations. " +
      "Even-strength expected-goals share is 5-on-5 expected goals for divided by 5-on-5 expected goals for plus against. " +
      "Shot-attempt share is shot attempts for divided by shot attempts for plus against, all situations. " +
      "Shooting plus save percentage is shooting percentage plus save percentage: goals for divided by shots on goal, plus shots against minus goals against divided by shots against. It is shown to three decimals. " +
      "GA/g is goals against per game. " +
      "Shots-on-goal against share, 5-on-5 expected-goals-against share, and shot-attempt against share use the same spans with the against count in the numerator. " +
      "Each share sums those counts over the games in that span that MoneyPuck has published, not an average of single-game shares. " +
      "A share is n/a only when that span has no MoneyPuck game. " +
      "MoneyPuck can lag the NHL log by a game. " +
      "Current is the " + currentLabel + " regular season to date. " +
      "1, 2, 3, 4, and so on games ago is that same season-to-date rate through the game that many games before the team’s most recent " + currentLabel + " regular-season game. " +
      "n/a means that team has not played that many " + currentLabel + " games. " +
      "The count stops at the first game of " + currentLabel + ". Earlier seasons are not used. " +
      "A column is shown when at least one team has played more games than that offset. " +
      "Playoffs and preseason are excluded. " +
      "Each column is shaded by that value’s percentile among the teams with a number in the same column. " +
      "Higher is greener for win percentage, goals for, shots on goal, the for-shares, and shooting plus save percentage. " +
      "Lower is greener for goals against and the against-shares. Ties use the mid-rank. " +
      "n/a is not shaded and is left out of that column’s percentile.";
  }

  return {
    EARLY_DELTA_GP: EARLY_DELTA_GP,
    agoOffsets: agoOffsets,
    rate: rate,
    snapshots: snapshots,
    definition: definition
  };
});
