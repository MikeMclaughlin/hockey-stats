(function () {
  "use strict";

  var STATS = {
    winPct: {
      label: "Win %",
      field: "winPct",
      digits: 1,
      suffix: "%",
      neutral: 1,
      full: 12,
      currentTitle: "Current win percentage, wins divided by games played. Overtime and shootout losses count as losses. Click to sort.",
      agoTitle: function (n) {
        return "Win percentage through the game " + n + " games before this team’s most recent regular-season game. Click to sort.";
      }
    },
    gf: {
      label: "GF/g",
      field: "gfPerGame",
      digits: 2,
      suffix: "",
      neutral: 0.1,
      full: 1.25,
      currentTitle: "Current goals for per game. Click to sort.",
      agoTitle: function (n) {
        return "Goals for per game through the game " + n + " games before this team’s most recent regular-season game. Click to sort.";
      }
    },
    sog: {
      label: "SOG/g",
      field: "sogPerGame",
      digits: 1,
      suffix: "",
      neutral: 0.5,
      full: 4,
      currentTitle: "Current shots on goal per game. Click to sort.",
      agoTitle: function (n) {
        return "Shots on goal per game through the game " + n + " games before this team’s most recent regular-season game. Click to sort.";
      }
    }
  };
  var AGO = { ago10: 10, ago15: 15, ago20: 20 };

  var state = { teams: [], stat: "winPct", sortKey: "current", sortDir: -1, definition: "" };

  function $(id) { return document.getElementById(id); }

  function spec() { return STATS[state.stat] || STATS.winPct; }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatValue(v) {
    if (v == null || !isFinite(Number(v))) return "n/a";
    return Number(v).toFixed(spec().digits) + spec().suffix;
  }

  function formatDelta(v) {
    if (v == null || !isFinite(Number(v))) return "";
    var n = Number(v);
    var text = n.toFixed(spec().digits);
    return (n > 0 ? "+" : "") + text;
  }

  function cellValue(team, key) {
    var snap = key === "current" ? team.current : team[key];
    if (!snap) return null;
    var v = snap[spec().field];
    if (v == null || !isFinite(Number(v))) return null;
    return Number(v);
  }

  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  function shade(delta) {
    if (delta == null || !isFinite(delta)) return "";
    var s = spec();
    var abs = Math.abs(delta);
    if (abs < s.neutral) return "background:#e6e9ed;color:#243140";
    var t = Math.min(1, (abs - s.neutral) / (s.full - s.neutral));
    var rgb = delta > 0
      ? mix([226, 244, 232], [47, 158, 90], t)
      : mix([252, 232, 232], [216, 86, 86], t);
    return "background:rgb(" + rgb.join(",") + ");color:#1b2836";
  }

  function agoCell(team, key) {
    var ago = cellValue(team, key);
    var current = cellValue(team, "current");
    if (ago == null) return "<td class='num trend-cell'>n/a</td>";
    var delta = current == null ? null : Math.round((current - ago) * 100) / 100;
    var deltaHtml = delta == null ? "" : "<span class='trend-delta'>" + esc(formatDelta(delta)) + "</span>";
    var style = delta == null ? "" : shade(delta);
    return "<td class='num trend-cell'" + (style ? " style=\"" + style + "\"" : "") + ">" +
      "<span class='trend-val'>" + esc(formatValue(ago)) + "</span>" + deltaHtml + "</td>";
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
    var rows = sorted();
    body.innerHTML = rows.map(function (team) {
      var current = cellValue(team, "current");
      return "<tr>" +
        teamCell(team) +
        "<td class='num trend-cell'><span class='trend-val'>" + esc(formatValue(current)) + "</span></td>" +
        agoCell(team, "ago10") +
        agoCell(team, "ago15") +
        agoCell(team, "ago20") +
        "</tr>";
    }).join("") || "<tr><td colspan='5' class='empty'>No teams.</td></tr>";
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
        state.teams = data.teams || [];
        state.definition = data.definition || state.definition;
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
