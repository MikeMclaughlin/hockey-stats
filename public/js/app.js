(function () {
  "use strict";

  var state = { data: null, sortKey: "time", sortDir: 1 };

  function $(id) { return document.getElementById(id); }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"
      });
    } catch (e) {
      return iso;
    }
  }

  function signed(n, digits) {
    if (n == null || !isFinite(n)) return "—";
    var v = HockeyStats.round(n, digits == null ? 1 : digits);
    var t = (v > 0 ? "+" : "") + v;
    return v < 0 ? '<span class="num-neg">' + t + "</span>" : t;
  }

  var PILL_TITLES = {
    pdo: "PDO — shooting percentage plus save percentage from shots on goal. 100 is league-normal; much higher is finishing or save luck.",
    last5: "L5 avg GD — average goal differential (GF minus GA) in this team’s last five completed games.",
    last5Sv: "L5 SV% — save percentage over the last five games: (shots against minus goals against) / shots against.",
    sogShare: "SOG share — shots on goal for divided by shots for plus shots against. Above 50% means they take more shots than they allow.",
    xgDiff: "GF vs xGF — actual goals for minus expected goals for. Positive means they have outscored their shot quality.",
    cf: "CF% — Corsi for percentage. Shot attempts for divided by shot attempts for plus against (all situations).",
    hdcf: "HDCF% — high-danger chances for divided by high-danger chances for plus against.",
    xgf5v5: "Even-strength expected-goals share — 5-on-5 expected goals for divided by expected goals for plus against.",
    stXg: "Special-teams expected-goal differential — power-play expected goals minus shorthanded expected goals against."
  };

  function preMark(on) {
    if (!on) return "";
    var label = (state.data && state.data.preseasonLabel) || "2026-27 preseason";
    return "<span class=\"pre\" title=\"" + String(label).replace(/"/g, "") + "\">pre</span>";
  }

  function pill(label, value, kind, fmt, pre) {
    fmt = fmt || function (v) { return v == null ? "—" : String(v); };
    var sign = HockeyStats.pillSign(value, kind);
    var cls = "pill" + (sign ? " " + sign : "");
    var title = PILL_TITLES[kind] || label;
    if (pre) title += " " + ((state.data && state.data.preseasonLabel) || "2026-27 preseason") + ".";
    return (
      '<div class="' + cls + '" title="' + title.replace(/"/g, "&quot;") + '">' +
        '<span class="lab">' + label + (pre ? " " + preMark(true) : "") + "</span>" +
        '<span class="val">' + fmt(value) + "</span>" +
      "</div>"
    );
  }

  function am(n) {
    var t = HockeyStats.formatAmerican ? HockeyStats.formatAmerican(n) : (n == null ? "—" : String(n));
    return (typeof n === "number" && n < 0) ? '<span class="num-neg">' + t + "</span>" : t;
  }

  function oddsLine(m) {
    var o = m.odds;
    if (!o || (o.awayMl == null && o.homeMl == null && o.total == null)) {
      if (m.oddsMissing) {
        return '<p class="odds muted">Odds were not saved for this game.</p>';
      }
      return '<p class="odds muted">Moneyline and over/under not posted yet.</p>';
    }
    var aw = HockeyStats.impliedWinPct ? HockeyStats.impliedWinPct(o.awayMl) : null;
    var hw = HockeyStats.impliedWinPct ? HockeyStats.impliedWinPct(o.homeMl) : null;
    var ml = m.away.abbrev + " " + am(o.awayMl) +
      (aw != null ? " (" + aw + "%)" : "") +
      " · " + m.home.abbrev + " " + am(o.homeMl) +
      (hw != null ? " (" + hw + "%)" : "");
    var ou = o.total != null
      ? "O/U " + o.total + " (O " + am(o.overPrice) + " / U " + am(o.underPrice) + ")"
      : "O/U —";
    var src = o.partner ? " · " + o.partner : "";
    if (o.locked) src += " · saved";
    var hold = HockeyStats.twoWayHold ? HockeyStats.twoWayHold(o.awayMl, o.homeMl) : null;
    var vig = hold != null ? "<span>Hold " + hold + "%</span>" : "";
    return '<p class="odds"><span>Moneyline ' + ml + "</span><span>" + ou.replace("O/U", "Over/under") + src + "</span>" + vig + "</p>";
  }

  function notesLine(m) {
    if (!m.notes) return "";
    return '<p class="notes-row">' + m.notes + "</p>";
  }

  function marketFlag(m) {
    if (!m.marketDisagree) return "";
    var partner = (m.odds && m.odds.partner) || "DraftKings";
    return '<span class="badge warn" title="Model edge and the moneyline favorite are different sides">Edge disagrees with ' +
      partner + " moneyline</span>";
  }

  function teamPills(t) {
    var pre = t.preseason || {};
    return (
      '<div class="pills">' +
        pill("Shooting plus save percentage", t.pdo, "pdo", null, pre.pdo) +
        pill("Average goal differential last five games", t.last5AvgGd, "last5", function (v) { return signed(v, 2); }, pre.last5) +
        pill("Actual goals versus expected goals", t.gfMinusXg, "xgDiff", function (v) { return signed(v, 1); }, false) +
        pill("Shots-on-goal share", t.sogShare, "sogShare", function (v) { return v == null ? "—" : v + "%"; }, pre.sogShare) +
        pill("Save percentage last five games", t.last5SvPct, "last5Sv", function (v) { return v == null ? "—" : v + "%"; }, pre.last5Sv) +
      "</div>"
    );
  }

  function recordLine(t) {
    return "<div>" + t.record + (t.preseason && t.preseason.record ? " " + preMark(true) : "") + "</div>";
  }

  function edgeDetail(e) {
    if (!e || e.measured == null || e.totalMeasures == null) return "";
    var low = !!e.lowData;
    var text = "based on " + e.measured + " of " + e.totalMeasures + " stats";
    if (low) text += " · low data";
    return "<span class=\"edge-meta" + (low ? " low" : "") + "\">" + text + "</span>";
  }

  var SCORE_POLL_MS = 90000;
  var scoreTimer = null;

  function edgeProbTitle() {
    return "Toss-up when the absolute Edge score is under 0.25. The Edge side is 55% until that score reaches 1.75, then 65%. Market is the no-vig moneyline.";
  }

  function scoreInner(m) {
    var s = m.scoreboard || {};
    if (s.away == null || s.home == null || !(s.live || s.final)) return "";
    var num = m.away.abbrev + " " + s.away + " – " + s.home + " " + m.home.abbrev;
    var status = s.status ? '<span class="score-status">' + s.status + "</span>" : "";
    return '<span class="score-num">' + num + "</span>" + status;
  }

  function edgeBadge(m) {
    var e = m.edge || {};
    var title = edgeProbTitle().replace(/"/g, "&quot;");
    if (HockeyStats.isTossUp(e)) {
      return '<span class="badge toss" title="' + title + '">Toss-up</span>';
    }
    if (e.winner === "even") return '<span class="badge even">Even matchup</span>';
    return '<span class="badge">Edge: ' + m.edgeName + "</span>";
  }

  function edgeProbLine(m) {
    var p = HockeyStats.edgeWinProb(m.edge);
    if (!p) return "";
    var side = p.side === "away" ? m.away : m.home;
    var pct = p.side === "away" ? p.away : p.home;
    var text = side.abbrev + " " + pct + "%";
    var nv = HockeyStats.noVigProb(m.odds);
    if (nv) text += " · market " + (p.side === "away" ? nv.away : nv.home) + "%";
    return '<span class="edge-prob" title="' + edgeProbTitle().replace(/"/g, "&quot;") + '">' + text + "</span>";
  }

  function performanceOf(m) {
    var sb = m.scoreboard || {};
    if (!sb.final || sb.away == null || sb.home == null) return null;
    var server = m.performance;
    if (server && server.actualLabel === (sb.away + "–" + sb.home)) return server;
    var saved = m.saved || null;
    var actualAway = Number(sb.away);
    var actualHome = Number(sb.home);
    var projectedAway = saved && saved.projectedAway != null ? Number(saved.projectedAway) : null;
    var projectedHome = saved && saved.projectedHome != null ? Number(saved.projectedHome) : null;
    var missingEstimate = projectedAway == null || projectedHome == null;
    var exact = null;
    var winnerCorrect = null;
    var totalErr = null;
    var marginErr = null;
    if (!missingEstimate && window.HockeyArchive) {
      exact = projectedAway === actualAway && projectedHome === actualHome;
      winnerCorrect = HockeyArchive.winnerOf(projectedAway, projectedHome) === HockeyArchive.winnerOf(actualAway, actualHome);
      var errs = HockeyArchive.scoreErrors({
        projectedAway: projectedAway,
        projectedHome: projectedHome,
        actualAway: actualAway,
        actualHome: actualHome
      });
      totalErr = errs.totalGoalsError;
      marginErr = errs.marginError;
    }
    var edgeCorrect = null;
    var toss = !!(saved && saved.edgeTossUp);
    if (saved && saved.edgeWinner && !toss && saved.edgeWinner !== "even" && window.HockeyArchive) {
      var actualWinner = HockeyArchive.winnerOf(actualAway, actualHome);
      if (actualWinner && actualWinner !== "tie") edgeCorrect = saved.edgeWinner === actualWinner;
    }
    return {
      estimateLabel: missingEstimate ? null : projectedAway + "–" + projectedHome,
      actualLabel: actualAway + "–" + actualHome,
      exact: exact,
      winnerCorrect: winnerCorrect,
      totalGoalsError: totalErr,
      marginError: marginErr,
      edgeAbbrev: saved ? saved.edgeAbbrev : null,
      edgeCorrect: edgeCorrect,
      tossUp: toss,
      edgeSource: saved ? saved.edgeSource : null,
      missingEstimate: missingEstimate,
      missingEdge: !(saved && saved.edgeWinner)
    };
  }

  function resultInner(m) {
    var p = performanceOf(m);
    if (!p) return "";
    var bits = [];
    if (p.missingEstimate) bits.push("No saved estimate");
    else {
      bits.push("Estimate " + p.estimateLabel + " vs actual " + p.actualLabel);
      if (p.exact) bits.push("exact score");
      else bits.push(p.winnerCorrect ? "winner right" : "winner wrong");
      if (p.totalGoalsError != null) bits.push("total off by " + p.totalGoalsError);
      if (p.marginError != null) bits.push("margin off by " + p.marginError);
    }
    if (p.missingEdge) bits.push("No saved Edge pick");
    else if (p.tossUp) bits.push("Toss-up, no firm pick");
    else if (p.edgeCorrect == null) bits.push("Edge pick " + (p.edgeAbbrev || "") + " not graded");
    else bits.push("Edge pick " + (p.edgeAbbrev || "") + (p.edgeCorrect ? " was right" : " was wrong"));
    if (p.edgeSource === "archive") bits.push("pick from saved pre-game stats");
    return bits.join(" · ");
  }

  function extraPills(t) {
    return (
      '<div class="pills">' +
        pill("Shot-attempt share", t.cfPct, "cf", function (v) { return v == null ? "—" : v + "%"; }) +
        pill("High-danger chance share", t.hdcfPct, "hdcf", function (v) { return v == null ? "—" : v + "%"; }) +
        pill("Even-strength expected-goals share", t.xgfPct5v5, "xgf5v5", function (v) { return v == null ? "—" : v + "%"; }) +
        pill("Special-teams expected goals", t.stXg, "stXg", function (v) { return signed(v, 1); }) +
      "</div>"
    );
  }

  function renderCards(matchups) {
    var root = $("cards");
    if (!matchups.length) {
      root.innerHTML = '<div class="empty">No games on the current NHL scoreboard. The board will pick up the next published slate.</div>';
      return;
    }
    root.innerHTML = matchups.map(function (m) {
      var e = m.edge || {};
      var why = m.why || HockeyStats.explainEdge(e, m.away, m.home);
      var proj = m.projected || HockeyStats.estimateScore(m.away, m.home);
      return (
        '<article class="card" id="game-' + m.id + '">' +
          '<div class="card-head">' +
            '<div class="head-top">' +
              "<span>" + fmtTime(m.startTimeUTC) + (m.venue ? " · " + m.venue : "") +
                (m.gameTypeLabel ? " · " + m.gameTypeLabel : "") + "</span>" +
              '<span class="proj">Est. ' + m.away.abbrev + " " + proj.away + " – " + proj.home + " " + m.home.abbrev + "</span>" +
              '<span class="score-line" data-score="' + m.id + '">' + scoreInner(m) + "</span>" +
              edgeBadge(m) +
              edgeProbLine(m) +
              edgeDetail(e) +
              marketFlag(m) +
            "</div>" +
            oddsLine(m) +
            '<p class="result-line" data-result="' + m.id + '">' + resultInner(m) + "</p>" +
            '<p class="why">' + why + "</p>" +
          "</div>" +
          '<div class="sides">' +
            '<div class="col">' +
              '<div class="team away">' +
                (m.away.logo ? '<img src="' + m.away.logo + '" alt="">' : "") +
                "<div><h3>" + m.away.name + "</h3>" + recordLine(m.away) + "</div>" +
              "</div>" +
              teamPills(m.away) +
            "</div>" +
            '<div class="vs">@</div>' +
            '<div class="col">' +
              '<div class="team home">' +
                (m.home.logo ? '<img src="' + m.home.logo + '" alt="">' : "") +
                "<div><h3>" + m.home.name + "</h3>" + recordLine(m.home) + "</div>" +
              "</div>" +
              teamPills(m.home) +
            "</div>" +
          "</div>" +
          '<details class="more-stats">' +
            "<summary>Shot-attempt share, high-danger chances, and expected goals</summary>" +
            '<div class="sides more-sides">' +
              '<div class="col">' + extraPills(m.away) + "</div>" +
              '<div class="vs"></div>' +
              '<div class="col">' + extraPills(m.home) + "</div>" +
            "</div>" +
          "</details>" +
          notesLine(m) +
        "</article>"
      );
    }).join("");
  }

  function rowValue(m, key) {
    if (key === "time") return m.startTimeUTC || "";
    if (key === "score") {
      var sb = m.scoreboard || {};
      if (sb.away == null || sb.home == null) return "";
      return sb.away + "-" + sb.home;
    }
    if (key === "away") return m.away.abbrev;
    if (key === "home") return m.home.abbrev;
    if (key === "edge") return m.edge ? m.edge.score : 0;
    if (key === "awayRecord") return m.away.ptsPct || 0;
    if (key === "homeRecord") return m.home.ptsPct || 0;
    if (key === "gd") return (m.away.goalDiff || 0) - (m.home.goalDiff || 0);
    if (key === "pdo") return (m.away.pdo || 0) - (m.home.pdo || 0);
    if (key === "l5") return (m.away.last5AvgGd || 0) - (m.home.last5AvgGd || 0);
    if (key === "sog") return (m.away.sogShare || 0) - (m.home.sogShare || 0);
    if (key === "xg") return (m.away.gfMinusXg || 0) - (m.home.gfMinusXg || 0);
    if (key === "cf") return (m.away.cfPct || 0) - (m.home.cfPct || 0);
    if (key === "hdcf") return (m.away.hdcfPct || 0) - (m.home.hdcfPct || 0);
    if (key === "xgf5") return (m.away.xgfPct5v5 || 0) - (m.home.xgfPct5v5 || 0);
    if (key === "mlAway") return (m.odds && m.odds.awayMl) || 0;
    if (key === "mlHome") return (m.odds && m.odds.homeMl) || 0;
    if (key === "ou") return (m.odds && m.odds.total) || 0;
    if (key === "proj") {
      var p = m.projected || {};
      return (p.home || 0) - (p.away || 0);
    }
    return "";
  }

  function sortedRows() {
    var rows = (state.data && state.data.matchups) || [];
    var key = state.sortKey;
    var dir = state.sortDir;
    return rows.slice().sort(function (a, b) {
      var av = rowValue(a, key);
      var bv = rowValue(b, key);
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
  }

  function renderTable() {
    var tbody = document.querySelector("#board tbody");
    var rows = sortedRows();
    tbody.innerHTML = rows.map(function (m) {
      return (
        "<tr data-game='" + m.id + "'>" +
          "<td>" + fmtTime(m.startTimeUTC) + "</td>" +
          "<td>" + m.away.abbrev + " " + m.away.record + (m.away.preseason && m.away.preseason.record ? " " + preMark(true) : "") + "</td>" +
          "<td>" + m.home.abbrev + " " + m.home.record + (m.home.preseason && m.home.preseason.record ? " " + preMark(true) : "") + "</td>" +
          "<td class='num score-cell' data-score='" + m.id + "'>" + scoreInner(m) + "</td>" +
          "<td class='num'>" + (HockeyStats.isTossUp(m.edge) ? "Toss-up" : m.edgeTeam) +
            (m.edge && m.edge.measured != null ? "<div class='edge-meta" + (m.edge.lowData ? " low" : "") + "'>" +
              m.edge.measured + " of " + m.edge.totalMeasures + (m.edge.lowData ? " · low data" : "") + "</div>" : "") +
            (m.marketDisagree ? " <span class='mark miss' title='Disagrees with the DraftKings moneyline'>≠ DK</span>" : "") +
          "</td>" +
          "<td>" + m.away.record + (m.away.preseason && m.away.preseason.record ? " " + preMark(true) : "") + "</td>" +
          "<td>" + m.home.record + (m.home.preseason && m.home.preseason.record ? " " + preMark(true) : "") + "</td>" +
          "<td class='num'>" + signed((m.away.goalDiff || 0) - (m.home.goalDiff || 0), 0) + "</td>" +
          "<td class='num'>" + signed((m.away.pdo || 0) - (m.home.pdo || 0), 1) + "</td>" +
          "<td class='num'>" + signed((m.away.last5AvgGd || 0) - (m.home.last5AvgGd || 0), 2) + "</td>" +
          "<td class='num'>" + signed((m.away.sogShare || 0) - (m.home.sogShare || 0), 1) + "</td>" +
          "<td class='num'>" + signed((m.away.gfMinusXg || 0) - (m.home.gfMinusXg || 0), 1) + "</td>" +
          "<td class='num'>" + signed((m.away.cfPct || 0) - (m.home.cfPct || 0), 1) + "</td>" +
          "<td class='num'>" + signed((m.away.hdcfPct || 0) - (m.home.hdcfPct || 0), 1) + "</td>" +
          "<td class='num'>" + signed((m.away.xgfPct5v5 || 0) - (m.home.xgfPct5v5 || 0), 1) + "</td>" +
          "<td class='num'>" + ((m.projected && m.projected.label) || "—") + "</td>" +
          "<td class='num'>" + am(m.odds && m.odds.awayMl) + "</td>" +
          "<td class='num'>" + am(m.odds && m.odds.homeMl) + "</td>" +
          "<td class='num'>" + ((m.odds && m.odds.total != null) ? m.odds.total : "—") + "</td>" +
        "</tr>"
      );
    }).join("");
    document.querySelectorAll("#board th").forEach(function (th) {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.getAttribute("data-key") === state.sortKey) {
        th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
    });
  }

  function render(data) {
    state.data = data;
    var scoreLabel = data.scoreboardSeasonLabel || "";
    var statsLabel = data.statsSeasonLabel || "";
    $("meta").textContent =
      (data.currentDate || "") +
      (scoreLabel ? " · scoreboard " + scoreLabel : "") +
      (statsLabel ? " · stats " + statsLabel : "") +
      " · " + (data.matchupCount || 0) + " games";
    var prev = $("prev-date");
    var next = $("next-date");
    if (prev) {
      prev.disabled = !data.prevDate;
      prev.dataset.date = data.prevDate || "";
    }
    if (next) {
      next.disabled = !data.nextDate;
      next.dataset.date = data.nextDate || "";
    }
    var note = $("note");
    var text = data.note || "";
    if (data.storageError) {
      text = (text ? text + " " : "") + "Estimates were not saved: " + data.storageError;
    }
    if (text) {
      note.textContent = text;
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }
    renderCards(data.matchups || []);
    renderTable();
    armScores();
    document.querySelectorAll("#board tbody tr[data-game]").forEach(function (tr) {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", function () {
        var el = document.getElementById("game-" + tr.getAttribute("data-game"));
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function boardQuery(refresh) {
    var q = new URLSearchParams(location.search);
    var params = new URLSearchParams();
    if (q.get("date")) params.set("date", q.get("date"));
    if (refresh) params.set("refresh", "1");
    var s = params.toString();
    return "/api/matchups" + (s ? "?" + s : "");
  }

  function goDate(date) {
    var q = new URLSearchParams(location.search);
    if (date) q.set("date", date);
    else q.delete("date");
    var s = q.toString();
    location.search = s ? "?" + s : "";
  }

  function anyLive() {
    return ((state.data && state.data.matchups) || []).some(function (m) {
      return m.scoreboard && m.scoreboard.live;
    });
  }

  function paintScores() {
    ((state.data && state.data.matchups) || []).forEach(function (m) {
      document.querySelectorAll('[data-score="' + m.id + '"]').forEach(function (el) {
        el.innerHTML = scoreInner(m);
      });
      document.querySelectorAll('[data-result="' + m.id + '"]').forEach(function (el) {
        el.textContent = resultInner(m);
      });
    });
  }

  function applyScorePayload(body) {
    var byId = {};
    (body.games || []).forEach(function (g) { byId[String(g.id)] = g; });
    ((state.data && state.data.matchups) || []).forEach(function (m) {
      var g = byId[String(m.id)];
      if (!g) return;
      var prev = m.scoreboard || {};
      if ((g.final || prev.final) && g.away == null && prev.away != null && prev.home != null) {
        g = Object.assign({}, g, {
          away: prev.away,
          home: prev.home,
          final: true,
          live: false,
          status: g.status || prev.status || "Final"
        });
      }
      m.scoreboard = {
        away: g.away,
        home: g.home,
        state: g.state,
        live: !!g.live,
        final: !!g.final,
        status: g.status,
        period: g.period,
        clock: g.clock
      };
      if (g.state) m.gameState = g.state;
    });
    paintScores();
    if (!anyLive() && scoreTimer) {
      clearInterval(scoreTimer);
      scoreTimer = null;
    }
  }

  function refreshScores() {
    var q = new URLSearchParams(location.search);
    var url = "/api/scores" + (q.get("date") ? "?date=" + encodeURIComponent(q.get("date")) : "");
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(applyScorePayload)
      .catch(function () {});
  }

  function armScores() {
    if (scoreTimer) {
      clearInterval(scoreTimer);
      scoreTimer = null;
    }
    if (!anyLive()) return;
    refreshScores();
    scoreTimer = setInterval(refreshScores, SCORE_POLL_MS);
  }

  function load(refresh) {
    $("meta").textContent = "Loading…";
    fetch(boardQuery(refresh))
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (err) {
        $("meta").textContent = "Could not load matchups";
        $("cards").innerHTML = '<div class="empty">' + String(err) + "</div>";
      });
  }

  document.querySelectorAll("#board th").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = 1; }
      var q = new URLSearchParams(location.search);
      q.set("sort", state.sortKey);
      q.set("dir", String(state.sortDir));
      history.replaceState(null, "", "/?" + q.toString());
      renderTable();
    });
  });
  (function bootQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get("sort")) state.sortKey = q.get("sort");
    if (q.get("dir")) state.sortDir = Number(q.get("dir")) || 1;
  })();

  $("refresh").addEventListener("click", function () { load(true); });
  var prevBtn = $("prev-date");
  var nextBtn = $("next-date");
  var todayBtn = $("today-date");
  if (prevBtn) prevBtn.addEventListener("click", function () { if (prevBtn.dataset.date) goDate(prevBtn.dataset.date); });
  if (nextBtn) nextBtn.addEventListener("click", function () { if (nextBtn.dataset.date) goDate(nextBtn.dataset.date); });
  if (todayBtn) todayBtn.addEventListener("click", function () { goDate(""); });
  load(false);
})();
