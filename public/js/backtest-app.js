(function () {
  "use strict";

  var SEASONS = [
    { id: "all", label: "All seasons" },
    { id: "20212022", label: "2021-22" },
    { id: "20222023", label: "2022-23" },
    { id: "20232024", label: "2023-24" },
    { id: "20242025", label: "2024-25" },
    { id: "20252026", label: "2025-26" },
    { id: "20262027", label: "2026-27" }
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

  function gradeFinished(row) {
    if (!row || row.graded) return row;
    if (row.actualAway == null || row.actualHome == null) return row;
    if (row.projectedAway == null || row.projectedHome == null) return row;
    if (window.HockeyArchive && HockeyArchive.applyResult) {
      HockeyArchive.applyResult(row, row.actualAway, row.actualHome, row.gameState || "OFF");
    }
    if (row.totalErr == null) {
      row.awayErr = Math.abs(Number(row.projectedAway) - Number(row.actualAway));
      row.homeErr = Math.abs(Number(row.projectedHome) - Number(row.actualHome));
      row.totalErr = row.awayErr + row.homeErr;
    }
    return row;
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

  function whenOf(r) {
    return r.startTimeUTC || r.gameDate || "";
  }

  function dateLabel(r) {
    var raw = whenOf(r);
    return window.HockeyDates ? HockeyDates.formatTableDate(raw) : raw;
  }

  function rowValue(r, key) {
    if (key === "verdict") return verdictOf(r);
    if (key === "totalErr") return r.totalErr == null ? 99 : r.totalErr;
    if (key === "gameDate") return whenOf(r);
    return r[key] == null ? "" : r[key];
  }

  function displayOf(r) {
    var v = verdictOf(r);
    return {
      gameDate: dateLabel(r),
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
      : (s.graded === rows.length ? rows.length + " graded games" : rows.length + " games");
    $("summary").innerHTML =
      '<div class="stat"><b>' + s.total + "</b><span>" + (filtered ? "filtered" : "games") + "</span></div>" +
      '<div class="stat"><b>' + s.graded + "</b><span>graded</span></div>" +
      '<div class="stat"><b>' + (s.exactPct == null ? "—" : s.exactPct + "%") + "</b><span>exact score</span></div>" +
      '<div class="stat"><b>' + (s.winnerPct == null ? "—" : s.winnerPct + "%") + "</b><span>winner</span></div>" +
      '<div class="stat"><b>' + (s.meanTotalGoalsError == null ? "—" : s.meanTotalGoalsError) + "</b><span>total goals error</span></div>" +
      '<div class="stat"><b>' + (s.meanMarginError == null ? "—" : s.meanMarginError) + "</b><span>margin error</span></div>";
    paintModel(rows);
    paintEdgeSplits(rows);
  }

  function etParts(iso) {
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return null;
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23"
    });
    var map = {};
    fmt.formatToParts(d).forEach(function (p) { map[p.type] = p.value; });
    return { weekday: map.weekday, hour: Number(map.hour) };
  }

  function calendarWeekday(ymd) {
    var d = new Date(String(ymd).slice(0, 10) + "T12:00:00Z");
    if (!isFinite(d.getTime())) return null;
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  }

  function edgeChanceCell(r) {
    var bits = (r.edgeAbbrev || "—") + (r.edgeTossUp ? " toss up" : "");
    if (!window.HockeyEdgeModel || !r.graded) return bits;
    var model = HockeyEdgeModel.fromBacktestRow(r);
    var oldPct = model.oldPct == null ? "toss-up" : model.oldPct + "%";
    return bits + "<div class='edge-meta'>New " + model.pickAbbrev + " " + model.pickPct +
      "% " + model.label + "</div><div class='edge-meta'>Old " + oldPct + "</div>";
  }

  function edgeWasRight(r) {
    if (!r.graded || r.edgeTossUp || !r.edgeAbbrev) return null;
    if (r.actualAway == null || r.actualHome == null || r.actualAway === r.actualHome) return null;
    var winner = r.actualAway > r.actualHome ? r.awayAbbrev : r.homeAbbrev;
    return r.edgeAbbrev === winner;
  }

  function bump(map, key, right) {
    if (!key) return;
    if (!map[key]) map[key] = { w: 0, l: 0 };
    if (right) map[key].w += 1;
    else map[key].l += 1;
  }

  function splitTable(title, order, map) {
    var body = order.map(function (key) {
      var cell = map[key] || { w: 0, l: 0 };
      var n = cell.w + cell.l;
      var pct = n ? (Math.round((1000 * cell.w) / n) / 10) + "%" : "—";
      return "<tr><td>" + key + "</td><td class='num'>" + cell.w + "–" + cell.l + "</td><td class='num'>" + pct + "</td></tr>";
    }).join("");
    return "<div><h3>" + title + "</h3><table><thead><tr><th>Group</th><th class='num'>W–L</th><th class='num'>Win%</th></tr></thead><tbody>" +
      body + "</tbody></table></div>";
  }

  function paintEdgeSplits(rows) {
    var box = $("edge-splits");
    if (!box) return;
    var days = {};
    var slots = {};
    rows.forEach(function (r) {
      var right = edgeWasRight(r);
      if (right == null) return;
      var when = r.startTimeUTC ? etParts(r.startTimeUTC) : null;
      var day = when ? when.weekday : calendarWeekday(r.gameDate);
      bump(days, day, right);
      var slot = "No start time";
      if (when && isFinite(when.hour)) {
        if (when.hour < 17) slot = "Afternoon (before 5pm ET)";
        else if (when.hour < 21) slot = "Early (5–8:59pm ET)";
        else slot = "Late (9pm ET or later)";
      }
      bump(slots, slot, right);
    });
    box.innerHTML =
      splitTable("Edge pick by day (ET)", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], days) +
      splitTable("Edge pick by start time (ET)", [
        "Afternoon (before 5pm ET)",
        "Early (5–8:59pm ET)",
        "Late (9pm ET or later)",
        "No start time"
      ], slots);
  }

  var TRAIN_SEASONS = { "20212022": 1, "20222023": 1, "20232024": 1, "20242025": 1 };
  var HELD_SEASONS = { "20252026": 1, "20262027": 1 };

  function scorePair(rows) {
    var n = 0;
    var fresh = 0;
    var old = 0;
    var hiN = 0;
    var hiR = 0;
    rows.forEach(function (r) {
      if (!r.graded || r.actualAway == null || r.actualHome == null || r.actualAway === r.actualHome) return;
      if (r.edgeTossUp || !r.edgeAbbrev) return;
      var model = HockeyEdgeModel.fromBacktestRow(r);
      var homeWon = r.actualHome > r.actualAway;
      var ok = (model.pick === "home") === homeWon;
      var oldRight = edgeWasRight(r);
      if (oldRight == null) return;
      n += 1;
      if (ok) fresh += 1;
      if (oldRight) old += 1;
      if (model.pickPct >= 65) {
        hiN += 1;
        if (ok) hiR += 1;
      }
    });
    return { n: n, fresh: fresh, old: old, hiN: hiN, hiR: hiR };
  }

  function paintModel(rows) {
    var note = $("model-note");
    if (!note || !window.HockeyEdgeModel) return;
    function pct(hit, total) {
      if (!total) return "—";
      return (Math.round((1000 * hit) / total) / 10) + "% (" + hit + " of " + total + ")";
    }
    function line(title, pair) {
      return title + " new " + pct(pair.fresh, pair.n) + " and previous rule " + pct(pair.old, pair.n) +
        " on the same " + pair.n + " games (a final, a winner, and a firm previous-rule pick). At 65% or higher on those games, " +
        pct(pair.hiR, pair.hiN) + ".";
    }
    var heldRows = rows.filter(function (r) { return HELD_SEASONS[String(r.season)]; });
    var trainRows = rows.filter(function (r) { return TRAIN_SEASONS[String(r.season)]; });
    var parts = [];
    if (heldRows.length && trainRows.length) {
      parts.push(line("Held-out 2025-26 and 2026-27:", scorePair(heldRows)));
      parts.push(line("In-sample 2021-22 through 2024-25 (the fit seasons):", scorePair(trainRows)));
      parts.push("The all-seasons list mixes those two. The in-sample rate is not a validation.");
    } else if (trainRows.length) {
      parts.push(line("In-sample fit seasons:", scorePair(trainRows)));
      parts.push("These seasons were used to fit the model. This is not a held-out check.");
    } else {
      parts.push(line("Held-out:", scorePair(heldRows.length ? heldRows : rows)));
    }
    var v = HockeyEdgeModel.VALIDATION;
    var coefs = HockeyEdgeModel.coefficients().map(function (c) {
      return c.label + " " + c.weight.toFixed(3);
    }).join("; ");
    parts.push(
      "Fit on 2021-22 through 2024-25. 2025-26 validation at the fit: " + v.pickPct + "% (" + v.picksRight + " of " + v.games +
      "), and " + v.confidentPct + "% (" + v.confidentRight + " of " + v.confidentGames +
      ") at 65% or higher. A missing feature is left out, not read as zero, and each feature is capped at 2.5 training standard deviations. Standardized coefficients: " +
      coefs + "."
    );
    note.textContent = parts.join(" ");
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
        "<td>" + dateLabel(r) + "</td>" +
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
        "<td>" + edgeChanceCell(r) + "</td>" +
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
    if (season === "20262027") {
      return fetch("/api/backtest?season=20262027").then(readJson).then(function (body) {
        if (body && body.unavailable) throw new Error("unavailable");
        return body;
      }).catch(function () {
        return fetch("/data/backtest-20262027.json").then(readJson);
      });
    }
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
          generatedAt: parts.reduce(function (latest, p) {
            if (p && p.generatedAt && (!latest || p.generatedAt > latest)) return p.generatedAt;
            return latest;
          }, null),
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
    state.rows = (d.rows || []).map(gradeFinished);
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
      var stamp = d.generatedAt && window.HockeyDates
        ? HockeyDates.formatTableDate(d.generatedAt)
        : (d.generatedAt || "");
      $("stamp").textContent = stamp
        ? "Cached snapshot " + stamp + ". "
        : "Cached snapshot. ";
    }
    if ($("limits")) {
      var bits = (d.limits || []).slice();
      bits = bits.map(function (line) {
        return String(line)
          .replace("2021-22 through 2025-26", "2021-22 through 2026-27")
          .replace(
            "A row is graded once both clubs have five prior games; earlier finals stay pending.",
            "A row with a final score is graded. Both clubs still need five prior games before the sample matches the fitted backtest; earlier finals stay in the file and are marked as a short sample."
          );
      });
      if ((d.season || selectedSeason()) !== "all") {
        bits = bits.map(function (line) {
          return String(line).replace("2021-22 through 2026-27", "2021-22 through 2025-26");
        });
      }
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

  function saveBacktestPrefs() {
    if (!window.HockeyPrefs || !HockeyPrefs.signedIn()) return;
    HockeyPrefs.patch("backtest", {
      season: $("season") ? $("season").value : "all",
      team: state.team,
      b2b: !!state.b2b,
      side: state.side,
      sortKey: state.sortKey,
      sortDir: state.sortDir,
      filters: state.filters
    });
  }

  function applyBacktestPrefs() {
    var saved = window.HockeyPrefs && HockeyPrefs.signedIn() && HockeyPrefs.section("backtest");
    if (!saved) return;
    var q = new URLSearchParams(location.search);
    if (!q.get("season") && saved.season && $("season")) $("season").value = saved.season;
    if (!q.get("sort") && saved.sortKey) state.sortKey = saved.sortKey;
    if (!q.get("dir") && (saved.sortDir === 1 || saved.sortDir === -1)) state.sortDir = saved.sortDir;
    if (saved.team != null && $("team")) {
      state.team = saved.team;
      $("team").value = saved.team;
    }
    if ($("b2b")) {
      state.b2b = !!saved.b2b;
      $("b2b").checked = state.b2b;
    }
    if (saved.side != null && $("side")) {
      state.side = saved.side;
      $("side").value = saved.side;
    }
    if (saved.filters) {
      Object.keys(saved.filters).forEach(function (k) {
        if (q.get(k)) return;
        state.filters[k] = saved.filters[k];
        var input = document.querySelector('#bt [data-filter="' + k + '"]');
        if (input) input.value = saved.filters[k] || "";
      });
    }
  }

  function startBacktest() {
    applyBacktestPrefs();
    var bootSeason = ($("season") && $("season").value) || new URLSearchParams(location.search).get("season") || "all";
    if ($("season")) $("season").value = bootSeason;
    if (window.HockeyLoading) HockeyLoading.show();
    loadData(bootSeason)
      .then(applyPayload)
      .catch(function (err) {
        $("meta").textContent = String(err);
      })
      .then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
  }

  if ($("season")) {
    $("season").addEventListener("change", function () {
      var id = $("season").value;
      var q = new URLSearchParams(location.search);
      q.set("season", id);
      history.replaceState(null, "", "/backtest.html?" + q.toString());
      if (!state.rows.length) $("meta").textContent = "Loading…";
      if (window.HockeyLoading) HockeyLoading.show();
      loadData(id).then(applyPayload).catch(function (err) {
        $("meta").textContent = String(err);
      }).then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
      saveBacktestPrefs();
    });
  }

  if ($("team")) {
    $("team").addEventListener("input", function () {
      state.team = $("team").value;
      saveBacktestPrefs();
      render();
    });
  }
  if ($("b2b")) {
    $("b2b").addEventListener("change", function () {
      state.b2b = !!$("b2b").checked;
      saveBacktestPrefs();
      render();
    });
  }
  if ($("side")) {
    $("side").addEventListener("change", function () {
      state.side = $("side").value;
      saveBacktestPrefs();
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
      saveBacktestPrefs();
      render();
    });
  });

  document.querySelectorAll("#bt [data-filter]").forEach(function (input) {
    input.addEventListener("input", function () {
      state.filters[input.getAttribute("data-filter")] = input.value;
      var q = new URLSearchParams(location.search);
      q.set(input.getAttribute("data-filter"), input.value);
      history.replaceState(null, "", "/backtest.html?" + q.toString());
      saveBacktestPrefs();
      render();
    });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
  });

  if (window.HockeyPrefs) HockeyPrefs.ready.then(startBacktest);
  else startBacktest();
})();
