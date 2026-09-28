(function () {
  "use strict";

  var state = { rows: [], sortKey: "wins", sortDir: -1, filters: {} };
  var NUMERIC = {
    wins: true, losses: true, otl: true, sogGp: true, sogaGp: true,
    l5w: true, l5l: true, l5ot: true, l5gfGp: true, l5gaGp: true
  };

  function $(id) { return document.getElementById(id); }

  function fmt(v, d) {
    if (v == null || v === "") return "—";
    return Number(v).toFixed(d);
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

  function render() {
    var rows = applyFilters(state.rows).slice();
    rows.sort(function (a, b) {
      var av = a[state.sortKey];
      var bv = b[state.sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * state.sortDir;
      }
      return String(av || "").localeCompare(String(bv || "")) * state.sortDir;
    });
    $("teams").querySelector("tbody").innerHTML = rows.map(function (r) {
      return "<tr>" +
        "<td>" + r.abbrev + "</td>" +
        "<td class='num'>" + (r.wins != null ? r.wins : "—") + "</td>" +
        "<td class='num'>" + (r.losses != null ? r.losses : "—") + "</td>" +
        "<td class='num'>" + (r.otl != null ? r.otl : "—") + "</td>" +
        "<td class='num'>" + fmt(r.sogGp, 1) + "</td>" +
        "<td class='num'>" + fmt(r.sogaGp, 1) + "</td>" +
        "<td class='num'>" + r.l5w + "</td>" +
        "<td class='num'>" + r.l5l + "</td>" +
        "<td class='num'>" + r.l5ot + "</td>" +
        "<td class='num'>" + fmt(r.l5gfGp, 2) + "</td>" +
        "<td class='num'>" + fmt(r.l5gaGp, 2) + "</td>" +
        "</tr>";
    }).join("") || "<tr><td colspan='11' class='empty'>No teams match.</td></tr>";
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

  fetch("/api/teams")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      state.rows = data.teams || [];
      $("meta").textContent = state.rows.length + " teams";
      render();
    })
    .catch(function (err) {
      $("meta").textContent = "Error";
      $("teams").querySelector("tbody").innerHTML =
        "<tr><td colspan='11' class='empty'>" + String(err.message || err) + "</td></tr>";
    });
})();
