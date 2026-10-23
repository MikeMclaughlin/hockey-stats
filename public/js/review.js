(function () {
  "use strict";

  var state = { rows: [], sortKey: "gameDate", sortDir: 1, asOf: null, backtestById: null };

  function $(id) { return document.getElementById(id); }

  function verdictLabel(v) {
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
    if (window.HockeyDates) return HockeyDates.formatTableDate(raw);
    return raw || "—";
  }

  function rowValue(r, key) {
    if (key === "verdict") return HockeyArchive.verdict(r);
    if (key === "winnerCorrect") {
      if (!r.graded) return 0;
      return r.winnerCorrect ? 1 : -1;
    }
    if (key === "gameDate") return whenOf(r);
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

  function marketPickPct(r, side) {
    if (!window.HockeyStats || (side !== "away" && side !== "home")) return null;
    var ml = side === "away" ? r.awayMl : r.homeMl;
    if (ml == null || ml === "") return null;
    return HockeyStats.impliedWinPct(Number(ml));
  }

  function edgeView(r) {
    var actual = null;
    if (r.graded && r.actualAway != null && r.actualHome != null && window.HockeyArchive) {
      actual = HockeyArchive.winnerOf(r.actualAway, r.actualHome);
    }
    var bt = state.backtestById && state.backtestById[String(r.id)];
    var model = bt && window.HockeyEdgeModel ? HockeyEdgeModel.fromBacktestRow(bt) : null;
    if (model) {
      var modelToss = model.label === "Toss-up";
      var modelWon = null;
      if (!modelToss && model.pick && actual && actual !== "tie") modelWon = model.pick === actual;
      return { toss: modelToss, side: model.pick, won: modelWon, pct: model.pickPct, row: r };
    }
    var side = r.edgeWinnerView;
    var tossUp = !!r.edgeTossUpView;
    var won = null;
    if (!tossUp && (r.edgePickWon === true || r.edgePickWon === false)) won = r.edgePickWon === true;
    else if (!tossUp && side && actual && actual !== "tie") won = side === actual;
    return { toss: tossUp, side: side, won: won, pct: marketPickPct(r, side), row: r };
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
    var views = graded.map(edgeView);
    var toss = views.filter(function (v) { return v.toss; }).length;
    var picks = views.filter(function (v) { return v.won === true || v.won === false; });
    var pickWins = picks.filter(function (v) { return v.won; }).length;
    var hi = picks.filter(function (v) { return v.pct != null && v.pct >= 60; });
    var hiWins = hi.filter(function (v) { return v.won; }).length;
    var favs = graded.filter(function (r) { return r.favoriteWon === true || r.favoriteWon === false; });
    var favWins = favs.filter(function (r) { return r.favoriteWon; }).length;
    var both = picks.filter(function (v) {
      return v.row.marketSide && v.row.marketSide !== "even" && v.side && v.side !== "even";
    });
    var same = both.filter(function (v) { return v.side === v.row.marketSide; }).length;
    var ou = graded.filter(function (r) { return r.ouHit === true || r.ouHit === false; });
    var ouHits = ou.filter(function (r) { return r.ouHit; }).length;
    var agree = both.filter(function (v) { return v.side === v.row.marketSide; });
    var disagree = both.filter(function (v) { return v.side !== v.row.marketSide; });
    var agreeWins = agree.filter(function (v) { return v.won; }).length;
    var disagreeWins = disagree.filter(function (v) { return v.won; }).length;
    function rate(hit, total) {
      if (!total) return "—";
      return hit + " of " + total + " (" + (Math.round((1000 * hit) / total) / 10) + "%)";
    }
    function record(wins, losses) {
      var n = wins + losses;
      if (!n) return "—";
      return wins + "–" + losses + " (" + (Math.round((1000 * wins) / n) / 10) + "%)";
    }
    var modelLine = "";
    if (window.HockeyEdgeModel && state.backtestById) {
      var mn = 0;
      var mr = 0;
      var hiN = 0;
      var hiR = 0;
      var sameN = 0;
      var sameNew = 0;
      var sameOld = 0;
      var newAgree = { n: 0, w: 0 };
      var newDisagree = { n: 0, w: 0 };
      graded.forEach(function (r) {
        var bt = state.backtestById[String(r.id)];
        if (!bt || bt.actualAway === bt.actualHome) return;
        var model = HockeyEdgeModel.fromBacktestRow(bt);
        var homeWon = bt.actualHome > bt.actualAway;
        var ok = (model.pick === "home") === homeWon;
        mn += 1;
        if (ok) mr += 1;
        if (model.pickPct >= 65) {
          hiN += 1;
          if (ok) hiR += 1;
        }
        var oldFirm = r.pointsEdgePickWon === true || r.pointsEdgePickWon === false;
        var firm = oldFirm || r.edgePickWon === true || r.edgePickWon === false;
        if (firm) {
          sameN += 1;
          if (ok) sameNew += 1;
          if (oldFirm ? r.pointsEdgePickWon : r.edgePickWon) sameOld += 1;
          if (r.marketSide && r.marketSide !== "even" && !r.edgeTossUpView) {
            var bucket = (model.pick === r.marketSide) ? newAgree : newDisagree;
            bucket.n += 1;
            if (ok) bucket.w += 1;
          }
        }
      });
      if (mn) {
        modelLine = " New model on every joined final " + rate(mr, mn) +
          ". On the same games as the old Edge rule " + rate(sameNew, sameN) +
          " new and " + rate(sameOld, sameN) + " old" +
          ". New model at 65% or higher " + rate(hiR, hiN) +
          ". New model agreed with the market and won " + rate(newAgree.w, newAgree.n) +
          ". New model disagreed and won " + rate(newDisagree.w, newDisagree.n) + ".";
      }
    }
    box.innerHTML =
      "Edge pick won " + pickWins + " of " + picks.length +
      ". 60%+ win chance " + record(hiWins, hi.length - hiWins) +
      ". Market favorite won " + favWins + " of " + favs.length +
      ". Agreed with the market and won " + rate(agreeWins, agree.length) +
      ". Disagreed and won " + rate(disagreeWins, disagree.length) +
      ". Same side on " + same + " of " + both.length +
      ". Over/under hit " + ouHits + " of " + ou.length +
      ". " + noOdds + " graded game" + (noOdds === 1 ? "" : "s") + " had no saved odds" +
      ". " + toss + " toss-up" + (toss === 1 ? "" : "s") + " excluded from the Edge pick." +
      modelLine;
  }

  function showMeta(text) {
    var el = $("meta");
    if (!el) return;
    if (text) {
      el.hidden = false;
      el.textContent = text;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function renderSummary(sum) {
    $("summary").innerHTML =
      stat(sum.total, "locked") +
      stat(sum.graded, "graded") +
      stat(sum.pending, "pending") +
      stat(sum.exactPct == null ? "—" : sum.exactPct + "%", "exact") +
      stat(sum.winnerPct == null ? "—" : sum.winnerPct + "%", "winner");
  }

  function metaLine(payload) {
    var bits = [];
    if (payload.statsSeasonLabel) bits.push("stats " + payload.statsSeasonLabel);
    if (payload.scoreboardSeasonLabel) bits.push("scoreboard " + payload.scoreboardSeasonLabel);
    if (payload.note) bits.push(payload.note);
    if (payload.storageError) bits.push("not saved (" + payload.storage + ")");
    else if (payload.persisted === false) bits.push("not saved");
    return bits.join(" · ");
  }

  function renderTable() {
    var tbody = document.querySelector("#review tbody");
    var rows = sorted();
    if (!rows.length) {
      var empty = state.rows.length
        ? "No estimates in this range."
        : "No locked estimates yet. Open Matchups so today’s slate is saved. On Vercel that save needs AZURE_STORAGE_CONNECTION_STRING.";
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
          "<td>" + dateLabel(r) + "</td>" +
          "<td>" + (r.awayAbbrev || "") + "</td>" +
          "<td>" + (r.homeAbbrev || "") + "</td>" +
          "<td class='num'>" + (r.projectedLabel || "—") + lockNote + "</td>" +
          "<td class='num'>" + (r.liveLabel || "—") + (r.liveMatchesLock ? " =" : "") + "</td>" +
          "<td class='num'>" + (r.actualLabel || "—") + chanceNote(r) + "</td>" +
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

  function chanceNote(r) {
    if (!window.HockeyEdgeModel) return "";
    var old = HockeyEdgeModel.oldPickPct({
      score: r.edgeScoreView,
      winner: r.edgeWinnerView,
      tossUp: r.edgeTossUpView
    });
    var bt = state.backtestById && state.backtestById[String(r.id)];
    var model = bt ? HockeyEdgeModel.fromBacktestRow(bt) : null;
    var bits = [];
    if (model) bits.push("New " + model.pickAbbrev + " " + model.pickPct + "% " + model.label);
    if (old != null) bits.push("Old " + old + "%");
    else if (r.edgeTossUpView) bits.push("Old toss-up");
    if (!bits.length) return "";
    return "<div class='edge-meta'>" + bits.join(" · ") + "</div>";
  }

  function showLoadError(message) {
    showMeta("Could not load estimates");
    var warn = $("storage-note");
    if (warn) {
      warn.textContent = message;
      warn.classList.remove("hidden");
    }
    if (!state.rows.length) {
      $("summary").textContent = message;
      var tbody = document.querySelector("#review tbody");
      if (tbody) {
        tbody.innerHTML = "<tr><td colspan='10' class='empty'></td></tr>";
        tbody.querySelector(".empty").textContent = message;
      }
    }
  }

  function render(payload) {
    if (payload && payload.error) {
      showLoadError(String(payload.error));
      return;
    }
    payload = payload || {};
    state.payload = payload;
    state.rows = payload.estimates || [];
    state.asOf = payload.asOf || state.asOf;
    var shown = ranged();
    renderAccuracy(shown);
    renderMarket(shown);
    renderSummary(HockeyArchive.summarize(shown));
    showMeta(metaLine(payload));
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

  function saveReviewPrefs() {
    if (!window.HockeyPrefs || !HockeyPrefs.signedIn()) return;
    HockeyPrefs.patch("review", {
      range: ($("range") && $("range").value) || "season",
      sortKey: state.sortKey,
      sortDir: state.sortDir
    });
  }

  function readEstimates(r) {
    return r.json().then(function (body) {
      if (!r.ok || (body && body.error)) {
        throw new Error((body && body.error) || ("HTTP " + r.status));
      }
      return body;
    }, function () {
      throw new Error(r.ok ? "Invalid response" : ("HTTP " + r.status));
    });
  }

  function loadBacktestIndex() {
    return fetch("/api/backtest?season=20262027")
      .then(function (r) { return r.json(); })
      .then(function (body) {
        var map = {};
        ((body && body.rows) || []).forEach(function (row) { map[String(row.id)] = row; });
        state.backtestById = map;
      })
      .catch(function () {
        if (!state.backtestById) state.backtestById = {};
      });
  }

  function load() {
    if (!state.rows.length) showMeta("Loading…");
    if (window.HockeyLoading) HockeyLoading.show();
    Promise.all([
      fetch("/api/estimates?grade=1").then(readEstimates),
      loadBacktestIndex()
    ])
      .then(function (parts) { render(parts[0]); })
      .catch(function (err) {
        showLoadError((err && err.message) || String(err));
      })
      .then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
  }

  document.querySelectorAll("#review th").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = 1; }
      saveReviewPrefs();
      renderTable();
    });
  });

  var range = $("range");
  if (range) range.addEventListener("change", function () {
    saveReviewPrefs();
    render(state.payload || { estimates: state.rows, asOf: state.asOf });
  });

  $("grade").addEventListener("click", function () {
    if (!state.rows.length) showMeta("Grading…");
    if (window.HockeyLoading) HockeyLoading.show();
    fetch("/api/estimates/grade", { method: "POST" })
      .then(function (r) {
        return r.json().then(function (body) {
          if (r.status === 401 || r.status === 403) {
            showMeta("Manual grading needs an admin sign-in. Opening this page still grades the finals.");
            return;
          }
          if (!r.ok || (body && body.error)) {
            throw new Error((body && body.error) || ("HTTP " + r.status));
          }
          render(body);
        }, function () {
          if (r.status === 401 || r.status === 403) {
            showMeta("Manual grading needs an admin sign-in. Opening this page still grades the finals.");
            return;
          }
          throw new Error(r.ok ? "Invalid response" : ("HTTP " + r.status));
        });
      })
      .catch(function (err) {
        showLoadError((err && err.message) || String(err));
      })
      .then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
  });

  function startReview() {
    var saved = window.HockeyPrefs && HockeyPrefs.signedIn() && HockeyPrefs.section("review");
    if (saved) {
      if (saved.range && $("range")) $("range").value = saved.range;
      if (saved.sortKey) state.sortKey = saved.sortKey;
      if (saved.sortDir === 1 || saved.sortDir === -1) state.sortDir = saved.sortDir;
    }
    load();
  }

  if (window.HockeyPrefs) HockeyPrefs.ready.then(startReview);
  else startReview();
})();
