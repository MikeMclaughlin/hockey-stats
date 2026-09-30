(function () {
  "use strict";

  var state = { raw: [], rows: [], sortKey: "wins", sortDir: -1, filters: {}, split: "all", through: null };
  var NUMERIC = {
    wins: true, losses: true, otl: true, sogGp: true, sogaGp: true,
    l5w: true, l5l: true, l5ot: true, l5gfGp: true, l5gaGp: true,
    ptsPct: true, goalDiff: true
  };

  function $(id) { return document.getElementById(id); }

  function fmt(v, d) {
    if (v == null || v === "") return "—";
    return Number(v).toFixed(d);
  }

  function viewRow(base) {
    var extra = state.split === "home" ? base.homeSplit : state.split === "away" ? base.awaySplit : null;
    if (!extra) return base;
    return Object.assign({}, base, {
      l5w: extra.l5w, l5l: extra.l5l, l5ot: extra.l5ot,
      l5gfGp: extra.l5gfGp, l5gaGp: extra.l5gaGp, lastFive: extra.lastFive
    });
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
    return "<tr class='l5-detail'><td colspan='13'>" +
      list.map(function (g) {
        return (g.date || "") + " " + (g.venue || "") + " vs " + (g.opponent || "") +
          " " + (g.score || "") + " " + (g.result || "") +
          (Number(g.gameType) === 1 ? " preseason" : "");
      }).join(" · ") + "</td></tr>";
  }

  function render() {
    var rows = applyFilters(state.rows.map(viewRow)).slice();
    rows.sort(function (a, b) {
      var av = a[state.sortKey];
      var bv = b[state.sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * state.sortDir;
      }
      return String(av || "").localeCompare(String(bv || "")) * state.sortDir;
    });
    $("teams").querySelector("tbody").innerHTML = rows.map(function (r) {
      return "<tr data-team='" + r.abbrev + "'>" +
        "<td>" + r.abbrev + "</td>" +
        "<td class='num'>" + (r.wins != null ? r.wins : "—") + "</td>" +
        "<td class='num'>" + (r.losses != null ? r.losses : "—") + "</td>" +
        "<td class='num'>" + (r.otl != null ? r.otl : "—") + "</td>" +
        "<td class='num'>" + (r.ptsPct != null ? r.ptsPct : "—") + "</td>" +
        "<td class='num'>" + (r.goalDiff != null ? r.goalDiff : "—") + "</td>" +
        "<td class='num'>" + fmt(r.sogGp, 1) + "</td>" +
        "<td class='num'>" + fmt(r.sogaGp, 1) + "</td>" +
        "<td class='num'>" + r.l5w + "</td>" +
        "<td class='num'>" + r.l5l + "</td>" +
        "<td class='num'>" + r.l5ot + "</td>" +
        "<td class='num'>" + fmt(r.l5gfGp, 2) + "</td>" +
        "<td class='num'>" + fmt(r.l5gaGp, 2) + "</td>" +
        "</tr>" + lastFiveHtml(state.open === r.abbrev ? r.lastFive : null);
    }).join("") || "<tr><td colspan='13' class='empty'>No teams match.</td></tr>";
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
      render();
    });
  });
  document.querySelectorAll("#teams input[data-filter]").forEach(function (inp) {
    inp.addEventListener("input", function () {
      state.filters[inp.getAttribute("data-filter")] = inp.value;
      render();
    });
  });
  if ($("split")) {
    $("split").addEventListener("change", function () {
      state.split = $("split").value;
      render();
    });
  }

  fetch("/api/teams")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.rows = data.teams || [];
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
        "<tr><td colspan='13' class='empty'>" + String(err.message || err) + "</td></tr>";
    });
})();
