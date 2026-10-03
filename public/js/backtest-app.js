(function () {
  "use strict";

  var SEASONS = [
    { id: "all", label: "All seasons" },
    { id: "20212022", label: "2021-22" },
    { id: "20222023", label: "2022-23" },
    { id: "20232024", label: "2023-24" },
    { id: "20242025", label: "2024-25" },
    { id: "20252026", label: "2025-26" }
  ];
  var state = {
    rows: [],
    sortKey: "gameDate",
    sortDir: -1,
    filters: {},
    team: "",
    b2b: false,
    side: ""
  };
  var NUMERIC = {
    totalErr: true, awayPdo: true, homePdo: true,
    awayLast5: true, homeLast5: true, awayLast5Sv: true, homeLast5Sv: true,
    awayXgf5: true, homeXgf5: true
  };

  function $(id) { return document.getElementById(id); }

  function fmt(v, d) {
    if (v == null || v === "") return "—";
    var t = Number(v).toFixed(d);
    return Number(v) < 0 ? '<span class="num-neg">' + t + "</span>" : t;
  }

  function pct(v) {
    return v == null ? "—" : Number(v).toFixed(1) + "%";
  }

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
      totalErr: r.totalErr,
      awayPdo: r.awayPdo,
      homePdo: r.homePdo,
      awayLast5: r.awayLast5,
      homeLast5: r.homeLast5,
      awayLast5Sv: r.awayLast5Sv,
      homeLast5Sv: r.homeLast5Sv,
      awayXgf5: r.awayXgf5,
      homeXgf5: r.homeXgf5,
      edgeAbbrev: r.edgeAbbrev || "",
      edgeRole: r.edgeRole || "",
      notes: r.notes || ""
    };
  }

  function teamName(abbrev) {
    var hit = window.HockeyStats && HockeyStats.teamByAbbrev(abbrev);
    if (hit && hit.name) return hit.name;
    if (abbrev === "ARI") return "Arizona Coyotes";
    if (abbrev === "UTA") return "Utah Mammoth";
    return abbrev || "";
  }

  function teamHit(r) {
    var q = String(state.team || "").trim().toLowerCase();
    if (!q) return true;
    var bits = [r.awayAbbrev, r.homeAbbrev, teamName(r.awayAbbrev), teamName(r.homeAbbrev)];
    return bits.some(function (n) { return String(n || "").toLowerCase().indexOf(q) !== -1; });
  }

  function playedLastNight(r) {
    if (r.awayB2B || r.homeB2B) return true;
    var notes = r.notes || "";
    return notes.indexOf("played last night") !== -1 || notes.indexOf("Both on a back-to-back") !== -1;
  }

  function sideHit(r) {
    if (!state.side) return true;
    return r.edgeRole === state.side;
  }

  function filteredRows() {
    return state.rows.filter(function (r) {
      if (!teamHit(r) || !sideHit(r)) return false;
      if (state.b2b && !playedLastNight(r)) return false;
      return TableFilter.rowMatches(displayOf(r), state.filters, NUMERIC);
    });
  }

  function paintSummary(rows) {
    var s = HockeyArchive.summarize(rows);
    var mae = 0;
    var n = 0;
    rows.forEach(function (r) {
      if (r.totalErr == null) return;
      mae += r.totalErr;
      n += 1;
    });
    s.maeGoals = n ? Math.round((mae / n) * 100) / 100 : null;
    var filtered = rows.length !== state.rows.length;
    $("meta").textContent = filtered
      ? rows.length + " of " + state.rows.length + " games"
      : rows.length + " graded games";
    $("summary").innerHTML =
      '<div class="stat"><b>' + s.total + "</b><span>" + (filtered ? "filtered" : "games") + "</span></div>" +
      '<div class="stat"><b>' + s.graded + "</b><span>graded</span></div>" +
      '<div class="stat"><b>' + (s.exactPct == null ? "—" : s.exactPct + "%") + "</b><span>exact score</span></div>" +
      '<div class="stat"><b>' + (s.winnerPct == null ? "—" : s.winnerPct + "%") + "</b><span>winner</span></div>" +
      '<div class="stat"><b>' + (s.meanTotalGoalsError == null ? "—" : s.meanTotalGoalsError) + "</b><span>total goals error</span></div>" +
      '<div class="stat"><b>' + (s.meanMarginError == null ? "—" : s.meanMarginError) + "</b><span>margin error</span></div>";
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
      ? "<tr><td colspan='17' class='empty'>No games match these filters.</td></tr>"
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
        "<td class='num'>" + fmt(r.awayPdo, 1) + "</td>" +
        "<td class='num'>" + fmt(r.homePdo, 1) + "</td>" +
        "<td class='num'>" + fmt(r.awayLast5, 2) + "</td>" +
        "<td class='num'>" + fmt(r.homeLast5, 2) + "</td>" +
        "<td class='num'>" + pct(r.awayLast5Sv) + "</td>" +
        "<td class='num'>" + pct(r.homeLast5Sv) + "</td>" +
        "<td class='num'>" + pct(r.awayXgf5) + "</td>" +
        "<td class='num'>" + pct(r.homeXgf5) + "</td>" +
        "<td>" + (r.edgeAbbrev || "—") + (r.edgeTossUp ? " toss up" : "") + "</td>" +
        "<td>" + (r.edgeRole || "—") + "</td>" +
        "<td class='notes'>" + (r.notes || "—") + "</td>" +
        "</tr>";
    }).join("");
    var shown = rows.length;
    var total = state.rows.length;
    if ($("shown")) $("shown").textContent = shown === total ? total + " games" : shown + " of " + total;
    paintSummary(rows);
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

  function selectedSeason() {
    var sel = $("season");
    return (sel && sel.value) || "20252026";
  }

  function paintSeasons(d) {
    var sel = $("season");
    if (!sel || !d.seasons || !d.seasons.length) return;
    var current = d.season || sel.value;
    sel.innerHTML = d.seasons.map(function (s) {
      var label = s.label || s.id;
      if (!s.available) label += " (not built)";
      return "<option value='" + s.id + "'" + (s.id === current ? " selected" : "") + ">" + label + "</option>";
    }).join("");
  }

  function loadOne(season) {
    return fetch("/data/backtest-" + season + ".json").then(readJson).catch(function () {
      return fetch("/api/backtest?season=" + encodeURIComponent(season)).then(readJson);
    });
  }

  function loadData(season) {
    if (season === "all") {
      var ids = SEASONS.filter(function (s) { return s.id !== "all"; }).map(function (s) { return s.id; });
      return Promise.all(ids.map(loadOne)).then(function (parts) {
        var rows = [];
        var limits = [];
        parts.forEach(function (p) {
          rows = rows.concat(p.rows || []);
          if (p.limits && !limits.length) limits = p.limits;
        });
        return {
          season: "all",
          seasons: SEASONS.map(function (s) { return { id: s.id, label: s.label, available: true }; }),
          rows: rows,
          limits: limits,
          favoriteMethod: "points-percentage",
          generatedAt: (parts[0] && parts[0].generatedAt) || null,
          source: "2021-22 through 2025-26 regular season."
        };
      });
    }
    return loadOne(season || "20252026");
  }

  function applyPayload(d) {
    if (d.error && !d.rows) {
      $("meta").textContent = d.error;
      return;
    }
    paintSeasons(d);
    state.rows = d.rows || [];
    var label = "";
    (d.seasons || []).forEach(function (s) {
      if (s.id === (d.season || selectedSeason())) label = s.label || s.id;
    });
    if (!label && d.season) {
      var y = String(d.season);
      label = y.slice(0, 4) + "-" + y.slice(6);
    }
    if ($("title")) $("title").textContent = (label || "Season") + " score backtest";
    if ($("season-foot")) $("season-foot").textContent = "NHL club-schedule-season " + (d.season || "");
    if (d.unavailable) {
      $("meta").textContent = d.message || "No cached backtest for this season.";
      $("summary").innerHTML = "";
      document.querySelector("#bt tbody").innerHTML =
        "<tr><td colspan='17' class='empty'>" + (d.message || "No cached backtest for this season.") + "</td></tr>";
      if ($("stamp")) $("stamp").textContent = "";
      return;
    }
    if ($("stamp")) {
      $("stamp").textContent = d.generatedAt
        ? "Cached snapshot " + d.generatedAt + ". "
        : "Cached snapshot. ";
    }
    if ($("limits")) {
      var bits = d.limits || [];
      if (d.modelNote) bits = bits.concat([d.modelNote]);
      $("limits").textContent = bits.join(" ");
    }
      var q = new URLSearchParams(location.search);
      document.querySelectorAll("#bt [data-filter]").forEach(function (input) {
        var k = input.getAttribute("data-filter");
        if (q.get(k)) {
          input.value = q.get(k);
          state.filters[k] = q.get(k);
        }
      });
      if (q.get("sort")) state.sortKey = q.get("sort");
      if (q.get("dir")) state.sortDir = Number(q.get("dir")) || 1;
      render();
  }

  var bootSeason = new URLSearchParams(location.search).get("season") || "all";
  if ($("season")) $("season").value = bootSeason;
  loadData(bootSeason)
    .then(applyPayload)
    .catch(function (err) {
      $("meta").textContent = String(err);
    });

  if ($("season")) {
    $("season").addEventListener("change", function () {
      var id = $("season").value;
      var q = new URLSearchParams(location.search);
      q.set("season", id);
      history.replaceState(null, "", "/backtest.html?" + q.toString());
      $("meta").textContent = "Loading…";
      loadData(id).then(applyPayload).catch(function (err) {
        $("meta").textContent = String(err);
      });
    });
  }

  if ($("team")) {
    $("team").addEventListener("input", function () {
      state.team = $("team").value;
      render();
    });
  }
  if ($("b2b")) {
    $("b2b").addEventListener("change", function () {
      state.b2b = !!$("b2b").checked;
      render();
    });
  }
  if ($("side")) {
    $("side").addEventListener("change", function () {
      state.side = $("side").value;
      render();
    });
  }

  document.querySelectorAll("#bt thead tr:first-child th").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = key === "gameDate" ? -1 : 1; }
      var q = new URLSearchParams(location.search);
      q.set("sort", state.sortKey);
      q.set("dir", String(state.sortDir));
      history.replaceState(null, "", "/backtest.html?" + q.toString());
      render();
    });
  });

  document.querySelectorAll("#bt [data-filter]").forEach(function (input) {
    input.addEventListener("input", function () {
      state.filters[input.getAttribute("data-filter")] = input.value;
      var q = new URLSearchParams(location.search);
      q.set(input.getAttribute("data-filter"), input.value);
      history.replaceState(null, "", "/backtest.html?" + q.toString());
      render();
    });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
  });
})();
