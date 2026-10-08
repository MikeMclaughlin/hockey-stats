(function () {
  "use strict";

  var state = { raw: [], rows: [], sortKey: "wins", sortDir: -1, filters: {}, split: "all", through: null };
  var NUMERIC = {
    wins: true, losses: true, otl: true, sogGp: true, sogaGp: true,
    l5w: true, l5l: true, l5ot: true, l5gfGp: true, l5gaGp: true,
    ptsPct: true, goalDiff: true, pdo: true, l5pdo: true, b2bWinPct: true
  };
  var COLS = 16;

  function $(id) { return document.getElementById(id); }

  function fmt(v, d) {
    if (v == null || v === "") return "—";
    return Number(v).toFixed(d);
  }

  function viewRow(base) {
    var extra = state.split === "home" ? base.homeSplit : state.split === "away" ? base.awaySplit : null;
    if (!extra) return base;
    var pre = Object.assign({}, base.preseason || {});
    var extraPre = extra.preseason || {};
    pre.last5 = !!extraPre.last5;
    pre.l5pdo = !!extraPre.l5pdo;
    return Object.assign({}, base, {
      l5w: extra.l5w, l5l: extra.l5l, l5ot: extra.l5ot,
      l5gfGp: extra.l5gfGp, l5gaGp: extra.l5gaGp, l5pdo: extra.l5pdo,
      lastFive: extra.lastFive,
      preseason: pre
    });
  }

  function preHtml(on) {
    if (!on) return "";
    var label = state.preseasonLabel || "2026-27 preseason";
    return " <span class=\"pre\" title=\"" + String(label).replace(/"/g, "") + "\">pre</span>";
  }

  function numCell(v, pre) {
    return "<td class='num'>" + (v != null && v !== "" ? v : "—") + preHtml(pre) + "</td>";
  }

  function pdoCell(v, pre) {
    if (v == null || !isFinite(Number(v))) return "<td class='num'>—" + preHtml(pre) + "</td>";
    var n = Number(v);
    var cls = n > 100 ? "num num-pos" : n < 100 ? "num num-neg" : "num";
    return "<td class='" + cls + "'>" + n.toFixed(1) + preHtml(pre) + "</td>";
  }

  function b2bCell(r) {
    if (r.b2bWinPct == null || !r.b2bGames) return "<td class='num'>—</td>";
    var title = "Back-to-back second games " + r.b2bRecord + ". Overtime and shootout losses are not wins.";
    return "<td class='num' title=\"" + title.replace(/"/g, "") + "\">" +
      Number(r.b2bWinPct).toFixed(1) + "%<span class='b2b-rec'>" + r.b2bRecord + "</span></td>";
  }

  function applyFilters(rows) {
    return rows.filter(function (r) {
      return Object.keys(state.filters).every(function (k) {
        var raw = state.filters[k];
        if (!raw) return true;
        var val = r[k];
        if (NUMERIC[k]) {
          var spec = TableFilter.parseNumericFilter(raw);
          return TableFilter.matchNumeric(val, spec);
        }
        return TableFilter.matchText(val, raw);
      });
    });
  }

  function lastFiveHtml(list) {
    if (!list || !list.length) return "";
    return "<tr class='l5-detail'><td colspan='" + COLS + "'>" +
      list.map(function (g) {
        return (window.HockeyDates ? HockeyDates.formatTableDate(g.date) : (g.date || "")) + " " + (g.venue || "") + " vs " + (g.opponent || "") +
          " " + (g.score || "") + " " + (g.result || "") +
          (Number(g.gameType) === 1 ? " preseason" : "");
      }).join(" · ") + "</td></tr>";
  }

  function render() {
    var rows = applyFilters(state.rows.map(viewRow)).slice();
    rows.sort(function (a, b) {
      var av = a[state.sortKey];
      var bv = b[state.sortKey];
      var aNum = typeof av === "number" && isFinite(av);
      var bNum = typeof bv === "number" && isFinite(bv);
      if (aNum && bNum) return (av - bv) * state.sortDir;
      if (aNum !== bNum) return aNum ? -1 : 1;
      return String(av || "").localeCompare(String(bv || "")) * state.sortDir;
    });
    $("teams").querySelector("tbody").innerHTML = rows.map(function (r) {
      var pre = r.preseason || {};
      return "<tr data-team='" + r.abbrev + "'>" +
        "<td>" + r.abbrev + "</td>" +
        numCell(r.wins, pre.record) +
        numCell(r.losses, pre.record) +
        numCell(r.otl, pre.record) +
        numCell(r.ptsPct, pre.ptsPct) +
        numCell(r.goalDiff, pre.goalDiff) +
        "<td class='num'>" + fmt(r.sogGp, 1) + preHtml(pre.sog) + "</td>" +
        "<td class='num'>" + fmt(r.sogaGp, 1) + preHtml(pre.sog) + "</td>" +
        numCell(r.l5w, pre.last5) +
        numCell(r.l5l, pre.last5) +
        numCell(r.l5ot, pre.last5) +
        "<td class='num'>" + fmt(r.l5gfGp, 2) + preHtml(pre.last5) + "</td>" +
        "<td class='num'>" + fmt(r.l5gaGp, 2) + preHtml(pre.last5) + "</td>" +
        pdoCell(r.pdo, pre.pdo) +
        pdoCell(r.l5pdo, pre.l5pdo) +
        b2bCell(r) +
        "</tr>" + lastFiveHtml(state.open === r.abbrev ? r.lastFive : null);
    }).join("") || "<tr><td colspan='" + COLS + "' class='empty'>No teams match.</td></tr>";
    document.querySelectorAll("#teams tbody tr[data-team]").forEach(function (tr) {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", function () {
        var ab = tr.getAttribute("data-team");
        state.open = state.open === ab ? null : ab;
        render();
      });
    });
  }

  document.querySelectorAll("#teams th[data-key]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-key");
      if (state.sortKey === k) state.sortDir *= -1;
      else { state.sortKey = k; state.sortDir = NUMERIC[k] ? -1 : 1; }
      saveTeamFilters();
      render();
    });
  });
  var FILTER_KEY = "hockey-stats.teamFilters";

  function saveTeamFilters() {
    var saved = {
      filters: state.filters,
      split: state.split,
      sortKey: state.sortKey,
      sortDir: state.sortDir
    };
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify({
        filters: state.filters,
        split: state.split
      }));
    } catch (e) { /* private mode */ }
    if (window.HockeyPrefs && HockeyPrefs.signedIn()) HockeyPrefs.patch("teams", saved);
  }

  function restoreTeamFilters() {
    try {
      var raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && saved.filters) {
        state.filters = saved.filters;
        document.querySelectorAll("#teams input[data-filter]").forEach(function (inp) {
          var k = inp.getAttribute("data-filter");
          inp.value = saved.filters[k] || "";
        });
      }
      if (saved && saved.split && $("split")) {
        state.split = saved.split;
        $("split").value = saved.split;
      }
    } catch (e) { /* ignore a bad saved value */ }
  }

  function applySavedTeamView() {
    restoreTeamFilters();
    var remote = window.HockeyPrefs && HockeyPrefs.signedIn() && HockeyPrefs.section("teams");
    if (remote) {
      if (remote.filters) {
        state.filters = remote.filters;
        document.querySelectorAll("#teams input[data-filter]").forEach(function (inp) {
          var k = inp.getAttribute("data-filter");
          inp.value = remote.filters[k] || "";
        });
      }
      if (remote.split && $("split")) {
        state.split = remote.split;
        $("split").value = remote.split;
      }
      if (remote.sortKey) state.sortKey = remote.sortKey;
      if (remote.sortDir === 1 || remote.sortDir === -1) state.sortDir = remote.sortDir;
    } else if (window.HockeyPrefs && HockeyPrefs.signedIn()) {
      saveTeamFilters();
    }
  }
  document.querySelectorAll("#teams input[data-filter]").forEach(function (inp) {
    inp.addEventListener("input", function () {
      state.filters[inp.getAttribute("data-filter")] = inp.value;
      saveTeamFilters();
      render();
    });
  });
  if ($("split")) {
    $("split").addEventListener("change", function () {
      state.split = $("split").value;
      saveTeamFilters();
      render();
    });
  }

  function startTeams() {
    applySavedTeamView();
    fetch("/api/teams")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.rows = data.teams || [];
      state.preseasonLabel = data.preseasonLabel || "2026-27 preseason";
      $("meta").textContent = state.rows.length + " teams" +
        (data.statsSeasonLabel ? " · stats " + data.statsSeasonLabel : "") +
        (data.scoreboardSeasonLabel ? " · scoreboard " + data.scoreboardSeasonLabel : "") +
        (data.throughDate ? " · last-five through " + data.throughDate : "") +
        (data.formTypes && data.formTypes.length === 1 ? " · regular season form" : " · includes preseason form");
      var note = $("note");
      if (note) {
        note.textContent = data.note || "";
        note.classList.toggle("hidden", !data.note);
      }
      render();
    })
    .catch(function (err) {
      $("meta").textContent = "Error";
      $("teams").querySelector("tbody").innerHTML =
        "<tr><td colspan='" + COLS + "' class='empty'>" + String(err.message || err) + "</td></tr>";
    });
  }

  if (window.HockeyPrefs) HockeyPrefs.ready.then(startTeams);
  else startTeams();
})();
