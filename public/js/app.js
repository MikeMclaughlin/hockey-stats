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

  function pill(label, value, kind, fmt) {
    fmt = fmt || function (v) { return v == null ? "—" : String(v); };
    var sign = HockeyStats.pillSign(value, kind);
    var cls = "pill" + (sign ? " " + sign : "");
    var title = PILL_TITLES[kind] || label;
    return (
      '<div class="' + cls + '" title="' + title.replace(/"/g, "&quot;") + '">' +
        '<span class="lab">' + label + "</span>" +
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
    return (
      '<div class="pills">' +
        pill("Shooting plus save percentage", t.pdo, "pdo") +
        pill("Average goal differential last five games", t.last5AvgGd, "last5", function (v) { return signed(v, 2); }) +
        pill("Actual goals versus expected goals", t.gfMinusXg, "xgDiff", function (v) { return signed(v, 1); }) +
        pill("Shots-on-goal share", t.sogShare, "sogShare", function (v) { return v == null ? "—" : v + "%"; }) +
        pill("Save percentage last five games", t.last5SvPct, "last5Sv", function (v) { return v == null ? "—" : v + "%"; }) +
      "</div>"
    );
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
              '<span class="badge ' + (e.winner === "even" ? "even" : "") + '">' +
                (e.winner === "even" ? "Even matchup" : "Edge: " + m.edgeName) +
              "</span>" +
              marketFlag(m) +
            "</div>" +
            oddsLine(m) +
            '<p class="why">' + why + "</p>" +
          "</div>" +
          '<div class="sides">' +
            '<div class="col">' +
              '<div class="team away">' +
                (m.away.logo ? '<img src="' + m.away.logo + '" alt="">' : "") +
                "<div><h3>" + m.away.name + "</h3><div>" + m.away.record + "</div></div>" +
              "</div>" +
              teamPills(m.away) +
            "</div>" +
            '<div class="vs">@</div>' +
            '<div class="col">' +
              '<div class="team home">' +
                (m.home.logo ? '<img src="' + m.home.logo + '" alt="">' : "") +
                "<div><h3>" + m.home.name + "</h3><div>" + m.home.record + "</div></div>" +
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
          "<td>" + m.away.abbrev + " " + m.away.record + "</td>" +
          "<td>" + m.home.abbrev + " " + m.home.record + "</td>" +
          "<td class='num'>" + m.edgeTeam +
            (m.marketDisagree ? " <span class='mark miss' title='Disagrees with the DraftKings moneyline'>≠ DK</span>" : "") +
          "</td>" +
          "<td>" + m.away.record + "</td>" +
          "<td>" + m.home.record + "</td>" +
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
