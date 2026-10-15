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
    { key: "sog", label: "Shots on goal", field: "sog", defaultMin: 3 },
    { key: "goalieSv", label: "Goaltender save percentage", field: "svPct", defaultMin: 90, goalie: true }
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

  function skaterRow(p, team, gameId, gameDate, gameType) {
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
      position: p.positionCode || p.position || "",
      sweater: p.sweaterNumber != null ? p.sweaterNumber : "",
      role: "skater",
      gameId: gameId,
      gameDate: gameDate,
      gameType: gameType,
      goals: g,
      assists: a,
      points: p.points != null ? num(p.points) : g + a,
      sog: sog,
      attempts: attempts
    };
  }

  function goalieRow(p, team, gameId, gameDate, gameType) {
    var sa = num(p.shotsAgainst != null ? p.shotsAgainst : p.evenShotsAgainst);
    var ga = num(p.goalsAgainst);
    var svPct = sa ? Math.round(1000 * (sa - ga) / sa) / 10 : null;
    return {
      playerId: p.playerId,
      name: playerName(p),
      team: team,
      position: "G",
      sweater: p.sweaterNumber != null ? p.sweaterNumber : "",
      role: "goalie",
      gameId: gameId,
      gameDate: gameDate,
      gameType: gameType,
      goals: 0,
      assists: 0,
      points: 0,
      sog: 0,
      attempts: 0,
      sa: sa,
      ga: ga,
      svPct: svPct
    };
  }

  function collectTeam(list, abbrev, gameId, gameDate, gameType, role) {
    var out = [];
    (list || []).forEach(function (p) {
      if (!p || p.playerId == null) return;
      out.push(role === "goalie"
        ? goalieRow(p, abbrev, gameId, gameDate, gameType)
        : skaterRow(p, abbrev, gameId, gameDate, gameType));
    });
    return out;
  }

  function parseBoxscore(box) {
    if (!box) return [];
    var gameId = box.id || (box.game && box.game.id);
    var gameDate = box.gameDate || (box.game && box.game.gameDate);
    var awayAb = box.awayTeam && box.awayTeam.abbrev;
    var homeAb = box.homeTeam && box.homeTeam.abbrev;
    var gameType = box.gameType;
    var stats = box.playerByGameStats || {};
    var away = stats.awayTeam || {};
    var home = stats.homeTeam || {};
    return []
      .concat(collectTeam(away.forwards, awayAb, gameId, gameDate, gameType, "skater"))
      .concat(collectTeam(away.defense, awayAb, gameId, gameDate, gameType, "skater"))
      .concat(collectTeam(away.goalies, awayAb, gameId, gameDate, gameType, "goalie"))
      .concat(collectTeam(home.forwards, homeAb, gameId, gameDate, gameType, "skater"))
      .concat(collectTeam(home.defense, homeAb, gameId, gameDate, gameType, "skater"))
      .concat(collectTeam(home.goalies, homeAb, gameId, gameDate, gameType, "goalie"));
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
    if (!games || !games.length) return null;
    var incomplete = games.length < length;
    var window = games.slice(0, Math.min(length, games.length));
    if (!window.length) return null;
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
      position: first.position,
      sweater: first.sweater,
      nhlUrl: "https://www.nhl.com/player/" + first.playerId,
      length: window.length,
      asked: length,
      incomplete: incomplete,
      min: min,
      total: field === "svPct" ? Math.round((total / window.length) * 10) / 10 : total,
      avg: Math.round((total / window.length) * 100) / 100,
      from: window[window.length - 1].gameDate,
      to: window[0].gameDate,
      line: window.map(function (g) { return g[field]; }).join(", "),
      games: window.slice().reverse().map(function (g) {
        return { value: g[field], date: g.gameDate };
      })
    };
  }

  function maxPlayerGames(rows) {
    var counts = Object.create(null);
    (rows || []).forEach(function (r) {
      if (!r || r.playerId == null) return;
      var k = String(r.playerId) + ":" + (r.role || "skater");
      counts[k] = (counts[k] || 0) + 1;
    });
    var max = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > max) max = counts[k];
    });
    return max;
  }

  function defaultLength(maxGames) {
    if (maxGames >= 5) return 5;
    if (maxGames >= 3) return 3;
    if (maxGames >= 2) return 2;
    if (maxGames >= 1) return 1;
    return 5;
  }

  /**
   * Near opening night a 5-game minimum matches nobody. Shorten unless the
   * caller passed strict=1 with an explicit length.
   */
  function resolveLength(rows, requested, opts) {
    opts = opts || {};
    requested = Math.max(1, Math.min(15, Number(requested) || 5));
    var maxGames = maxPlayerGames(rows);
    var early = maxGames > 0 && maxGames < 5;
    var softened = false;
    var length = requested;
    var allow = !opts.strict && opts.explicit !== true;
    if (early && allow) {
      length = defaultLength(maxGames);
      softened = length !== requested;
    }
    return {
      length: length,
      requested: requested,
      early: early,
      softened: softened,
      maxGames: maxGames
    };
  }

  function emptyHint(plan) {
    plan = plan || {};
    if (plan.early || plan.softened || (plan.maxGames > 0 && plan.maxGames < 5)) {
      return "No players meet this streak yet. The season is just underway — most skaters have only " +
        (plan.maxGames || 0) + " logged game" + (plan.maxGames === 1 ? "" : "s") +
        ". Length was eased to " + (plan.length || 1) +
        " (the default of 5 is too long this early). Lower the per-game minimum if the table is still empty.";
    }
    if (!plan.maxGames) {
      return "No boxscores are cached yet, so there is nothing to streak. Reload after a few games are final.";
    }
    return "No players have hit this minimum in each of the last " + (plan.length || 5) +
      " games. Shorten the streak or lower the minimum.";
  }

  function buildTables(rows, opts) {
    opts = opts || {};
    var length = Math.max(1, Number(opts.length) || 5);
    var preferRegular = !!opts.preferRegular;
    var activeOnly = !!opts.activeOnly;
    var rowsUse = (rows || []).filter(function (r) {
      if (preferRegular && Number(r.gameType) === 1) return false;
      return true;
    });
    var latest = "";
    rowsUse.forEach(function (r) {
      if (r.gameDate && r.gameDate > latest) latest = r.gameDate;
    });
    var grouped = groupByPlayer(rowsUse);
    var tables = {};
    CATEGORIES.forEach(function (cat) {
      var minKey = "min" + cat.key.charAt(0).toUpperCase() + cat.key.slice(1);
      var min = opts[minKey];
      if (min == null) min = opts.min != null ? opts.min : cat.defaultMin;
      min = Number(min);
      if (!isFinite(min)) min = cat.defaultMin;
      var list = [];
      Object.keys(grouped).forEach(function (id) {
        var games = grouped[id].filter(function (g) {
          if (cat.goalie) return g.role === "goalie";
          return g.role !== "goalie";
        });
        if (activeOnly && latest && games[0] && games[0].gameDate < latest) {
          var latestDay = Date.parse(latest);
          var last = Date.parse(games[0].gameDate);
          if (isFinite(latestDay) && isFinite(last) && latestDay - last > 4 * 86400000) return;
        }
        var hit = streakForPlayer(games, cat.field, min, length);
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
    buildTables: buildTables,
    resolveLength: resolveLength,
    emptyHint: emptyHint,
    maxPlayerGames: maxPlayerGames
  };
});
