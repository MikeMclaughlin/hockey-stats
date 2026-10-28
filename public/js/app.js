(function () {
  "use strict";

  var state = { data: null, sortKey: "pdo", sortDir: -1, filters: {}, tier: "all", showWhy: true, cardsExpanded: false, featured: null };
  var B2B_KEY = "hs-b2b-filter";
  var PICK_VALUES = { all: true, "toss-up": true, lean: true, confident: true, strong: true, b2b: true };
  var WHY_KEY = "hs-show-why";
  var CARDS_KEY = "hs-cards-expanded";
  var STATS_KEY = "hs-card-stats";
  var DEFAULT_FEATURED = ["sogShare", "xgfPct5v5", "cf"];
  var CARD_STATS = [
    { key: "sogShare", label: "Shots-on-goal share", short: "SOG share", kind: "sogShare", fmt: "pct", field: "sogShare", pre: "sogShare" },
    { key: "xgfPct5v5", label: "Even-strength expected-goals share", short: "5v5 xG share", kind: "xgf5v5", fmt: "pct", field: "xgfPct5v5" },
    { key: "cf", label: "Shot-attempt share", short: "Shot-attempt share (CF%)", kind: "cf", fmt: "pct", field: "cfPct" },
    { key: "pdo", label: "Shooting plus save percentage", short: "PDO (SH% + SV%)", kind: "pdo", fmt: "plain", field: "pdo", pre: "pdo" },
    { key: "last5Sv", label: "Save percentage last five games", short: "Save % last 5", kind: "last5Sv", fmt: "pct", field: "last5SvPct", pre: "last5Sv" },
    { key: "last5", label: "Average goal differential last five games", short: "Avg goal diff last 5", kind: "last5", fmt: "signed2", field: "last5AvgGd", pre: "last5" },
    { key: "xgDiff", label: "Actual goals versus expected goals", short: "Goals vs xG", kind: "xgDiff", fmt: "signed1", field: "gfMinusXg" },
    { key: "hdcf", label: "High-danger chance share", short: "High-danger share", kind: "hdcf", fmt: "pct", field: "hdcfPct" },
    { key: "stXg", label: "Special-teams expected goals", short: "Special-teams xG", kind: "stXg", fmt: "signed1", field: "stXg" }
  ];

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

  function signedText(n, digits) {
    if (n == null || !isFinite(Number(n))) return "—";
    var v = Number(n);
    var text = v.toFixed(digits == null ? 1 : digits);
    if (v > 0) text = "+" + text;
    return text;
  }

  function statText(spec, value) {
    if (value == null || !isFinite(Number(value))) return "—";
    if (spec.fmt === "pct") return Number(value).toFixed(1) + "%";
    if (spec.fmt === "signed2") return signedText(value, 2);
    if (spec.fmt === "signed1") return signedText(value, 1);
    if (spec.fmt === "plain") return Number(value).toFixed(1);
    return String(value);
  }

  function readFeatured() {
    try {
      var raw = localStorage.getItem(STATS_KEY);
      if (raw == null) return DEFAULT_FEATURED.slice();
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return DEFAULT_FEATURED.slice();
      var known = {};
      CARD_STATS.forEach(function (s) { known[s.key] = true; });
      return list.filter(function (k) { return known[k]; });
    } catch (e) {
      return DEFAULT_FEATURED.slice();
    }
  }

  function writeFeatured(keys) {
    state.featured = keys.slice();
    try { localStorage.setItem(STATS_KEY, JSON.stringify(state.featured)); }
    catch (e) {}
  }

  function featuredKeys() {
    if (!state.featured) state.featured = readFeatured();
    return state.featured;
  }

  function isDefaultFeatured(keys) {
    if (!keys || keys.length !== DEFAULT_FEATURED.length) return false;
    var set = {};
    keys.forEach(function (k) { set[k] = true; });
    return DEFAULT_FEATURED.every(function (k) { return set[k]; });
  }

  function statsByKeys(keys) {
    var want = {};
    (keys || []).forEach(function (k) { want[k] = true; });
    return CARD_STATS.filter(function (s) { return want[s.key]; });
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
    return '<p class="odds"><span>Moneyline ' + ml + "</span><span>" + ou.replace("O/U", "Over/under") + src + "</span></p>";
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

  function hyphenRecord(value) {
    return String(value || "").replace(/–/g, "-").replace(/—/g, "-");
  }

  function shortTeam(t) {
    var name = (t && t.name) || "";
    var two = ["Blue Jackets", "Red Wings", "Maple Leafs", "Golden Knights"];
    for (var i = 0; i < two.length; i++) {
      if (name.slice(-two[i].length) === two[i]) return two[i];
    }
    var parts = name.split(" ");
    if (parts.length > 1) return parts[parts.length - 1];
    return name || (t && t.abbrev) || "";
  }

  function recordCaption(t, venue) {
    var overall = hyphenRecord(t && t.record);
    var splitRaw = venue === "Away" ? (t && t.roadRecord) : (t && t.homeRecord);
    var split = hyphenRecord(splitRaw);
    var pre = t && t.preseason && t.preseason.record ? " " + preMark(true) : "";
    if (!overall && !split) return "";
    if (split) return "(" + overall + ", " + split + " " + venue + ")" + pre;
    return "(" + overall + ")" + pre;
  }

  function clockText(s) {
    if (!s) return "";
    if (s.final) {
      var status = s.status ? String(s.status) : "Final";
      return status.indexOf("Final") === 0 ? status : "Final";
    }
    if (!s.live) return "";
    var live = s.status ? String(s.status) : "";
    if (live.toLowerCase().indexOf("intermission") !== -1) return live;
    if (s.clock && s.period) return s.clock + " - " + s.period;
    if (s.clock) return s.clock;
    if (s.period) return s.period;
    return live || "Live";
  }

  function scoreTeamRow(t, venue, goals, showGoals) {
    var logo = t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : "";
    var goalsHtml = showGoals ? '<div class="score-goals">' + esc(goals) + "</div>" : "";
    return (
      '<div class="score-team">' +
        logo +
        '<div class="score-meta">' +
          '<div class="score-name">' + esc(shortTeam(t)) + "</div>" +
          '<div class="score-rec">' + recordCaption(t, venue) + "</div>" +
        "</div>" +
        goalsHtml +
      "</div>"
    );
  }

  function cardScoreInner(m) {
    var s = m.scoreboard || {};
    var show = s.away != null && s.home != null && (s.live || s.final);
    var clock = clockText(s);
    if (!show && !clock) return "";
    var clockHtml = clock
      ? '<p class="score-clock' + (s.final ? " is-final" : "") + '">' + esc(clock) + "</p>"
      : "";
    var num = show
      ? '<p class="score-num">' + esc(m.away.abbrev) + " " + esc(s.away) + " – " + esc(s.home) + " " + esc(m.home.abbrev) + "</p>"
      : "";
    return clockHtml + num;
  }

  function edgeBadge(m) {
    var model = modelOf(m);
    var abbrev = model ? model.pickAbbrev : (m.edgeTeam || "");
    if (!abbrev || abbrev === "EVEN") return '<span class="badge even">Even matchup</span>';
    return '<span class="badge">Edge: ' + esc(abbrev) + "</span>";
  }

  function labelTag(model) {
    if (!model) return "";
    var cls = "badge";
    if (model.label === "Toss-up") cls += " toss";
    else if (model.label !== "Confident" && model.label !== "Strong") cls += " even";
    var title = HockeyEdgeModel.labelTitle(model);
    if (model.confidentPick && model.label === "Confident") {
      title += " Confident pick: the Edge, the projected winner, and last-five xG share agree, and the pick is not on a back-to-back against a rested opponent.";
    }
    return '<span class="' + cls + '" title="' + esc(title) + '">' + esc(model.label) + "</span>";
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
    return model.chips.map(function (chip) {
      return '<span class="badge' + (chip.strong ? "" : " even") + '" title="' + esc(chip.title) + '">' + esc(chip.text) + "</span>";
    }).join("");
  }

  function applyModelGrade(m, base) {
    if (!base || !window.HockeyEdgeModel) return base;
    var model = modelOf(m);
    if (!model) return base;
    var sb = m.scoreboard || {};
    var actualWinner = window.HockeyArchive ? HockeyArchive.winnerOf(Number(sb.away), Number(sb.home)) : null;
    var toss = model.label === "Toss-up";
    var edgeCorrect = null;
    if (!toss && model.pick && actualWinner && actualWinner !== "tie") edgeCorrect = model.pick === actualWinner;
    return Object.assign({}, base, {
      edgeAbbrev: model.pickAbbrev,
      edgeWinner: model.pick,
      edgeCorrect: edgeCorrect,
      tossUp: toss,
      edgeSource: "model",
      missingEdge: false
    });
  }

  function performanceOf(m) {
    var sb = m.scoreboard || {};
    if (!sb.final || sb.away == null || sb.home == null) return null;
    var server = m.performance;
    if (server && server.actualLabel === (sb.away + "–" + sb.home)) return applyModelGrade(m, server);
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
    return applyModelGrade(m, {
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
    });
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

  var TEAM_COLORS = {
    ANA: "#FC4C02", BOS: "#FFB81C", BUF: "#003087", CAR: "#CE1126",
    CBJ: "#002654", CGY: "#C8102E", CHI: "#CF0A2C", COL: "#6F263D",
    DAL: "#006847", DET: "#CE1126", EDM: "#041E42", FLA: "#041E42",
    LAK: "#111111", MIN: "#154734", MTL: "#001E62", NJD: "#CE1126",
    NSH: "#FFB81C", NYI: "#00539B", NYR: "#0038A8", OTT: "#C52032",
    PHI: "#F74902", PIT: "#111111", SEA: "#001628", SJS: "#006D75",
    STL: "#002F87", TBL: "#002868", TOR: "#00205B", UTA: "#111111",
    VAN: "#00205B", VGK: "#B4975A", WPG: "#041E42", WSH: "#041E42"
  };

  function inkOn(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length !== 6) return "#fff";
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    var y = (r * 299 + g * 587 + b * 114) / 1000;
    return y > 160 ? "#1a1a1a" : "#fff";
  }

  function teamColor(abbrev) {
    return TEAM_COLORS[String(abbrev || "").toUpperCase()] || "#0b1c2c";
  }

  function seasonMark(m) {
    var label = (state.data && state.data.scoreboardSeasonLabel) || "2026-27";
    var kind = m && Number(m.gameType) === 2 ? "REG" : (m && m.gameTypeLabel ? String(m.gameTypeLabel) : "REG");
    return label + " " + kind;
  }

  function bannerWhen(m) {
    var time = "";
    if (m.startTimeUTC) {
      var d = new Date(m.startTimeUTC);
      if (isFinite(d.getTime())) {
        try {
          time = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short"
          }).format(d);
        } catch (e) {
          time = fmtTime(m.startTimeUTC);
        }
      }
    }
    var venue = m.venue || "";
    if (time && venue) return time + " · " + venue;
    return time || venue || fmtTime(m.startTimeUTC);
  }

  function recordTitle(team, venue) {
    var record = hyphenRecord(team && team.record);
    var splitRaw = venue === "Away" ? (team && team.roadRecord) : (team && team.homeRecord);
    var split = hyphenRecord(splitRaw);
    if (split) return venue + " " + split + (record ? ", overall " + record : "");
    return record || "";
  }

  function recordPre(team) {
    return team && team.preseason && team.preseason.record ? " " + preMark(true) : "";
  }

  function splitBanner(m) {
    function half(team, venue) {
      var bg = teamColor(team && team.abbrev);
      var fg = inkOn(bg);
      var logo = team && team.logo ? '<img class="split-logo" src="' + esc(team.logo) + '" alt="">' : "";
      var record = hyphenRecord(team && team.record);
      var title = recordTitle(team, venue);
      return '<div class="split-side" style="background:' + bg + ";color:" + fg + '">' +
        '<div class="split-season">' + esc(seasonMark(m)) + "</div>" +
        logo +
        '<div class="split-record" title="' + esc(title) + '">' + esc(record || "—") + recordPre(team) + "</div>" +
        '<div class="split-name">' + esc(shortTeam(team)) + "</div>" +
        "</div>";
    }
    return '<div class="split-banner">' +
      half(m.away, "Away") +
      half(m.home, "Home") +
      '<div class="split-vs" aria-hidden="true">VS</div>' +
      "</div>";
  }

  function splitMeta(m) {
    return '<p class="split-meta">' + esc(bannerWhen(m)) + "</p>";
  }

  function splitRecords(m) {
    function cell(team, venue) {
      var splitRaw = venue === "Away" ? (team && team.roadRecord) : (team && team.homeRecord);
      var split = hyphenRecord(splitRaw);
      return '<div title="' + esc(recordTitle(team, venue)) + '">' +
        esc(venue) + " " + esc(split || "—") + recordPre(team) +
        "</div>";
    }
    return '<div class="split-records">' + cell(m.away, "Away") + cell(m.home, "Home") + "</div>";
  }

  function isShootoutText(value) {
    var raw = String(value || "").toUpperCase();
    if (!raw) return false;
    if (raw.indexOf("SHOOTOUT") !== -1) return true;
    return /(^|[^A-Z])SO([^A-Z]|$)/.test(raw);
  }

  function textSlot(value) {
    var raw = String(value || "").toUpperCase().trim();
    if (!raw) return 0;
    if (isShootoutText(raw) || raw.indexOf("OT") !== -1 || raw.indexOf("OVERTIME") !== -1) return 4;
    if (raw.indexOf("1ST") !== -1) return 1;
    if (raw.indexOf("2ND") !== -1) return 2;
    if (raw.indexOf("3RD") !== -1) return 3;
    var nth = raw.match(/(^|[^0-9])(\d+)(ST|ND|RD|TH)\b/);
    if (nth) {
      var n = Number(nth[2]);
      if (n <= 1) return 1;
      if (n === 2) return 2;
      if (n === 3) return 3;
      return 4;
    }
    if (/^\d+$/.test(raw)) {
      var num = Number(raw);
      if (num <= 1) return 1;
      if (num === 2) return 2;
      if (num === 3) return 3;
      return 4;
    }
    return 0;
  }

  function scoreboardSlot(s) {
    s = s || {};
    var fromPeriod = textSlot(s.period);
    if (fromPeriod) return fromPeriod;
    return textSlot(s.status);
  }

  function periodTheme(slot) {
    var themes = {
      1: { color: "#4f9fd6", tint: "#e3f1fa" },
      2: { color: "#2f7fbf", tint: "#d3e6f5" },
      3: { color: "#1f5f9c", tint: "#c0d8ee" },
      4: { color: "#143e6e", tint: "#aac6e3" }
    };
    return themes[slot] || themes[4];
  }

  function themeForScore(s) {
    var slot = scoreboardSlot(s);
    if (slot) return periodTheme(slot);
    var blob = (String((s && s.period) || "") + " " + String((s && s.status) || "")).toUpperCase();
    if (blob.indexOf("OT") !== -1 || blob.indexOf("OVERTIME") !== -1 || blob.indexOf("SHOOTOUT") !== -1 || isShootoutText(blob)) {
      return periodTheme(4);
    }
    return periodTheme(1);
  }

  function applyLiveTheme(article, m) {
    if (!article) return;
    var theme = themeForScore(m.scoreboard || {});
    article.style.setProperty("--period-color", theme.color);
    article.style.setProperty("--period-tint", theme.tint);
  }

  function liveHeaderText(s) {
    var status = s && s.status ? String(s.status) : "";
    if (status.toLowerCase().indexOf("intermission") !== -1) return "LIVE · " + status.toUpperCase();
    var period = s && s.period ? String(s.period).toUpperCase() : "";
    if (isShootoutText(period) || (!period && isShootoutText(status))) return "LIVE · SO";
    if (period) return "LIVE · " + period + " PERIOD";
    if (status) return "LIVE · " + status.toUpperCase();
    return "LIVE";
  }

  function periodDots(s) {
    var labels = ["1st", "2nd", "3rd", "OT"];
    var current = scoreboardSlot(s);
    var status = s && s.status ? String(s.status).toLowerCase() : "";
    var intermission = status.indexOf("intermission") !== -1 || !!(s && s.inIntermission);
    var shootout = isShootoutText(s && s.period) || isShootoutText(s && s.status);
    var html = labels.map(function (label, i) {
      var n = i + 1;
      var cls = "period-dot";
      if (shootout || (intermission && current && n <= current) || (!intermission && current && n < current)) cls += " is-done";
      else if (!intermission && current && n === current) cls += " is-now";
      return '<div class="' + cls + '"><b></b><span>' + label + "</span></div>";
    }).join("");
    var described = (s && (s.status || s.period)) || "Live";
    return '<div class="period-dots" role="img" aria-label="' + esc("Game progress: " + described) + '">' + html + "</div>";
  }

  function logoOnLight(url) {
    return String(url || "").replace("_light.svg", "_dark.svg");
  }

  function sogLine(n) {
    if (n == null || !isFinite(Number(n))) return "";
    return '<div class="live-sog">' + esc(Number(n)) + " SOG</div>";
  }

  function liveSide(team, venue, goals, sog) {
    var src = logoOnLight(team && team.logo);
    var logo = src ? '<img src="' + esc(src) + '" alt="">' : "";
    var record = hyphenRecord(team && team.record);
    return '<div class="live-side">' +
      logo +
      '<div class="live-name">' + esc(shortTeam(team)) + "</div>" +
      '<div class="live-rec" title="' + esc(recordTitle(team, venue)) + '">' + esc(record || "—") + recordPre(team) + "</div>" +
      '<div class="live-score">' + esc(goals) + "</div>" +
      sogLine(sog) +
      "</div>";
  }

  function liveBannerInner(m) {
    var s = m.scoreboard || {};
    var clock = s.clock ? '<span class="live-clock">' + esc(s.clock) + "</span>" : "";
    return '<div class="live-bar"><span class="live-title"><span class="live-dot" aria-hidden="true"></span>' +
      esc(liveHeaderText(s)) + "</span>" + clock + "</div>" +
      '<div class="live-body"><div class="live-scoreline">' +
        liveSide(m.away, "Away", s.away, s.awaySog) +
        periodDots(s) +
        liveSide(m.home, "Home", s.home, s.homeSog) +
      "</div></div>";
  }

  function cardIsLive(m) {
    var s = m.scoreboard || {};
    return !!(s.live && s.away != null && s.home != null);
  }

  function liveBanner(m) {
    return '<div class="live-banner" data-score="' + m.id + '">' + liveBannerInner(m) + "</div>";
  }

  function leagueTeams() {
    return (state.data && state.data.cardLeague && state.data.cardLeague.teams) || [];
  }

  function leagueBoards() {
    if (!window.HockeyCardLeague) return {};
    return HockeyCardLeague.rankBoards(leagueTeams());
  }

  function teamPrior(abbrev) {
    var teams = leagueTeams();
    for (var i = 0; i < teams.length; i++) {
      if (teams[i].abbrev === abbrev) return teams[i];
    }
    return null;
  }

  function deltaDigits(spec) {
    if (spec.fmt === "signed2") return 2;
    if (spec.fmt === "signed1") return 1;
    return 1;
  }

  function signedDelta(n, digits) {
    if (n == null || !isFinite(Number(n))) return "—";
    return signedText(n, digits);
  }

  function sideFacts(spec, team, board, which) {
    var value = team ? team[spec.field] : null;
    var num = value == null || !isFinite(Number(value)) ? null : Number(value);
    var entry = teamPrior(team && team.abbrev);
    var prior = entry && entry.prior ? entry.prior[spec.field] : null;
    var delta = num == null || prior == null || !isFinite(Number(prior)) ? null : num - Number(prior);
    var info = board && board.byAbbrev ? board.byAbbrev[team && team.abbrev] : null;
    var digits = deltaDigits(spec);
    var pre = spec.pre && team && team.preseason && team.preseason[spec.pre];
    var plain = statText(spec, value);
    var valueHtml = plain === "—" ? "—" : esc(plain);
    if (pre && plain !== "—") valueHtml += " " + preMark(true);
    var rankText = info && window.HockeyCardLeague
      ? HockeyCardLeague.rankLabel(info.rank, info.tied)
      : "—";
    var gap = info && info.gap != null && isFinite(Number(info.gap)) ? Number(info.gap) : null;
    var shade = gap == null || gap === 0 ? "" : (gap > 0 ? "above" : "below");
    var rankTone = gap == null || gap === 0 ? "even" : (gap > 0 ? "good" : "bad");
    var deltaTone = delta == null || Number(delta) === 0 ? "even" : (Number(delta) > 0 ? "good" : "bad");
    var valueCls = "stat-cur";
    if ((spec.fmt === "signed1" || spec.fmt === "signed2") && window.HockeyStats && HockeyStats.pillSign) {
      var sign = HockeyStats.pillSign(num, spec.kind);
      if (sign === "pos") valueCls += " good";
      else if (sign === "neg") valueCls += " bad";
    }
    var gapText = gap == null ? "—" : signedDelta(gap, digits) + " vs avg";
    var deltaHtml = delta == null
      ? "—"
      : esc(signedDelta(delta, digits)) + ' <span class="delta-unit">5d</span>';
    var rankTitle = which + " rank for " + spec.label + ". 1st is best. Ties are marked T-. Green is above the league average. Red is below.";
    var deltaTitle = which + " 5-day change in " + spec.label + ". Green is an improvement. Red is a decline.";
    var valueTitle = (PILL_TITLES[spec.kind] || spec.label) + " Current " + which.toLowerCase() + " value.";
    if (pre) valueTitle += " " + ((state.data && state.data.preseasonLabel) || "2026-27 preseason") + ".";
    return {
      shade: shade,
      valueHtml: valueHtml,
      rankText: rankText,
      rankTone: rankTone,
      gapText: gapText,
      valueCls: valueCls,
      deltaHtml: deltaHtml,
      deltaTone: deltaTone,
      rankTitle: rankTitle,
      deltaTitle: deltaTitle,
      valueTitle: valueTitle
    };
  }

  function halfBlock(side) {
    return '<div class="stat-half ' + side.shade + '">' +
      '<div class="' + side.valueCls + '" title="' + esc(side.valueTitle) + '">' + side.valueHtml + "</div>" +
      '<div class="stat-sub">' +
        '<span class="stat-rank ' + side.rankTone + '" title="' + esc(side.rankTitle) + '">' +
          '<span class="rank-no">' + esc(side.rankText) + "</span>" +
          '<span class="rank-gap">' + esc(side.gapText) + "</span>" +
        "</span>" +
        '<span class="stat-delta ' + side.deltaTone + '" title="' + esc(side.deltaTitle) + '">' + side.deltaHtml + "</span>" +
      "</div></div>";
  }

  function statColumnHead() {
    var heads = [
      ["delta", "5 day delta", "Change versus the snapshot saved about five days earlier for the away team. Green is an improvement. Red is a decline."],
      ["rank", "league rank", "Where the away team ranks, 1st best. Ties are marked T-. Under the rank is this team minus the league average. Green is better than average. Red is worse."],
      ["value", "current value", "Away team’s current value for this stat."],
      ["stat", "stat", "Stat name. The league average of the clubs with a number is underneath."],
      ["value", "current value", "Home team’s current value for this stat."],
      ["rank", "league rank", "Where the home team ranks, 1st best. Ties are marked T-. Under the rank is this team minus the league average. Green is better than average. Red is worse."],
      ["delta", "5 day delta", "Change versus the snapshot saved about five days earlier for the home team. Green is an improvement. Red is a decline."]
    ];
    var cells = heads.map(function (h) {
      var cls = h[0] === "stat" ? "stat-label" : "val";
      return '<th class="' + cls + '" title="' + esc(h[2]) + '" aria-label="' + esc(h[2]) + '">' + esc(h[1]) + "</th>";
    }).join("");
    return '<div class="stat-colhead-scroll"><table class="stat-colhead"><thead><tr>' + cells + "</tr></thead></table></div>";
  }

  function statBlocks(rows, away, home) {
    if (!rows.length) return "";
    var boards = leagueBoards();
    return statColumnHead() + '<div class="stat-blocks">' + rows.map(function (spec) {
      var board = boards[spec.field] || { byAbbrev: {}, avg: null, n: 0 };
      var left = sideFacts(spec, away, board, "Away");
      var right = sideFacts(spec, home, board, "Home");
      var avgText = board.avg == null ? "—" : statText(spec, HockeyStats.round(board.avg, deltaDigits(spec) === 2 ? 2 : 1));
      var avgTitle = "League average of " + (board.n || 0) + " teams with a " + spec.label + " number. The average is the mean of those clubs.";
      var nameTitle = (PILL_TITLES[spec.kind] || spec.label) + " League average alongside the name.";
      return '<div class="stat-block">' +
        '<div class="stat-block-name" title="' + esc(nameTitle) + '">' +
          esc(spec.short || spec.label) +
          '<span class="lg-avg" title="' + esc(avgTitle) + '">lg avg ' + esc(avgText) + "</span>" +
        "</div>" +
        '<div class="stat-pair">' +
          halfBlock(left) +
          '<div class="stat-sep" aria-hidden="true"></div>' +
          halfBlock(right) +
        "</div></div>";
    }).join("") + "</div>";
  }

  function snapshotNote(away, home) {
    var a = teamPrior(away && away.abbrev);
    var h = teamPrior(home && home.abbrev);
    function stamp(team, entry) {
      if (!entry || !entry.priorDate) return (team && team.abbrev ? team.abbrev + " n/a" : "n/a");
      var day = String(entry.priorDate).slice(5).replace("-", "/").replace(/^0/, "").replace("/0", "/");
      return (team && team.abbrev ? team.abbrev + " " : "") + day;
    }
    var n = 0;
    leagueTeams().forEach(function (team) {
      if (team && team.values) n += 1;
    });
    var counted = n || 32;
    return "5-day delta vs saved snapshot: " + stamp(away, a) + " · " + stamp(home, h) +
      ". Rank of " + counted + " teams; avg = " + counted + "-team mean.";
  }

  var TOP_THREE_KEYS = { sogShare: true, xgfPct5v5: true, cf: true };

  function presentStat(team, spec) {
    if (!team) return null;
    var raw = team[spec.field];
    if (raw == null || raw === "") return null;
    var n = Number(raw);
    return isFinite(n) ? n : null;
  }

  function leadsStat(team, opp, spec) {
    var a = presentStat(team, spec);
    var b = presentStat(opp, spec);
    if (a == null || b == null) return false;
    return a > b;
  }

  function leadsEvery(team, opp, rows) {
    return rows.every(function (spec) { return leadsStat(team, opp, spec); });
  }

  function takeLine(team, m, side) {
    var name = (team && team.name) || (team && team.abbrev) || "Team";
    var ml = m.odds && (side === "away" ? m.odds.awayMl : m.odds.homeMl);
    if (ml == null || !isFinite(Number(ml))) return name + " odds pending";
    var text = window.HockeyStats && HockeyStats.formatAmerican
      ? HockeyStats.formatAmerican(Number(ml))
      : String(ml);
    return name + " " + text;
  }

  function renderTakeList(matchups) {
    var el = $("take-list");
    if (!el) return;
    var games = matchups || [];
    var top = CARD_STATS.filter(function (spec) { return TOP_THREE_KEYS[spec.key]; });
    var lines = [];
    games.forEach(function (m) {
      var comparable = top.concat(CARD_STATS).every(function (spec) {
        return presentStat(m.away, spec) != null && presentStat(m.home, spec) != null;
      });
      if (!comparable) return;
      if (leadsEvery(m.away, m.home, top) && leadsEvery(m.away, m.home, CARD_STATS)) {
        lines.push(takeLine(m.away, m, "away"));
      }
      if (leadsEvery(m.home, m.away, top) && leadsEvery(m.home, m.away, CARD_STATS)) {
        lines.push(takeLine(m.home, m, "home"));
      }
    });
    var body = !games.length
      ? "<p class=\"take-empty\">No games</p>"
      : lines.length
        ? "<ul>" + lines.map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("") + "</ul>"
        : "<p class=\"take-empty\">No team leads in both</p>";
    el.hidden = false;
    el.innerHTML = "<h2>Teams to take</h2>" + body;
  }

  function renderCards(matchups) {
    var root = $("cards");
    if (!matchups.length) {
      var any = state.data && state.data.matchups && state.data.matchups.length;
      var filtered = any && state.tier && state.tier !== "all";
      var emptyText = filtered
        ? "No games match these filters."
        : "No games on the current NHL scoreboard. The board will pick up the next published slate.";
      root.innerHTML = '<div class="empty">' + emptyText + "</div>";
      return;
    }
    root.innerHTML = matchups.map(function (m) {
      var model = modelOf(m);
      var proj = m.projected || HockeyStats.estimateScore(m.away, m.home);
      var why = model && (model.pick === "away" || model.pick === "home")
        ? HockeyStats.explainEdge(m.edge, m.away, m.home, model.pick)
        : (m.why || HockeyStats.explainEdge(m.edge, m.away, m.home));
      var picked = featuredKeys();
      var featured = statsByKeys(picked);
      var rest = CARD_STATS.filter(function (s) {
        return picked.indexOf(s.key) === -1;
      });
      var head = isDefaultFeatured(picked)
        ? '<span class="stat-kicker">Top-three stats</span><span class="backtested">Backtested</span>'
        : '<span class="stat-kicker">Selected stats</span>';
      var more = rest.length
        ? '<details class="more-stats"' + (state.cardsExpanded ? " open" : "") + ">" +
            "<summary>More stats</summary>" +
            statBlocks(rest, m.away, m.home) +
          "</details>"
        : "";
      var whyHtml = state.showWhy ? '<p class="why">' + esc(why) + "</p>" : "";
      var live = cardIsLive(m);
      var theme = live ? themeForScore(m.scoreboard || {}) : null;
      var liveStyle = live
        ? ' style="--period-color:' + theme.color + ";--period-tint:" + theme.tint + '"'
        : "";
      return (
        '<article class="card' + (live ? " card-live" : "") + '" id="game-' + m.id + '"' + liveStyle + ">" +
          (live ? liveBanner(m) : splitBanner(m)) +
          splitMeta(m) +
          splitRecords(m) +
          '<div class="card-head">' +
            (live ? "" : '<div class="score-block" data-score="' + m.id + '">' + cardScoreInner(m) + "</div>") +
            '<p class="est-row"><span class="est-label">Est.</span> ' +
              esc(m.away.abbrev) + " " + proj.away + " – " + proj.home + " " + esc(m.home.abbrev) + "</p>" +
            '<div class="pick-row">' +
              edgeBadge(m) +
              labelTag(model) +
              edgeProbLine(m) +
              chipRow(model) +
              marketFlag(m) +
            "</div>" +
            oddsLine(m) +
            '<p class="result-line" data-result="' + m.id + '">' + resultInner(m) + "</p>" +
            whyHtml +
            notesLine(m) +
          "</div>" +
          '<div class="card-stats">' +
            '<div class="stat-head-row">' + head + "</div>" +
            statBlocks(featured, m.away, m.home) +
            more +
            '<p class="snapshot-note">' + esc(snapshotNote(m.away, m.home)) + "</p>" +
          "</div>" +
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

  function teamOnB2b(team) {
    return !!(team && (team.b2b || team.restDays === 1));
  }

  function passesFilters(m) {
    if (state.tier === "b2b") {
      if (!teamOnB2b(m.away) && !teamOnB2b(m.home)) return false;
    } else if (state.tier && state.tier !== "all") {
      var model = modelOf(m);
      var label = model && model.label ? String(model.label).toLowerCase() : "";
      if (label !== state.tier) return false;
    }
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
    document.querySelectorAll("#board tbody tr[data-game]").forEach(function (tr) {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", function () {
        var el = document.getElementById("game-" + tr.getAttribute("data-game"));
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
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
      " · " + (data.matchupCount || 0) + "\u00A0games";
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
    renderTakeList(data.matchups || []);
    renderCards(visibleRows());
    renderTable();
    syncSortControl();
    syncCardsButton();
    armScores();
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
    var structural = false;
    ((state.data && state.data.matchups) || []).forEach(function (m) {
      var article = document.getElementById("game-" + m.id);
      if (article && cardIsLive(m) !== article.classList.contains("card-live")) structural = true;
    });
    if (structural) {
      renderCards(visibleRows());
      renderTable();
      return;
    }
    ((state.data && state.data.matchups) || []).forEach(function (m) {
      document.querySelectorAll('[data-score="' + m.id + '"]').forEach(function (el) {
        if (el.classList.contains("score-cell")) el.innerHTML = scoreInner(m);
        else if (el.classList.contains("live-banner")) {
          el.innerHTML = liveBannerInner(m);
          applyLiveTheme(el.closest("article"), m);
        } else el.innerHTML = cardScoreInner(m);
      });
      document.querySelectorAll('[data-result="' + m.id + '"]').forEach(function (el) {
        el.textContent = resultInner(m);
      });
    });
  }

  function keepShown(next, prev) {
    if (next != null && next !== "") return next;
    if (prev != null && prev !== "") return prev;
    return next != null ? next : prev;
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
        away: keepShown(g.away, prev.away),
        home: keepShown(g.home, prev.home),
        state: g.state || prev.state,
        live: !!g.live,
        final: !!g.final,
        status: keepShown(g.status, prev.status),
        period: keepShown(g.period, prev.period),
        clock: keepShown(g.clock, prev.clock),
        awaySog: keepShown(g.awaySog, prev.awaySog),
        homeSog: keepShown(g.homeSog, prev.homeSog),
        inIntermission: !!g.inIntermission
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
    var date = q.get("date") || slateDate();
    var url = "/api/scores" + (date ? "?date=" + encodeURIComponent(date) : "");
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

  function slateDate() {
    if (window.HockeyDates && HockeyDates.etSlateDate) return HockeyDates.etSlateDate();
    return "";
  }

  function boardCacheKey() {
    var q = new URLSearchParams(location.search);
    return "hs-board:" + (q.get("date") || slateDate() || "now");
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

  function isPick(value) {
    return !!PICK_VALUES[value];
  }

  function b2bStored() {
    return state.tier === "b2b" ? "b2b" : "all";
  }

  function readViewPrefs() {
    try {
      var legacy = localStorage.getItem(B2B_KEY);
      var stray = localStorage.getItem("hs-pick-filter");
      if (legacy === "b2b" || (legacy == null && stray === "b2b")) state.tier = "b2b";
      if (legacy != null) localStorage.removeItem(B2B_KEY);
      localStorage.removeItem("hs-pick-filter");
      if (state.tier === "b2b") localStorage.setItem(B2B_KEY, "b2b");
      var why = localStorage.getItem(WHY_KEY);
      if (why === "0") state.showWhy = false;
      if (why === "1") state.showWhy = true;
    } catch (e) {}
    syncViewControls();
  }

  function writeViewPrefs() {
    try {
      localStorage.setItem(B2B_KEY, b2bStored());
      localStorage.removeItem("hs-pick-filter");
      localStorage.setItem(WHY_KEY, state.showWhy ? "1" : "0");
    } catch (e) {}
  }

  function syncViewControls() {
    var tier = $("tier");
    if (tier) tier.value = isPick(state.tier) ? state.tier : "all";
    var why = $("show-why");
    if (why) why.checked = !!state.showWhy;
  }

  function saveBoardPrefs() {
    if (!window.HockeyPrefs) return;
    HockeyPrefs.patch("matchups", {
      sortKey: state.sortKey,
      sortDir: state.sortDir,
      cardsExpanded: !!state.cardsExpanded,
      b2b: b2bStored(),
      showWhy: !!state.showWhy
    });
  }

  function saveViewPrefs() {
    writeViewPrefs();
    saveBoardPrefs();
  }

  function setCardsExpanded(open) {
    state.cardsExpanded = !!open;
    document.querySelectorAll("#cards details.more-stats").forEach(function (el) {
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
        if (saved.b2b === "b2b") state.tier = "b2b";
        else if (saved.b2b === "all" && state.tier === "b2b") state.tier = "all";
        if (saved.showWhy === true || saved.showWhy === false) state.showWhy = saved.showWhy;
        writeViewPrefs();
        syncViewControls();
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

  function closeChoose() {
    var panel = $("choose-stats-panel");
    var btn = $("choose-stats");
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function fillChooseStats() {
    var panel = $("choose-stats-panel");
    if (!panel || panel.childNodes.length) return;
    var keys = featuredKeys();
    panel.innerHTML = CARD_STATS.map(function (spec) {
      var on = keys.indexOf(spec.key) !== -1 ? " checked" : "";
      return "<label><input type='checkbox' data-stat='" + spec.key + "'" + on + "> " + esc(spec.label) + "</label>";
    }).join("");
    panel.addEventListener("change", function (e) {
      var box = e.target;
      if (!box || !box.getAttribute || !box.getAttribute("data-stat")) return;
      var next = [];
      panel.querySelectorAll("input[data-stat]").forEach(function (inp) {
        if (inp.checked) next.push(inp.getAttribute("data-stat"));
      });
      writeFeatured(next);
      if (state.data) renderCards(visibleRows());
    });
  }

  function startBoard() {
    state.cardsExpanded = readStoredCards();
    readViewPrefs();
    syncCardsButton();
    var cached = recallBoard();
    if (cached) render(cached);
    applySavedSort();
    load(false);
  }

  fillChooseStats();
  var chooseBtn = $("choose-stats");
  if (chooseBtn) {
    chooseBtn.addEventListener("click", function () {
      var panel = $("choose-stats-panel");
      if (!panel) return;
      var willOpen = panel.hidden;
      if (willOpen) {
        panel.hidden = false;
        chooseBtn.setAttribute("aria-expanded", "true");
      } else closeChoose();
    });
  }
  document.addEventListener("click", function (e) {
    var wrap = document.querySelector(".choose-stats");
    if (!wrap || wrap.contains(e.target)) return;
    closeChoose();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeChoose();
  });

  $("refresh").addEventListener("click", function () { load(true); });
  var cardsBtn = $("cards-toggle");
  if (cardsBtn) cardsBtn.addEventListener("click", function () { setCardsExpanded(!state.cardsExpanded); });
  var dirBtn = $("sort-dir");
  if (dirBtn) dirBtn.addEventListener("click", function () { applySort(state.sortKey, state.sortDir * -1); });
  var tierSel = $("tier");
  if (tierSel) tierSel.addEventListener("change", function () {
    state.tier = isPick(tierSel.value) ? tierSel.value : "all";
    saveViewPrefs();
    if (state.data) render(state.data);
  });
  var whyBox = $("show-why");
  if (whyBox) whyBox.addEventListener("change", function () {
    state.showWhy = !!whyBox.checked;
    saveViewPrefs();
    if (state.data) render(state.data);
  });
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
