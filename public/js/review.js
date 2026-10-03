(function () {
  "use strict";

  var state = { rows: [], sortKey: "gameDate", sortDir: 1, asOf: null };

  function $(id) { return document.getElementById(id); }

  function verdictLabel(v) {
    if (v === "exact") return "Exact";
    if (v === "winner") return "Winner only";
    if (v === "miss") return "Miss";
    return "Pending";
  }

  function rowValue(r, key) {
    if (key === "verdict") return HockeyArchive.verdict(r);
    if (key === "winnerCorrect") {
      if (!r.graded) return 0;
      return r.winnerCorrect ? 1 : -1;
    }
    var v = r[key];
    return v == null ? "" : v;
  }

  function sorted() {
    var key = state.sortKey;
    var dir = state.sortDir;
    return ranged().slice().sort(function (a, b) {
      var av = rowValue(a, key);
      var bv = rowValue(b, key);
      if (typeof av === "number" && typeof bv === "number") {
        if (av === bv) return 0;
        return av > bv ? dir : -dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  function dayStamp(iso) {
    var t = Date.parse(String(iso || "").slice(0, 10) + "T00:00:00Z");
    return isFinite(t) ? t : null;
  }

  function inRange(r) {
    var mode = ($("range") && $("range").value) || "season";
    if (mode === "7") {
      var asOf = dayStamp(state.asOf || new Date().toISOString().slice(0, 10));
      var game = dayStamp(r.gameDate);
      if (asOf == null || game == null) return false;
      return game <= asOf && game >= asOf - 6 * 86400000;
    }
    if (String(r.seasonId) === "20262027") return true;
    return String(r.gameDate || "") >= "2026-09-01";
  }

  function ranged() {
    return state.rows.filter(inRange);
  }

  function stat(value, label) {
    return '<div class="stat"><b>' + value + "</b><span>" + label + "</span></div>";
  }

  function renderAccuracy(rows) {
    var box = $("accuracy");
    if (!box) return;
    var graded = rows.filter(function (r) { return r.graded; });
    if (!graded.length) {
      box.innerHTML = '<p class="accuracy-empty">no graded games yet</p>';
      return;
    }
    var sum = HockeyArchive.summarize(graded);
    box.innerHTML =
      stat(sum.winner + " of " + sum.graded + " (" + sum.winnerPct + "%)", "winner picks") +
      stat(sum.exact + " of " + sum.graded + " (" + sum.exactPct + "%)", "exact scores") +
      stat(sum.meanTotalGoalsError == null ? "—" : sum.meanTotalGoalsError, "total-goals error") +
      stat(sum.meanMarginError == null ? "—" : sum.meanMarginError, "goal-margin error");
  }

  function renderMarket(rows) {
    var box = $("market");
    if (!box) return;
    var graded = rows.filter(function (r) { return r.graded; });
    if (!graded.length) {
      box.textContent = "";
      return;
    }
    var noOdds = graded.filter(function (r) { return r.oddsMissing; }).length;
    var toss = graded.filter(function (r) { return r.edgeTossUpView; }).length;
    var picks = graded.filter(function (r) { return r.edgePickWon === true || r.edgePickWon === false; });
    var pickWins = picks.filter(function (r) { return r.edgePickWon; }).length;
    var favs = graded.filter(function (r) { return r.favoriteWon === true || r.favoriteWon === false; });
    var favWins = favs.filter(function (r) { return r.favoriteWon; }).length;
    var both = picks.filter(function (r) { return r.edgeAgreesFavorite === true || r.edgeAgreesFavorite === false; });
    var same = both.filter(function (r) { return r.edgeAgreesFavorite; }).length;
    var ou = graded.filter(function (r) { return r.ouHit === true || r.ouHit === false; });
    var ouHits = ou.filter(function (r) { return r.ouHit; }).length;
    box.innerHTML =
      "Edge pick won " + pickWins + " of " + picks.length +
      ". Market favorite won " + favWins + " of " + favs.length +
      ". Same side on " + same + " of " + both.length +
      ". Over/under hit " + ouHits + " of " + ou.length +
      ". " + noOdds + " graded game" + (noOdds === 1 ? "" : "s") + " had no saved odds" +
      ". " + toss + " toss-up" + (toss === 1 ? "" : "s") + " excluded from the Edge pick.";
  }

  function renderSummary(sum, extra) {
    extra = extra || "";
    $("summary").innerHTML =
      stat(sum.total, "locked") +
      stat(sum.graded, "graded") +
      stat(sum.pending, "pending") +
      stat(sum.exactPct == null ? "—" : sum.exactPct + "%", "exact") +
      stat(sum.winnerPct == null ? "—" : sum.winnerPct + "%", "winner");
    $("meta").textContent = sum.total + " estimates · exact " +
      (sum.exactPct == null ? "—" : sum.exactPct + "%") + " · winner " +
      (sum.winnerPct == null ? "—" : sum.winnerPct + "%") + extra;
  }

  function renderTable() {
    var tbody = document.querySelector("#review tbody");
    var rows = sorted();
    if (!rows.length) {
      var empty = state.rows.length
        ? "No estimates in this range."
        : "No locked estimates yet. Open Matchups so today’s slate is saved. On Vercel that save needs BLOB_READ_WRITE_TOKEN or a connected Blob store (BLOB_STORE_ID).";
      tbody.innerHTML = '<tr><td colspan="10" class="empty">' + empty + "</td></tr>";
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      var v = HockeyArchive.verdict(r);
      var differs = r.liveLabel && r.projectedLabel && r.liveLabel !== r.projectedLabel && !r.liveMatchesLock;
      var lockNote = differs
        ? (r.lockOpen ? " <span class='mark pending'>updates until puck drop</span>" : " <span class='mark miss'>locked ≠ live</span>")
        : "";
      return (
        "<tr" + (differs ? " class='differ'" : "") + ">" +
          "<td>" + (r.gameDate || "—") + "</td>" +
          "<td>" + (r.awayAbbrev || "") + "</td>" +
          "<td>" + (r.homeAbbrev || "") + "</td>" +
          "<td class='num'>" + (r.projectedLabel || "—") + lockNote + "</td>" +
          "<td class='num'>" + (r.liveLabel || "—") + (r.liveMatchesLock ? " =" : "") + "</td>" +
          "<td class='num'>" + (r.actualLabel || "—") + "</td>" +
          "<td><span class='mark " + v + "'>" + verdictLabel(v) + "</span></td>" +
          "<td>" + (!r.graded ? "—" : r.winnerCorrect ? "Yes" : "No") + "</td>" +
          "<td class='num'>" + (r.graded && r.totalGoalsError != null ? r.totalGoalsError : "—") + "</td>" +
          "<td class='num'>" + (r.graded && r.marginError != null ? r.marginError : "—") + "</td>" +
        "</tr>"
      );
    }).join("");
    document.querySelectorAll("#review th").forEach(function (th) {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.getAttribute("data-key") === state.sortKey) {
        th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
    });
  }

  function render(payload) {
    state.payload = payload || {};
    if (payload && payload.error && !(payload.estimates && payload.estimates.length)) {
      $("meta").textContent = payload.error;
      var warn = $("storage-note");
      if (warn) {
        warn.textContent = payload.error;
        warn.classList.remove("hidden");
      }
    }
    state.rows = payload.estimates || [];
    state.asOf = payload.asOf || state.asOf;
    var extra = "";
    if (payload.statsSeasonLabel) extra += " · stats " + payload.statsSeasonLabel;
    if (payload.scoreboardSeasonLabel) extra += " · scoreboard " + payload.scoreboardSeasonLabel;
    if (payload.note) extra += " · " + payload.note;
    if (payload.storageError) extra += " · not saved (" + payload.storage + ")";
    else if (payload.persisted === false) extra += " · not saved";
    var shown = ranged();
    renderAccuracy(shown);
    renderMarket(shown);
    renderSummary(HockeyArchive.summarize(shown), extra);
    var warn = $("storage-note");
    if (warn) {
      if (payload.storageError) {
        warn.textContent = payload.storageError;
        warn.classList.remove("hidden");
      } else {
        warn.classList.add("hidden");
      }
    }
    renderTable();
  }

  function load() {
    fetch("/api/estimates/grade", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (err) {
        $("meta").textContent = "Could not load estimates";
        $("summary").textContent = String(err);
      });
  }

  document.querySelectorAll("#review th").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = 1; }
      renderTable();
    });
  });

  var range = $("range");
  if (range) range.addEventListener("change", function () { render(state.payload || { estimates: state.rows, asOf: state.asOf }); });

  $("grade").addEventListener("click", function () {
    $("meta").textContent = "Grading…";
    fetch("/api/estimates/grade", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (err) {
        $("meta").textContent = String(err);
      });
  });

  load();
})();
