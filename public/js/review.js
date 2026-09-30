(function () {
  "use strict";

  var state = { rows: [], sortKey: "gameDate", sortDir: 1 };

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
    return state.rows.slice().sort(function (a, b) {
      var av = rowValue(a, key);
      var bv = rowValue(b, key);
      if (typeof av === "number" && typeof bv === "number") {
        if (av === bv) return 0;
        return av > bv ? dir : -dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  function renderSummary(sum, extra) {
    extra = extra || "";
    $("summary").innerHTML =
      '<div class="stat"><b>' + sum.total + "</b><span>locked</span></div>" +
      '<div class="stat"><b>' + sum.graded + "</b><span>graded</span></div>" +
      '<div class="stat"><b>' + sum.pending + "</b><span>pending</span></div>" +
      '<div class="stat"><b>' + (sum.exactPct == null ? "—" : sum.exactPct + "%") + "</b><span>exact</span></div>" +
      '<div class="stat"><b>' + (sum.winnerPct == null ? "—" : sum.winnerPct + "%") + "</b><span>winner</span></div>";
    $("meta").textContent = sum.total + " estimates · exact " +
      (sum.exactPct == null ? "—" : sum.exactPct + "%") + " · winner " +
      (sum.winnerPct == null ? "—" : sum.winnerPct + "%") + extra;
  }

  function renderTable() {
    var tbody = document.querySelector("#review tbody");
    var rows = sorted();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">No locked estimates yet. Open Matchups so today’s slate is saved. On Vercel that save needs BLOB_READ_WRITE_TOKEN or a connected Blob store (BLOB_STORE_ID).</td></tr>';
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
    if (payload && payload.error && !(payload.estimates && payload.estimates.length)) {
      $("meta").textContent = payload.error;
      var warn = $("storage-note");
      if (warn) {
        warn.textContent = payload.error;
        warn.classList.remove("hidden");
      }
    }
    state.rows = payload.estimates || [];
    var extra = "";
    if (payload.statsSeasonLabel) extra += " · stats " + payload.statsSeasonLabel;
    if (payload.scoreboardSeasonLabel) extra += " · scoreboard " + payload.scoreboardSeasonLabel;
    if (payload.note) extra += " · " + payload.note;
    if (payload.storageError) extra += " · not saved (" + payload.storage + ")";
    else if (payload.persisted === false) extra += " · not saved";
    renderSummary(payload.summary || HockeyArchive.summarize(state.rows), extra);
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
