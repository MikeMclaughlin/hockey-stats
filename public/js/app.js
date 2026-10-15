(function () {
  "use strict";

  var state = { data: null, sortKey: "pdo", sortDir: -1, filters: {}, cardsExpanded: false };
  var CARDS_KEY = "hs-cards-expanded";

  var SORT_FIELDS = [
    ["pdo", "PDO gap"],
    ["time", "Game start time"],
    ["away", "Away"],
    ["home", "Home"],
    ["score", "Score"],
    ["edge", "Edge"],
    ["awayRecord", "Away record"],
    ["homeRecord", "Home record"],
    ["gd", "Goal diff gap"],
    ["l5", "Last five GD"],
    ["sog", "Shot share gap"],
    ["xg", "Goals vs xG"],
    ["cf", "Corsi gap"],
    ["hdcf", "High danger gap"],
    ["xgf5", "Even strength xG"],
    ["proj", "Estimate"],
    ["mlAway", "Away line"],
    ["mlHome", "Home line"],
    ["ou", "Total"]
  ];
  var FILTER_NUMERIC = {
    gd: true, pdo: true, l5: true, sog: true, xg: true, cf: true,
    hdcf: true, xgf5: true, mlAway: true, mlHome: true, ou: true
  };

  function $(id) { return document.getElementById(id); }

  function fmtTime(iso) {
    if (window.HockeyDates) return HockeyDates.formatTableDate(iso);
    return iso || "—";
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
    var model = modelOf(m);
    var side = model ? model.pick : (m.edge && m.edge.winner);
    var market = m.marketSide;
    var disagree = !!(market && market !== "even" && side && side !== market);
    if (!disagree && !m.marketDisagree) return "";
    if (!disagree) return "";
    var partner = (m.odds && m.odds.partner) || "DraftKings";
    return '<span class="badge warn" title="Model edge and the moneyline favorite are different sides">Edge disagrees with ' +
      partner + " moneyline</span>";
  }

  function teamPills(t) {
    var pre = t.preseason || {};
    return (
      '<div class="pills">' +
        pill("Shooting plus save percentage", t.pdo, "pdo", null, pre.pdo) +
        pill("Shots-on-goal share", t.sogShare, "sogShare", function (v) { return v == null ? "—" : v + "%"; }, pre.sogShare) +
        pill("Save percentage last five games", t.last5SvPct, "last5Sv", function (v) { return v == null ? "—" : v + "%"; }, pre.last5Sv) +
      "</div>"
    );
  }

  function recordLine(t) {
    return "<div>" + t.record + (t.preseason && t.preseason.record ? " " + preMark(true) : "") + "</div>";
  }

  function modelOf(m) {
    if (!window.HockeyEdgeModel) return null;
    return HockeyEdgeModel.fromMatchup(m);
  }

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var SCORE_POLL_MS = 90000;
  var scoreTimer = null;

  function scoreInner(m) {
    var s = m.scoreboard || {};
    if (s.away == null || s.home == null || !(s.live || s.final)) return "";
    var num = m.away.abbrev + " " + s.away + " – " + s.home + " " + m.home.abbrev;
    var status = s.status ? '<span class="score-status">' + s.status + "</span>" : "";
    return '<span class="score-num">' + num + "</span>" + status;
  }

  function cardScoreInner(m) {
    var s = m.scoreboard || {};
    if (s.away == null || s.home == null || !(s.live || s.final)) return "";
    var num = esc(m.away.abbrev) + " " + s.away + " – " + s.home + " " + esc(m.home.abbrev);
    var label = "Final";
    var tail = "";
    if (s.final) {
      var status = s.status ? String(s.status) : "Final";
      if (status.indexOf("Final") === 0) label = status;
      else tail = status;
    } else {
      label = "Live";
      if (s.status) tail = String(s.status);
    }
    return '<span class="score-label">' + esc(label) + ':</span> <span class="score-num">' + num + "</span>" +
      (tail ? '<span class="score-status">' + esc(tail) + "</span>" : "");
  }

  function edgeBadge(m) {
    var model = modelOf(m);
    var abbrev = model ? model.pickAbbrev : (m.edgeTeam || "");
    if (!abbrev || abbrev === "EVEN") return '<span class="badge even">Even matchup</span>';
    return '<span class="badge">Edge: ' + esc(abbrev) + "</span>";
  }

  function labelTag(model) {
    if (!model) return "";
    var cls = model.label === "Confident" ? "confident" : model.label === "Toss-up" ? "toss" : "lean";
    var title = HockeyEdgeModel.labelTitle(model);
    if (model.confidentPick && model.label === "Confident") {
      title += " Confident pick: the Edge, the projected winner, and last-five xG share agree, and the pick is not on a back-to-back against a rested opponent.";
    }
    return '<span class="pick-label ' + cls + '" title="' + esc(title) + '">' + esc(model.label) + "</span>";
  }

  function edgeProbLine(m) {
    var model = modelOf(m);
    if (!model) return "";
    var text = model.pickAbbrev + " " + model.pickPct + "%";
    var nv = HockeyStats.noVigProb(m.odds);
    if (nv) text += " · market " + (model.pick === "away" ? nv.away : nv.home) + "%";
    var title = "Calibrated win chance for the Edge pick. Market is the no-vig moneyline.";
    if (model.oldPct != null) title += " Previous rule: " + model.oldPct + "%.";
    return '<span class="edge-prob" title="' + esc(title) + '">' + esc(text) + "</span>";
  }

  function chipRow(model) {
    if (!model || !model.chips || !model.chips.length) return "";
    return '<div class="card-chips">' + model.chips.map(function (chip) {
      return '<span class="signal-chip' + (chip.strong ? " strong" : "") + '" title="' + esc(chip.title) + '">' + esc(chip.text) + "</span>";
    }).join("") + "</div>";
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
    var pre = t.preseason || {};
    return (
      '<div class="pills">' +
        pill("Average goal differential last five games", t.last5AvgGd, "last5", function (v) { return signed(v, 2); }, pre.last5) +
        pill("Actual goals versus expected goals", t.gfMinusXg, "xgDiff", function (v) { return signed(v, 1); }, false) +
        pill("Shot-attempt share", t.cfPct, "cf", function (v) { return v == null ? "—" : v + "%"; }) +
        pill("High-danger chance share", t.hdcfPct, "hdcf", function (v) { return v == null ? "—" : v + "%"; }) +
        pill("Even-strength expected-goals share", t.xgfPct5v5, "xgf5v5", function (v) { return v == null ? "—" : v + "%"; }) +
        pill("Special-teams expected goals", t.stXg, "stXg", function (v) { return signed(v, 1); }) +
      "</div>"
    );
  }

  function detailBlock(m, model) {
    var a = m.away || {};
    var h = m.home || {};
    var fmtNum = function (v) { return v == null || v === "" ? "—" : String(v); };
    var fmtPct = function (v) { return v == null ? "—" : v + "%"; };
    var rows = [
      ["Record", a.record, h.record, fmtNum, "Season record: wins, losses, and overtime losses."],
      ["PDO", a.pdo, h.pdo, fmtNum, "PDO: shooting percentage plus save percentage from shots on goal. 100 is league-normal; much higher is finishing or save luck."],
      ["Last five GD", a.last5AvgGd, h.last5AvgGd, fmtNum, "Average goal differential, goals for minus goals against, over this team’s last five completed games."],
      ["Last five SV%", a.last5SvPct, h.last5SvPct, fmtPct, "Save percentage over the last five games: shots against minus goals against, divided by shots against."],
      ["Last five xG share", a.last5XgfPct, h.last5XgfPct, fmtPct, "Expected-goals share over the last five games: expected goals for divided by expected goals for plus against."],
      ["SOG share", a.sogShare, h.sogShare, fmtPct, "Shots on goal for divided by shots for plus shots against. Above 50% means they take more shots than they allow."],
      ["GF vs xGF", a.gfMinusXg, h.gfMinusXg, fmtNum, "Actual goals for minus expected goals for. Positive means they have outscored their shot quality."],
      ["Corsi", a.cfPct, h.cfPct, fmtPct, "Corsi for percentage: shot attempts for divided by shot attempts for plus against, all situations."],
      ["High danger", a.hdcfPct, h.hdcfPct, fmtPct, "High-danger chances for divided by high-danger chances for plus against."],
      ["Even-strength xG", a.xgfPct5v5, h.xgfPct5v5, fmtPct, "Even-strength expected-goals share: 5-on-5 expected goals for divided by expected goals for plus against."],
      ["Special-teams xG", a.stXg, h.stXg, fmtNum, "Special-teams expected-goal differential: power-play expected goals minus shorthanded expected goals against."],
      ["Points %", a.ptsPct, h.ptsPct, fmtNum, "Points percentage: points earned divided by points available."]
    ];
    var list = rows.map(function (row) {
      return "<tr><th scope=\"row\" title=\"" + esc(row[4]) + "\">" + esc(row[0]) + "</th>" +
        "<td class=\"num\">" + esc(row[3](row[1])) + "</td>" +
        "<td class=\"num\">" + esc(row[3](row[2])) + "</td></tr>";
    }).join("");
    var early = model && model.earlySeason
      ? '<p class="early-note">Early season, lower confidence</p>'
      : "";
    var confident = model && model.confidentPick
      ? '<p class="early-note">Confident pick: Edge, projected winner, and last-five xG share agree, and the pick is not on a back-to-back against a rested opponent.</p>'
      : "";
    var old = model && model.oldPct != null
      ? '<p class="early-note">Previous rule ' + model.oldPct + "%.</p>"
      : "";
    return (
      "<table class=\"detail-stats\"><thead><tr>" +
        "<th scope=\"col\">Stat</th>" +
        "<th scope=\"col\" class=\"num\">" + esc(a.abbrev) + "</th>" +
        "<th scope=\"col\" class=\"num\">" + esc(h.abbrev) + "</th>" +
      "</tr></thead><tbody>" + list + "</tbody></table>" +
      early + confident + old +
      oddsLine(m) +
      '<p class="result-line" data-result="' + m.id + '">' + resultInner(m) + "</p>" +
      '<p class="why">' + (m.why || HockeyStats.explainEdge(m.edge, m.away, m.home)) + "</p>" +
      notesLine(m) +
      marketFlag(m)
    );
  }

  function renderCards(matchups) {
    var root = $("cards");
    if (!matchups.length) {
      root.innerHTML = '<div class="empty">No games on the current NHL scoreboard. The board will pick up the next published slate.</div>';
      return;
    }
    root.innerHTML = matchups.map(function (m) {
      var model = modelOf(m);
      var proj = m.projected || HockeyStats.estimateScore(m.away, m.home);
      return (
        '<article class="card" id="game-' + m.id + '">' +
          '<div class="card-head">' +
            '<div class="sides">' +
              '<div class="col">' +
                '<div class="team away">' +
                  (m.away.logo ? '<img src="' + esc(m.away.logo) + '" alt="">' : "") +
                  "<div><h3>" + esc(m.away.name) + "</h3>" + recordLine(m.away) + "</div>" +
                "</div>" +
              "</div>" +
              '<div class="vs">@</div>' +
              '<div class="col">' +
                '<div class="team home">' +
                  (m.home.logo ? '<img src="' + esc(m.home.logo) + '" alt="">' : "") +
                  "<div><h3>" + esc(m.home.name) + "</h3>" + recordLine(m.home) + "</div>" +
                "</div>" +
              "</div>" +
            "</div>" +
            '<div class="card-teams">' +
              '<p class="card-kicker">' + esc(fmtTime(m.startTimeUTC)) +
                (m.gameTypeLabel ? " · " + esc(m.gameTypeLabel) : "") + "</p>" +
            "</div>" +
            '<p class="card-row proj">Est. ' + esc(m.away.abbrev) + " " + proj.away + " – " + proj.home + " " + esc(m.home.abbrev) + "</p>" +
            '<div class="card-row pick-row">' + edgeBadge(m) + labelTag(model) + "</div>" +
            '<p class="card-row">' + edgeProbLine(m) + "</p>" +
            chipRow(model) +
            '<p class="card-row score-line card-score' + ((m.scoreboard && m.scoreboard.live) ? " live" : "") + '" data-score="' + m.id + '">' + cardScoreInner(m) + "</p>" +
          "</div>" +
          '<details class="card-details"' + (state.cardsExpanded ? " open" : "") + ">" +
            "<summary>Details</summary>" +
            detailBlock(m, model) +
          "</details>" +
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
    if (key === "edge") {
      var model = modelOf(m);
      return model ? model.pickPct : (m.edge ? m.edge.score : 0);
    }
    if (key === "awayRecord") return m.away.ptsPct || 0;
    if (key === "homeRecord") return m.home.ptsPct || 0;
    if (key === "gd") return (m.away.goalDiff || 0) - (m.home.goalDiff || 0);
    if (key === "pdo") return pdoGapAbs(m);
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

  function pdoGapAbs(m) {
    var ap = m.away && m.away.pdo;
    var hp = m.home && m.home.pdo;
    if (ap == null || hp == null || !isFinite(Number(ap)) || !isFinite(Number(hp))) return null;
    return Math.abs(Number(ap) - Number(hp));
  }

  function filterDisplay(m, key) {
    var model = modelOf(m);
    if (key === "time") return fmtTime(m.startTimeUTC);
    if (key === "score") {
      var sb = m.scoreboard || {};
      if (sb.away == null || sb.home == null) return "";
      return sb.away + "-" + sb.home;
    }
    if (key === "away") return m.away.abbrev + " " + (m.away.record || "");
    if (key === "home") return m.home.abbrev + " " + (m.home.record || "");
    if (key === "edge") return model ? (model.pickAbbrev + " " + model.label) : (m.edgeTeam || "");
    if (key === "awayRecord") return m.away.record || "";
    if (key === "homeRecord") return m.home.record || "";
    if (key === "gd") return (m.away.goalDiff || 0) - (m.home.goalDiff || 0);
    if (key === "pdo") return (m.away.pdo || 0) - (m.home.pdo || 0);
    if (key === "l5") return (m.away.last5AvgGd || 0) - (m.home.last5AvgGd || 0);
    if (key === "sog") return (m.away.sogShare || 0) - (m.home.sogShare || 0);
    if (key === "xg") return (m.away.gfMinusXg || 0) - (m.home.gfMinusXg || 0);
    if (key === "cf") return (m.away.cfPct || 0) - (m.home.cfPct || 0);
    if (key === "hdcf") return (m.away.hdcfPct || 0) - (m.home.hdcfPct || 0);
    if (key === "xgf5") return (m.away.xgfPct5v5 || 0) - (m.home.xgfPct5v5 || 0);
    if (key === "proj") return (m.projected && m.projected.label) || "";
    if (key === "mlAway") return m.odds && m.odds.awayMl;
    if (key === "mlHome") return m.odds && m.odds.homeMl;
    if (key === "ou") return m.odds && m.odds.total;
    return "";
  }

  function passesFilters(m) {
    if (!window.TableFilter) return true;
    var display = {};
    Object.keys(state.filters).forEach(function (key) {
      display[key] = filterDisplay(m, key);
    });
    return TableFilter.rowMatches(display, state.filters, FILTER_NUMERIC);
  }

  function sortedRows() {
    var rows = ((state.data && state.data.matchups) || []).filter(passesFilters);
    var key = state.sortKey;
    var dir = state.sortDir;
    return rows.slice().sort(function (a, b) {
      var av = rowValue(a, key);
      var bv = rowValue(b, key);
      var aMissing = av == null || av === "";
      var bMissing = bv == null || bv === "";
      if (key === "pdo") {
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
      }
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * dir;
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
  }

  function boardEdge(m) {
    var model = modelOf(m);
    var abbrev = model ? model.pickAbbrev : (HockeyStats.isTossUp(m.edge) ? "Toss-up" : m.edgeTeam);
    var label = model ? "<div class='edge-meta'>" + esc(model.label) + "</div>" : "";
    var tag = model && model.confidentPick ? "<div class='edge-meta'>Confident pick</div>" : "";
    var measured = m.edge && m.edge.measured != null
      ? "<div class='edge-meta" + (m.edge.lowData ? " low" : "") + "'>" +
        m.edge.measured + " of " + m.edge.totalMeasures + (m.edge.lowData ? " · low data" : "") + "</div>"
      : "";
    var modelSide = model ? model.pick : (m.edge && m.edge.winner);
    var disagree = !!(m.marketSide && m.marketSide !== "even" && modelSide && modelSide !== m.marketSide);
    var market = disagree ? " <span class='mark miss' title='Disagrees with the DraftKings moneyline'>≠ DK</span>" : "";
    return esc(abbrev) + label + tag + measured + market;
  }

  function visibleRows() {
    return sortedRows();
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
          "<td class='num'>" + boardEdge(m) + "</td>" +
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
    document.querySelectorAll("#board thead tr:first-child th").forEach(function (th) {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.getAttribute("data-key") === state.sortKey) {
        th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
    });
  }

  function render(data) {
    state.data = data;
    rememberBoard(data);
    var scoreLabel = data.scoreboardSeasonLabel || "";
    var statsLabel = data.statsSeasonLabel || "";
    var slate = data.currentDate || "";
    if (slate && window.HockeyDates) slate = HockeyDates.formatTableDate(slate);
    $("meta").textContent =
      slate +
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
    renderCards(visibleRows());
    renderTable();
    syncSortControl();
    syncCardsButton();
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
    history.pushState(null, "", s ? "/?" + s : "/");
    load(false);
  }

  function anyLive() {
    return ((state.data && state.data.matchups) || []).some(function (m) {
      return m.scoreboard && m.scoreboard.live;
    });
  }

  function paintScores() {
    ((state.data && state.data.matchups) || []).forEach(function (m) {
      document.querySelectorAll('[data-score="' + m.id + '"]').forEach(function (el) {
        if (el.classList.contains("card-score")) {
          el.innerHTML = cardScoreInner(m);
          el.classList.toggle("live", !!(m.scoreboard && m.scoreboard.live));
        } else {
          el.innerHTML = scoreInner(m);
        }
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

  function readBoard(r) {
    return r.json().then(function (body) {
      var failed = !r.ok || (body && body.error);
      if (failed) throw new Error((body && body.error) || ("HTTP " + r.status));
      return body;
    }, function () {
      throw new Error(r.ok ? "Invalid response" : ("HTTP " + r.status));
    });
  }

  function boardCacheKey() {
    var q = new URLSearchParams(location.search);
    return "hs-board:" + (q.get("date") || "now");
  }

  function rememberBoard(data) {
    try {
      if (!data || !data.matchups || !data.matchups.length) return;
      sessionStorage.setItem(boardCacheKey(), JSON.stringify(data));
    } catch (e) { /* private mode or a full store */ }
  }

  function recallBoard() {
    try {
      var raw = sessionStorage.getItem(boardCacheKey());
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.matchups || !data.matchups.length) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function load(refresh) {
    if (!state.data) $("meta").textContent = "Loading…";
    if (window.HockeyLoading) HockeyLoading.show();
    fetch(boardQuery(refresh))
      .then(readBoard)
      .then(render)
      .catch(function (err) {
        var message = (err && err.message) || String(err);
        var note = $("note");
        if (state.data) {
          if (note) {
            note.textContent = message;
            note.classList.remove("hidden");
          }
        } else if (note) {
          $("meta").textContent = "Could not load matchups";
          note.textContent = message;
          note.classList.remove("hidden");
          $("cards").innerHTML = '<div class="empty"></div>';
          $("cards").querySelector(".empty").textContent = message;
        }
      })
      .then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
  }

  function applySort(key, dir) {
    if (state.sortKey === key && dir == null) state.sortDir *= -1;
    else {
      state.sortKey = key;
      state.sortDir = dir == null ? (key === "pdo" ? -1 : 1) : dir;
    }
    var q = new URLSearchParams(location.search);
    q.set("sort", state.sortKey);
    q.set("dir", String(state.sortDir));
    history.replaceState(null, "", "/?" + q.toString());
    if (state.data) {
      renderCards(visibleRows());
      renderTable();
    }
    syncSortControl();
    saveBoardPrefs();
  }

  function syncSortControl() {
    var sel = $("sort-key");
    var btn = $("sort-dir");
    if (sel) sel.value = state.sortKey;
    if (btn) btn.textContent = state.sortDir === -1 ? "Descending" : "Ascending";
  }

  function fillSortControl() {
    var sel = $("sort-key");
    if (!sel || sel.options.length) return;
    sel.innerHTML = SORT_FIELDS.map(function (pair) {
      return "<option value='" + pair[0] + "'>" + pair[1] + "</option>";
    }).join("");
    sel.value = state.sortKey;
    sel.addEventListener("change", function () {
      applySort(sel.value, state.sortKey === sel.value ? state.sortDir : (sel.value === "pdo" ? -1 : 1));
    });
  }

  document.querySelectorAll("#board thead tr:first-child th[data-key]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-key");
      if (!key) return;
      applySort(key, null);
    });
  });
  document.querySelectorAll("#board input[data-filter]").forEach(function (inp) {
    inp.addEventListener("input", function () {
      state.filters[inp.getAttribute("data-filter")] = inp.value;
      if (state.data) {
        renderCards(visibleRows());
        renderTable();
      }
    });
    inp.addEventListener("click", function (e) { e.stopPropagation(); });
  });
  (function bootQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get("sort")) state.sortKey = q.get("sort");
    if (q.get("dir")) state.sortDir = Number(q.get("dir")) || 1;
  })();

  function readStoredCards() {
    try { return sessionStorage.getItem(CARDS_KEY) === "1"; }
    catch (e) { return false; }
  }

  function writeStoredCards(open) {
    try { sessionStorage.setItem(CARDS_KEY, open ? "1" : "0"); }
    catch (e) {}
  }

  function syncCardsButton() {
    var btn = $("cards-toggle");
    if (btn) btn.textContent = state.cardsExpanded ? "Collapse all" : "Expand all";
  }

  function saveBoardPrefs() {
    if (!window.HockeyPrefs) return;
    HockeyPrefs.patch("matchups", {
      sortKey: state.sortKey,
      sortDir: state.sortDir,
      cardsExpanded: !!state.cardsExpanded
    });
  }

  function setCardsExpanded(open) {
    state.cardsExpanded = !!open;
    document.querySelectorAll("#cards details.card-details").forEach(function (el) {
      el.open = state.cardsExpanded;
    });
    syncCardsButton();
    writeStoredCards(state.cardsExpanded);
    saveBoardPrefs();
  }

  function applySavedSort() {
    var q = new URLSearchParams(location.search);
    if (window.HockeyPrefs && HockeyPrefs.signedIn()) {
      var saved = HockeyPrefs.section("matchups");
      if (saved) {
        if (!q.get("sort") && saved.sortKey) state.sortKey = saved.sortKey;
        if (!q.get("dir") && (saved.sortDir === 1 || saved.sortDir === -1)) state.sortDir = saved.sortDir;
        if (saved.cardsExpanded) {
          state.cardsExpanded = true;
          writeStoredCards(true);
        }
      }
    }
    fillSortControl();
    syncSortControl();
    syncCardsButton();
    if (state.data) {
      renderCards(visibleRows());
      renderTable();
    }
  }

  function startBoard() {
    state.cardsExpanded = readStoredCards();
    syncCardsButton();
    var cached = recallBoard();
    if (cached) render(cached);
    applySavedSort();
    load(false);
  }

  $("refresh").addEventListener("click", function () { load(true); });
  var cardsBtn = $("cards-toggle");
  if (cardsBtn) cardsBtn.addEventListener("click", function () { setCardsExpanded(!state.cardsExpanded); });
  var dirBtn = $("sort-dir");
  if (dirBtn) dirBtn.addEventListener("click", function () { applySort(state.sortKey, state.sortDir * -1); });
  var prevBtn = $("prev-date");
  var nextBtn = $("next-date");
  var todayBtn = $("today-date");
  if (prevBtn) prevBtn.addEventListener("click", function () { if (prevBtn.dataset.date) goDate(prevBtn.dataset.date); });
  if (nextBtn) nextBtn.addEventListener("click", function () { if (nextBtn.dataset.date) goDate(nextBtn.dataset.date); });
  if (todayBtn) todayBtn.addEventListener("click", function () { goDate(""); });
  window.addEventListener("popstate", function () { load(false); });
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted || state.data) return;
    var cached = recallBoard();
    if (cached) render(cached);
    load(false);
  });
  startBoard();
  if (window.HockeyPrefs) HockeyPrefs.ready.then(applySavedSort);
})();
