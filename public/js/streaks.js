(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyStreaks = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CATEGORIES = [
    { key: "goals", label: "Goals", field: "goals", defaultMin: 1 },
    { key: "assists", label: "Assists", field: "assists", defaultMin: 1 },
    { key: "points", label: "Points", field: "points", defaultMin: 1 },
    { key: "attempts", label: "Shot attempts", field: "attempts", defaultMin: 3 },
    { key: "sog", label: "Shots on goal", field: "sog", defaultMin: 3 }
  ];

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function playerName(p) {
    if (!p) return "";
    if (typeof p.name === "string") return p.name;
    if (p.name && p.name.default) return p.name.default;
    if (p.firstName && p.lastName) {
      return (p.firstName.default || p.firstName) + " " + (p.lastName.default || p.lastName);
    }
    return String(p.playerId || "");
  }

  function skaterRow(p, team, gameId, gameDate) {
    var sog = num(p.sog != null ? p.sog : p.shots);
    var missed = num(p.missedShots);
    var blocked = num(p.blockedShots);
    var attempts = p.shotAttempts != null ? num(p.shotAttempts) : sog + missed + blocked;
    var g = num(p.goals);
    var a = num(p.assists);
    return {
      playerId: p.playerId,
      name: playerName(p),
      team: team,
      gameId: gameId,
      gameDate: gameDate,
      goals: g,
      assists: a,
      points: p.points != null ? num(p.points) : g + a,
      sog: sog,
      attempts: attempts
    };
  }

  function collectTeam(list, abbrev, gameId, gameDate) {
    var out = [];
    (list || []).forEach(function (p) {
      if (!p || p.playerId == null) return;
      out.push(skaterRow(p, abbrev, gameId, gameDate));
    });
    return out;
  }

  function parseBoxscore(box) {
    if (!box) return [];
    var gameId = box.id || (box.game && box.game.id);
    var gameDate = box.gameDate || (box.game && box.game.gameDate);
    var awayAb = box.awayTeam && box.awayTeam.abbrev;
    var homeAb = box.homeTeam && box.homeTeam.abbrev;
    var stats = box.playerByGameStats || {};
    var away = stats.awayTeam || {};
    var home = stats.homeTeam || {};
    return []
      .concat(collectTeam(away.forwards, awayAb, gameId, gameDate))
      .concat(collectTeam(away.defense, awayAb, gameId, gameDate))
      .concat(collectTeam(home.forwards, homeAb, gameId, gameDate))
      .concat(collectTeam(home.defense, homeAb, gameId, gameDate));
  }

  function groupByPlayer(rows) {
    var map = Object.create(null);
    (rows || []).forEach(function (r) {
      if (!r || r.playerId == null) return;
      var k = String(r.playerId);
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    Object.keys(map).forEach(function (k) {
      map[k].sort(function (a, b) {
        return String(b.gameDate || "").localeCompare(String(a.gameDate || "")) ||
          Number(b.gameId) - Number(a.gameId);
      });
    });
    return map;
  }

  function streakForPlayer(games, field, min, length) {
    if (!games || games.length < length) return null;
    var window = games.slice(0, length);
    var total = 0;
    for (var i = 0; i < window.length; i++) {
      var v = num(window[i][field]);
      if (v < min) return null;
      total += v;
    }
    var first = window[0];
    return {
      playerId: first.playerId,
      name: first.name,
      team: first.team,
      length: length,
      min: min,
      total: total,
      avg: Math.round((total / length) * 100) / 100,
      from: window[window.length - 1].gameDate,
      to: window[0].gameDate,
      line: window.map(function (g) { return g[field]; }).join(", ")
    };
  }

  function buildTables(rows, opts) {
    opts = opts || {};
    var length = Math.max(1, Number(opts.length) || 5);
    var grouped = groupByPlayer(rows);
    var tables = {};
    CATEGORIES.forEach(function (cat) {
      var minKey = "min" + cat.key.charAt(0).toUpperCase() + cat.key.slice(1);
      var min = opts[minKey];
      if (min == null) min = opts.min != null ? opts.min : cat.defaultMin;
      min = Number(min);
      if (!isFinite(min)) min = cat.defaultMin;
      var list = [];
      Object.keys(grouped).forEach(function (id) {
        var hit = streakForPlayer(grouped[id], cat.field, min, length);
        if (hit) list.push(hit);
      });
      list.sort(function (a, b) {
        return b.total - a.total || String(a.name).localeCompare(String(b.name));
      });
      tables[cat.key] = { key: cat.key, label: cat.label, field: cat.field, min: min, length: length, rows: list };
    });
    return { length: length, tables: tables };
  }

  return {
    CATEGORIES: CATEGORIES,
    parseBoxscore: parseBoxscore,
    groupByPlayer: groupByPlayer,
    streakForPlayer: streakForPlayer,
    buildTables: buildTables
  };
});
