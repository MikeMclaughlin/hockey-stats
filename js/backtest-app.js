(function () {
  "use strict";

  var state = { rows: [], sortKey: "gameDate", sortDir: 1, filters: {} };
  var NUMERIC = { totalErr: true };

  function $(id) { return document.getElementById(id); }

  function verdictOf(r) {
    if (HockeyArchive && HockeyArchive.verdict) return HockeyArchive.verdict(r);
    if (!r.graded) return "pending";
    if (r.correct) return "exact";
    if (r.winnerCorrect) return "winner";
    return "miss";
  }

  function label(v) {
    if (v === "exact") return "Exact";
    if (v === "winner") return "Winner only";
    if (v === "miss") return "Miss";
    return "Pending";
  }

  function rowValue(r, key) {
    if (key === "verdict") return verdictOf(r);
    if (key === "totalErr") return r.totalErr == null ? 99 : r.totalErr;
    return r[key] == null ? "" : r[key];
  }

  function displayOf(r) {
    var v = verdictOf(r);
    return {
      gameDate: r.gameDate || "",
      awayAbbrev: r.awayAbbrev,
      homeAbbrev: r.homeAbbrev,
      projectedLabel: r.projectedLabel,
      actualLabel: r.actualLabel,
      verdict: label(v),
      totalErr: r.totalErr
    };
  }

  function filteredRows() {
    return state.rows.filter(function (r) {
      return TableFilter.rowMatches(displayOf(r), state.filters, NUMERIC);
    });
  }

  function render() {
    var rows = filteredRows().slice().sort(function (a, b) {
      var av = rowValue(a, state.sortKey);
      var bv = rowValue(b, state.sortKey);
      if (typeof av === "number" && typeof bv === "number") {
        if (av === bv) return 0;
        return av > bv ? state.sortDir : -state.sortDir;
      }
      return String(av).localeCompare(String(bv)) * state.sortDir;
    });
    var empty = rows.length === 0
      ? "<tr><td colspan='7' class='empty'>No games match the column filters.</td></tr>"
      : "";
    document.querySelector("#bt tbody").innerHTML = empty || rows.map(function (r) {
      var v = verdictOf(r);
      return "<tr>" +
        "<td>" + (r.gameDate || "") + "</td>" +
        "<td>" + r.awayAbbrev + "</td>" +
        "<td>" + r.homeAbbrev + "</td>" +
        "<td class='num'>" + r.projectedLabel + "</td>" +
        "<td class='num'>" + r.actualLabel + "</td>" +
        "<td><span class='mark " + v + "'>" + label(v) + "</span></td>" +
        "<td class='num'>" + (r.totalErr == null ? "—" : r.totalErr) + "</td>" +
        "</tr>";
    }).join("");
    var shown = rows.length;
    var total = state.rows.length;
    if ($("shown")) $("shown").textContent = shown === total ? total + " games" : shown + " of " + total;
    document.querySelectorAll("#bt thead tr:first-child th").forEach(function (th) {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.getAttribute("data-key") === state.sortKey) {
        th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
    });
  }

  function readJson(r) {
    var ct = r.headers.get("content-type") || "";
    return r.text().then(function (text) {
      if (!r.ok) throw new Error(r.status + " " + (text || r.statusText).slice(0, 80));
      if (ct.indexOf("json") === -1 && text.charAt(0) !== "{" && text.charAt(0) !== "[") {
        throw new Error("Expected JSON from " + r.url + ", got " + ct);
      }
      try { return JSON.parse(text); }
      catch (e) { throw new Error("Invalid JSON from " + r.url); }
    });
  }

  function loadData() {
    return fetch("/data/backtest-20252026.json").then(readJson).catch(function () {
      return fetch("/api/backtest").then(readJson);
    });
  }

  loadData()
    .then(function (d) {
      if (d.error) {
        $("meta").textContent = d.error;
        return;
      }
      var s = d.summary || {};
      $("meta").textContent = (s.graded || 0) + " graded games";
      if ($("shown")) $("shown").textContent = (d.rows || []).length + " games";
      $("summary").innerHTML =
        '<div class="stat"><b>' + (s.games || s.graded || 0) + "</b><span>games</span></div>" +
        '<div class="stat"><b>' + (s.graded || 0) + "</b><span>graded</span></div>" +
        '<div class="stat"><b>' + (s.exactPct == null ? "—" : s.exactPct + "%") + "</b><span>exact score</span></div>" +
        '<div class="stat"><b>' + (s.winnerPct == null ? "—" : s.winnerPct + "%") + "</b><span>winner</span></div>" +
        '<div class="stat"><b>' + (s.maeGoals == null ? "—" : s.maeGoals) + "</b><span>avg |goals| miss</span></div>";
      state.rows = d.rows || [];
      render();
    })
    .catch(function (err) {
      $("meta").textContent = String(err);
    });

  document.querySelectorAll("#bt thead tr:first-child th").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = 1; }
      render();
    });
  });

  document.querySelectorAll("#bt [data-filter]").forEach(function (input) {
    input.addEventListener("input", function () {
      state.filters[input.getAttribute("data-filter")] = input.value;
      render();
    });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
  });
})();
