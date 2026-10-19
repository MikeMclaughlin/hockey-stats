(function () {
  "use strict";

  function gamesBefore(n) {
    return n === 1 ? "1 game" : n + " games";
  }

  var STATS = {
    winPct: {
      label: "Win %",
      field: "winPct",
      digits: 3,
      share: true,
      currentTitle: "Current win percentage, wins divided by games played. Overtime and shootout losses count as losses. Click to sort.",
      agoTitle: function (n) {
        return "Win percentage through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Click to sort.";
      }
    },
    gf: {
      label: "GF/g",
      field: "gfPerGame",
      digits: 2,
      share: false,
      currentTitle: "Current goals for per game. Click to sort.",
      agoTitle: function (n) {
        return "Goals for per game through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Click to sort.";
      }
    },
    sog: {
      label: "SOG/g",
      field: "sogPerGame",
      digits: 1,
      share: false,
      currentTitle: "Current shots on goal per game. Click to sort.",
      agoTitle: function (n) {
        return "Shots on goal per game through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Click to sort.";
      }
    },
    sogShare: {
      label: "Shots-on-goal share",
      field: "sogShare",
      digits: 3,
      share: true,
      currentTitle: "Current shots-on-goal share, shots on goal for divided by shots for plus shots against, all situations. Click to sort.",
      agoTitle: function (n) {
        return "Shots-on-goal share through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Click to sort.";
      }
    },
    xgfPct5v5: {
      label: "Even-strength expected-goals share",
      field: "xgfPct5v5",
      digits: 3,
      share: true,
      currentTitle: "Current even-strength expected-goals share, 5-on-5 expected goals for divided by 5-on-5 expected goals for plus against. Click to sort.",
      agoTitle: function (n) {
        return "Even-strength expected-goals share through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Click to sort.";
      }
    },
    cfPct: {
      label: "Shot-attempt share",
      field: "cfPct",
      digits: 3,
      share: true,
      currentTitle: "Current shot-attempt share, shot attempts for divided by shot attempts for plus against, all situations. Click to sort.",
      agoTitle: function (n) {
        return "Shot-attempt share through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Click to sort.";
      }
    },
    ga: {
      label: "GA/g",
      field: "gaPerGame",
      digits: 2,
      share: false,
      lowerBetter: true,
      currentTitle: "Current goals against per game. Lower is better. Click to sort.",
      agoTitle: function (n) {
        return "Goals against per game through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Lower is better. Click to sort.";
      }
    },
    sogAgainst: {
      label: "SOG-against share",
      field: "sogAgainstShare",
      digits: 3,
      share: true,
      lowerBetter: true,
      currentTitle: "Current shots-on-goal against share, shots against divided by shots for plus shots against, all situations. Lower is better. Click to sort.",
      agoTitle: function (n) {
        return "Shots-on-goal against share through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Lower is better. Click to sort.";
      }
    },
    xgaPct5v5: {
      label: "5v5 expected-goals-against share",
      field: "xgaPct5v5",
      digits: 3,
      share: true,
      lowerBetter: true,
      currentTitle: "Current 5-on-5 expected-goals-against share, expected goals against divided by expected goals for plus against. Lower is better. Click to sort.",
      agoTitle: function (n) {
        return "5-on-5 expected-goals-against share through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Lower is better. Click to sort.";
      }
    },
    caPct: {
      label: "Shot-attempt-against share",
      field: "caPct",
      digits: 3,
      share: true,
      lowerBetter: true,
      currentTitle: "Current shot-attempt against share, shot attempts against divided by shot attempts for plus against, all situations. Lower is better. Click to sort.",
      agoTitle: function (n) {
        return "Shot-attempt against share through the game " + gamesBefore(n) + " before this team’s most recent regular-season game. Lower is better. Click to sort.";
      }
    }
  };
  var AGO = { ago1: 1, ago5: 5, ago10: 10, ago15: 15, ago20: 20 };
  var COLUMNS = ["current", "ago1", "ago5", "ago10", "ago15", "ago20"];

  var state = { teams: [], stat: "winPct", sortKey: "current", sortDir: -1, definition: "", earlyDeltaGp: 21 };

  function $(id) { return document.getElementById(id); }

  function spec() { return STATS[state.stat] || STATS.winPct; }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatShare(n) {
    var text = Number(n).toFixed(spec().digits);
    if (text.charAt(0) === "-" && text.charAt(1) === "0" && text.charAt(2) === ".") return "-" + text.slice(2);
    if (text.charAt(0) === "0" && text.charAt(1) === ".") return text.slice(1);
    return text;
  }

  function formatValue(v) {
    if (v == null || !isFinite(Number(v))) return "n/a";
    if (spec().share) return formatShare(v);
    return Number(v).toFixed(spec().digits);
  }

  function formatDelta(v) {
    if (v == null || !isFinite(Number(v))) return "";
    var n = Number(v);
    var text = spec().share ? formatShare(n) : n.toFixed(spec().digits);
    return (n > 0 ? "+" : "") + text;
  }

  function cellValue(team, key) {
    var snap = key === "current" ? team.current : team[key];
    if (!snap) return null;
    var v = snap[spec().field];
    if (v == null || !isFinite(Number(v))) return null;
    return Number(v);
  }

  function columnPools() {
    var pools = {};
    COLUMNS.forEach(function (key) {
      var values = [];
      state.teams.forEach(function (team) {
        var value = cellValue(team, key);
        if (value != null) values.push(value);
      });
      pools[key] = values;
    });
    return pools;
  }

  // Mid-rank percentile on a 0–100 scale. Band 0 is the top sixth.
  // lowerBetter flips the rank so a smaller number is greener.
  function bandClass(value, pool, lowerBetter) {
    if (value == null || !pool || !pool.length) return "";
    var below = 0;
    var equal = 0;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i] < value) below += 1;
      else if (pool[i] === value) equal += 1;
    }
    var percentile = (100 * (below + 0.5 * equal)) / pool.length;
    if (lowerBetter) percentile = 100 - percentile;
    var index = Math.min(5, Math.floor((100 - percentile) / (100 / 6)));
    return " band-" + index;
  }

  function valueCell(team, key, pools, withDelta) {
    var value = cellValue(team, key);
    if (value == null) return "<td class='num trend-cell'>n/a</td>";
    var deltaHtml = "";
    if (withDelta) {
      var current = cellValue(team, "current");
      var gp = team.current && team.current.gp;
      var early = gp != null && gp < state.earlyDeltaGp;
      var baseline = early ? cellValue(team, "ago1") : value;
      if (current != null && baseline != null) {
        var factor = Math.pow(10, spec().digits);
        var delta = Math.round((current - baseline) * factor) / factor;
        deltaHtml = "<span class='trend-delta'>" + esc(formatDelta(delta)) + "</span>";
      }
    }
    return "<td class='num trend-cell" + bandClass(value, pools[key], spec().lowerBetter) + "'>" +
      "<span class='trend-val'>" + esc(formatValue(value)) + "</span>" + deltaHtml + "</td>";
  }

  function teamCell(team) {
    var logo = team.logo ? "<img src=\"" + esc(team.logo) + "\" alt=\"\">" : "";
    return "<td><div class='trend-team'>" + logo +
      "<span class='trend-ab'>" + esc(team.abbrev) + "</span>" +
      "<span class='trend-name'>" + esc(team.name) + "</span></div></td>";
  }

  function sorted() {
    var key = state.sortKey;
    var dir = state.sortDir;
    return state.teams.slice().sort(function (a, b) {
      if (key === "team") return String(a.abbrev || "").localeCompare(String(b.abbrev || "")) * dir;
      var av = cellValue(a, key);
      var bv = cellValue(b, key);
      if (av == null && bv == null) return String(a.abbrev).localeCompare(String(b.abbrev));
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return String(a.abbrev).localeCompare(String(b.abbrev));
      return av > bv ? dir : -dir;
    });
  }

  function syncHeaders() {
    var s = spec();
    document.querySelectorAll("#trends thead th").forEach(function (th) {
      var key = th.getAttribute("data-key");
      var title = th.getAttribute("title");
      if (key === "current") title = s.currentTitle;
      else if (AGO[key]) title = s.agoTitle(AGO[key]);
      if (title) {
        th.setAttribute("title", title);
        th.setAttribute("aria-label", title);
      }
      th.classList.remove("sort-asc", "sort-desc");
      if (key === state.sortKey) th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
    });
  }

  function render() {
    var body = $("trends").querySelector("tbody");
    var pools = columnPools();
    var rows = sorted();
    body.innerHTML = rows.map(function (team) {
      return "<tr>" +
        teamCell(team) +
        valueCell(team, "current", pools, false) +
        valueCell(team, "ago1", pools, true) +
        valueCell(team, "ago5", pools, true) +
        valueCell(team, "ago10", pools, true) +
        valueCell(team, "ago15", pools, true) +
        valueCell(team, "ago20", pools, true) +
        "</tr>";
    }).join("") || "<tr><td colspan='7' class='empty'>No teams.</td></tr>";
    syncHeaders();
    var def = $("definition");
    if (def && state.definition) def.textContent = state.definition;
  }

  document.querySelectorAll("#trends thead th[data-key]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (state.sortKey === key) state.sortDir *= -1;
      else {
        state.sortKey = key;
        state.sortDir = key === "team" ? 1 : -1;
      }
      render();
    });
  });

  var statSelect = $("stat");
  if (statSelect) {
    statSelect.addEventListener("change", function () {
      state.stat = statSelect.value;
      if (!STATS[state.stat]) state.stat = "winPct";
      if (state.sortKey !== "team") state.sortDir = spec().lowerBetter ? 1 : -1;
      render();
    });
  }

  function load() {
    if (window.HockeyLoading) HockeyLoading.show();
    fetch("/api/trends")
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok || (body && body.error && !body.teams)) {
            throw new Error((body && body.error) || ("HTTP " + r.status));
          }
          return body;
        }, function () {
          throw new Error(r.ok ? "Invalid response" : ("HTTP " + r.status));
        });
      })
      .then(function (data) {
        var nextTeams = data.teams || [];
        if (nextTeams.length || !state.teams.length) state.teams = nextTeams;
        state.definition = data.definition || state.definition;
        if (data.earlyDeltaGp != null && isFinite(Number(data.earlyDeltaGp))) {
          state.earlyDeltaGp = Number(data.earlyDeltaGp);
        }
        var through = data.throughDate || "";
        $("meta").textContent = state.teams.length + " teams" +
          (data.currentSeasonLabel ? " · " + data.currentSeasonLabel : "") +
          (through ? " · through " + through : "");
        render();
      })
      .catch(function (err) {
        var message = (err && err.message) || String(err);
        if (state.teams.length) {
          $("meta").textContent = "Refresh failed. Showing the previous table. " + message;
        } else {
          $("meta").textContent = "Could not load team trends. " + message;
        }
      })
      .then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
  }

  load();
})();
