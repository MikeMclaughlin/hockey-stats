(function () {
  "use strict";

  var COLS = [
    { key: "matchup", label: "Matchup", title: "Away and home abbreviations, the same value on both team rows. Click to sort." },
    { key: "date", label: "Date", title: "Game date in Eastern Time. Click to sort.", sort: "when" },
    { key: "time", label: "Game time", title: "Game start time in Eastern Time. Click to sort.", sort: "timeSort" },
    { key: "team", label: "Team", title: "Team abbreviation for this row. Click to sort." },
    { key: "side", label: "Home/Away", title: "Whether this row is the home team or the away team. Click to sort." },
    { key: "record", label: "Record", title: "Season record saved with the matchup. Click to sort." },
    { key: "sogShare", label: "Shots-on-goal share", title: "Shots on goal for divided by shots for plus shots against. Click to sort.", num: true, digits: "pct" },
    { key: "xgfPct5v5", label: "Even-strength expected-goals share", title: "5-on-5 expected goals for divided by expected goals for plus against. Click to sort.", num: true, digits: "pct" },
    { key: "cfPct", label: "Shot-attempt share", title: "Shot attempts for divided by shot attempts for plus against. Click to sort.", num: true, digits: "pct" },
    { key: "pdo", label: "Shooting plus save percentage", title: "Shooting percentage plus save percentage. 100 is league-normal. Click to sort.", num: true },
    { key: "last5SvPct", label: "Save percentage last five games", title: "Save percentage over the last five games. Click to sort.", num: true, digits: "pct" },
    { key: "last5AvgGd", label: "Average goal differential last five games", title: "Average goal differential over the last five games. Click to sort.", num: true, digits: 2 },
    { key: "gfMinusXg", label: "Actual goals versus expected goals", title: "Actual goals for minus expected goals for. Click to sort.", num: true, digits: 1 },
    { key: "hdcfPct", label: "High-danger chance share", title: "High-danger chances for divided by high-danger chances for plus against. Click to sort.", num: true, digits: "pct" },
    { key: "stXg", label: "Special-teams expected goals", title: "Power-play expected goals minus shorthanded expected goals against. Click to sort.", num: true, digits: 1 },
    { key: "estimatedScore", label: "Estimated score", title: "Estimated score, away goals then home goals. Click to sort." },
    { key: "actualScore", label: "Actual score", title: "Actual or final score, away goals then home goals. Click to sort." },
    { key: "edgePick", label: "Edge pick", title: "Edge pick abbreviation. Click to sort." },
    { key: "edgeLabel", label: "Edge label", title: "Strong, Confident, Lean, or Toss-up from the win-chance model. Click to sort." },
    { key: "winChance", label: "Win chance", title: "Calibrated win chance for the Edge pick. Click to sort." },
    { key: "why", label: "Why", title: "Why sentence from shots-on-goal share, even-strength expected-goals share, and shot-attempt share. Click to sort.", clip: true },
    { key: "notes", label: "Notes", title: "Rest, streak, and fatigue notes. Click to sort.", clip: true },
    { key: "odds", label: "Odds", title: "Saved moneyline and over/under. Click to sort.", clip: true },
    { key: "result", label: "Result", title: "Locked estimate against the actual score, and whether the Edge pick was right. Click to sort.", clip: true }
  ];

  var state = { rows: [], sortKey: "when", sortDir: 1 };

  function $(id) { return document.getElementById(id); }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function signed(n, digits) {
    if (n == null || n === "" || !isFinite(Number(n))) return "";
    var p = Math.pow(10, digits);
    var v = Math.round(Number(n) * p) / p;
    return (v > 0 ? "+" : "") + v;
  }

  function show(row, col) {
    var v = row[col.key];
    if (col.digits === "pct") return v == null || v === "" ? "" : v + "%";
    if (col.digits != null) return signed(v, col.digits);
    return v == null ? "" : String(v);
  }

  function sortValue(row, col) {
    if (col.sort) return row[col.sort] == null ? "" : row[col.sort];
    if (col.num) {
      var n = row[col.key];
      return n == null || n === "" || !isFinite(Number(n)) ? null : Number(n);
    }
    return row[col.key] == null ? "" : row[col.key];
  }

  function colByKey(key) {
    for (var i = 0; i < COLS.length; i++) if (COLS[i].key === key || COLS[i].sort === key) return COLS[i];
    return COLS[0];
  }

  function sorted() {
    var col = colByKey(state.sortKey);
    var dir = state.sortDir;
    return state.rows.slice().sort(function (a, b) {
      var av = sortValue(a, col);
      var bv = sortValue(b, col);
      if (col.num) {
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av === bv) return String(a.when).localeCompare(String(b.when));
        return av > bv ? dir : -dir;
      }
      var cmp = String(av).localeCompare(String(bv));
      if (cmp === 0) return String(a.when).localeCompare(String(b.when)) || String(a.side).localeCompare(String(b.side));
      return cmp * dir;
    });
  }

  function paintHead() {
    var head = $("download-head");
    head.innerHTML = COLS.map(function (col) {
      var sortKey = col.sort || col.key;
      var on = state.sortKey === sortKey ? (state.sortDir === 1 ? " sort-asc" : " sort-desc") : "";
      var cls = (on + (col.clip ? " clip" : "")).trim();
      return '<th data-key="' + sortKey + '" class="' + cls + '" title="' + esc(col.title) + '">' + esc(col.label) + "</th>";
    }).join("");
    head.querySelectorAll("th").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-key");
        if (state.sortKey === key) state.sortDir *= -1;
        else { state.sortKey = key; state.sortDir = 1; }
        render();
      });
    });
  }

  function render() {
    var rows = sorted();
    var body = document.querySelector("#download tbody");
    if (!rows.length) {
      body.innerHTML = "<tr><td class='empty' colspan='" + COLS.length + "'>No stored games for this season.</td></tr>";
      return;
    }
    body.innerHTML = rows.map(function (row) {
      return "<tr>" + COLS.map(function (col) {
        var text = show(row, col);
        var cls = (col.num ? "num" : "") + (col.clip ? " clip" : "");
        var title = col.clip && text ? " title=\"" + esc(text) + "\"" : "";
        var inner = col.clip ? "<span>" + (text ? esc(text) : "—") + "</span>" : (text ? esc(text) : "—");
        return "<td" + (cls ? " class='" + cls.trim() + "'" : "") + title + ">" + inner + "</td>";
      }).join("") + "</tr>";
    }).join("");
    paintHead();
  }

  function csvCell(value) {
    var s = value == null ? "" : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsv() {
    var rows = sorted();
    var lines = [COLS.map(function (col) { return csvCell(col.label); }).join(",")];
    rows.forEach(function (row) {
      lines.push(COLS.map(function (col) { return csvCell(show(row, col)); }).join(","));
    });
    var blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hockey-stats-2026-27-matchups.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function load() {
    if (window.HockeyLoading) HockeyLoading.show();
    fetch("/api/download")
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok || (body && body.error && !body.rows)) throw new Error((body && body.error) || ("HTTP " + r.status));
          return body;
        });
      })
      .then(function (body) {
        state.rows = (body && body.rows) || [];
        var games = body && body.games != null ? body.games : Math.round(state.rows.length / 2);
        $("meta").textContent = games + " games · " + state.rows.length + " rows" +
          (body && body.seasonLabel ? " · " + body.seasonLabel : "");
        render();
      })
      .catch(function (err) {
        $("meta").textContent = "Could not load matchup rows";
        var note = $("note");
        if (note) {
          note.textContent = (err && err.message) || String(err);
          note.classList.remove("hidden");
        }
        if (!state.rows.length) render();
      })
      .then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
  }

  paintHead();
  $("download-csv").addEventListener("click", downloadCsv);
  load();
})();
