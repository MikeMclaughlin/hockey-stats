(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyStats = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TEAMS = [
    { id: 24, abbrev: "ANA", name: "Anaheim Ducks" },
    { id: 6, abbrev: "BOS", name: "Boston Bruins" },
    { id: 7, abbrev: "BUF", name: "Buffalo Sabres" },
    { id: 12, abbrev: "CAR", name: "Carolina Hurricanes" },
    { id: 29, abbrev: "CBJ", name: "Columbus Blue Jackets" },
    { id: 20, abbrev: "CGY", name: "Calgary Flames" },
    { id: 16, abbrev: "CHI", name: "Chicago Blackhawks" },
    { id: 21, abbrev: "COL", name: "Colorado Avalanche" },
    { id: 25, abbrev: "DAL", name: "Dallas Stars" },
    { id: 17, abbrev: "DET", name: "Detroit Red Wings" },
    { id: 22, abbrev: "EDM", name: "Edmonton Oilers" },
    { id: 13, abbrev: "FLA", name: "Florida Panthers" },
    { id: 26, abbrev: "LAK", name: "Los Angeles Kings" },
    { id: 30, abbrev: "MIN", name: "Minnesota Wild" },
    { id: 8, abbrev: "MTL", name: "Montréal Canadiens" },
    { id: 1, abbrev: "NJD", name: "New Jersey Devils" },
    { id: 18, abbrev: "NSH", name: "Nashville Predators" },
    { id: 2, abbrev: "NYI", name: "New York Islanders" },
    { id: 3, abbrev: "NYR", name: "New York Rangers" },
    { id: 9, abbrev: "OTT", name: "Ottawa Senators" },
    { id: 4, abbrev: "PHI", name: "Philadelphia Flyers" },
    { id: 5, abbrev: "PIT", name: "Pittsburgh Penguins" },
    { id: 55, abbrev: "SEA", name: "Seattle Kraken" },
    { id: 28, abbrev: "SJS", name: "San Jose Sharks" },
    { id: 19, abbrev: "STL", name: "St. Louis Blues" },
    { id: 14, abbrev: "TBL", name: "Tampa Bay Lightning" },
    { id: 10, abbrev: "TOR", name: "Toronto Maple Leafs" },
    { id: 68, abbrev: "UTA", name: "Utah Mammoth" },
    { id: 23, abbrev: "VAN", name: "Vancouver Canucks" },
    { id: 54, abbrev: "VGK", name: "Vegas Golden Knights" },
    { id: 52, abbrev: "WPG", name: "Winnipeg Jets" },
    { id: 15, abbrev: "WSH", name: "Washington Capitals" }
  ];

  function teamByAbbrev(abbrev) {
    var a = String(abbrev || "").toUpperCase();
    for (var i = 0; i < TEAMS.length; i++) {
      if (TEAMS[i].abbrev === a) return TEAMS[i];
    }
    return null;
  }

  function teamById(id) {
    var n = Number(id);
    for (var i = 0; i < TEAMS.length; i++) {
      if (TEAMS[i].id === n) return TEAMS[i];
    }
    return null;
  }

  function round(n, d) {
    if (n == null || !isFinite(n)) return null;
    var p = Math.pow(10, d == null ? 2 : d);
    return Math.round(n * p) / p;
  }

  function recordString(w, l, otl) {
    return String(w || 0) + "–" + String(l || 0) + "–" + String(otl || 0);
  }

  function pointsPct(w, l, otl) {
    var gp = (w || 0) + (l || 0) + (otl || 0);
    if (!gp) return 0;
    return ((w || 0) * 2 + (otl || 0)) / (gp * 2);
  }

  /**
   * PDO from shots on goal: SH% + SV%.
   * SH% = GF / SF, SV% = 1 - GA / SA.
   * Returns 0–200 scale (e.g. 101.4).
   */
  function pdoFromShots(gf, ga, sf, sa) {
    if (!sf || !sa) return null;
    var sh = (gf || 0) / sf;
    var sv = 1 - (ga || 0) / sa;
    return round((sh + sv) * 100, 1);
  }

  function savePct(ga, sa) {
    if (!sa) return null;
    return round(100 * (sa - (ga || 0)) / sa, 1);
  }

  function last5SavePct(log) {
    var last = (log || []).slice(-5);
    var sa = 0;
    var ga = 0;
    last.forEach(function (g) {
      sa += Number(g.sa) || 0;
      ga += Number(g.ga) || 0;
    });
    return savePct(ga, sa);
  }

  function last5SavePctFromMp(mpGames, abbrev, beforeDate) {
    var cut = beforeDate ? String(beforeDate).replace(/-/g, "").slice(0, 8) : null;
    var rows = (mpGames || []).filter(function (g) {
      if (!g || g.team !== abbrev || !g.sa) return false;
      if (!cut) return true;
      var d = String(g.gameDate || "").replace(/-/g, "").slice(0, 8);
      return d && d < cut;
    }).sort(function (a, b) {
      return String(a.gameDate).localeCompare(String(b.gameDate));
    });
    return last5SavePct(rows.slice(-5));
  }

  function sogShare(sf, sa) {
    var tot = (sf || 0) + (sa || 0);
    if (!tot) return null;
    return round((sf || 0) / tot * 100, 1);
  }

  function last5GoalDiff(games, teamAbbrev) {
    var list = (games || []).filter(function (g) {
      return g && (g.gameState === "OFF" || g.gameState === "FINAL" || g.gameState === "FINAL/OT");
    });
    list = list.slice(-5);
    var gd = 0;
    var used = 0;
    list.forEach(function (g) {
      var home = g.homeTeam || {};
      var away = g.awayTeam || {};
      var hs = Number(home.score);
      var as = Number(away.score);
      if (!isFinite(hs) || !isFinite(as)) return;
      var isHome = home.abbrev === teamAbbrev;
      var isAway = away.abbrev === teamAbbrev;
      if (!isHome && !isAway) return;
      gd += isHome ? hs - as : as - hs;
      used += 1;
    });
    if (!used) return null;
    return { games: used, total: gd, avg: round(gd / used, 2) };
  }

  var EDGE_WEIGHTS = {
    ptsPct: 1.2,
    gd: 1.0,
    pdo: 0.35,
    last5: 0.4,
    sogShare: 1.0,
    xgDiff: 1.3,
    cf: 1.2,
    hdcf: 1.15,
    xgf5v5: 1.85,
    stXg: 0.45,
    rest: 0.25
  };

  function cmpNum(a, b) {
    var av = a == null ? 0 : a;
    var bv = b == null ? 0 : b;
    if (av === bv) return 0;
    return av > bv ? 1 : -1;
  }

  /**
   * Score each metric. Positive = away edge, negative = home edge? No:
   * We score from away perspective then flip.
   * Returns { winner: 'away'|'home'|'even', score: number, breakdown: {} }
   */
  function matchupEdge(away, home) {
    var breakdown = [];
    function add(key, aVal, hVal, higherBetter) {
      var dir = cmpNum(aVal, hVal);
      if (!higherBetter) dir = -dir;
      var mag = 0;
      if (aVal != null && hVal != null && isFinite(aVal) && isFinite(hVal)) {
        var span = Math.max(Math.abs(aVal) + Math.abs(hVal), 1);
        mag = Math.abs(aVal - hVal) / span;
      }
      var pts = dir * mag * (EDGE_WEIGHTS[key] || 1);
      breakdown.push({
        key: key,
        away: aVal,
        home: hVal,
        winner: dir > 0 ? "away" : dir < 0 ? "home" : "even",
        points: round(pts, 3)
      });
      return pts;
    }

    var total = 0;
    total += add("ptsPct", away.ptsPct, home.ptsPct, true);
    total += add("gd", away.goalDiff, home.goalDiff, true);
    total += add("pdo", away.pdo, home.pdo, true);
    total += add("last5", away.last5AvgGd, home.last5AvgGd, true);
    total += add("sogShare", away.sogShare, home.sogShare, true);
    total += add("xgDiff", away.gfMinusXg, home.gfMinusXg, true);
    total += add("cf", away.cfPct, home.cfPct, true);
    total += add("hdcf", away.hdcfPct, home.hdcfPct, true);
    total += add("xgf5v5", away.xgfPct5v5, home.xgfPct5v5, true);
    total += add("stXg", away.stXg, home.stXg, true);
    total += add("rest", away.restDays, home.restDays, true);
    total -= 0.12;

    var winner = "even";
    if (total > 0.05) winner = "away";
    else if (total < -0.02) winner = "home";
    else winner = "home";

    return {
      winner: winner,
      score: round(total, 3),
      awayScore: round(Math.max(0, total), 3),
      homeScore: round(Math.max(0, -total), 3),
      breakdown: breakdown
    };
  }

  var METRIC_LABELS = {
    ptsPct: "points percentage",
    gd: "goal differential",
    pdo: "PDO",
    last5: "last-5 games goal differential",
    sogShare: "shots-on-goal share",
    xgDiff: "goals versus expected goals",
    cf: "Corsi for percentage",
    hdcf: "high-danger chances for percentage",
    xgf5v5: "even-strength expected-goals share",
    stXg: "special-teams expected goals",
    rest: "rest days"
  };

  /**
   * Plain-language reason the edge team leads this matchup.
   */
  function explainEdge(edge, away, home) {
    var pick = edge && edge.winner === "away" ? away : home;
    var other = pick === away ? home : away;
    var bits = [];
    if (pick && other && pick.xgfPct5v5 != null && other.xgfPct5v5 != null) {
      bits.push("even-strength expected-goals share " + pick.xgfPct5v5 + "% to " + other.xgfPct5v5 + "%");
    }
    bits.push("home ice");
    if (other && other.b2b && pick && !pick.b2b) bits.push("the other side played last night");
    if (pick && pick.pdo != null && pick.pdo > 102) bits.push("a high shooting-plus-save figure that may regress");
    var name = pick && pick.name ? pick.name : "The home team";
    if (!edge || edge.winner === "even") {
      return name + " is the lean on home ice" + (bits[0] ? " (" + bits[0] + ")" : "") + ".";
    }
    return name + " is the pick: " + bits.join("; ") + ".";
  }

  /**
   * Sign used to color a pill: positive / negative / even / null.
   * PDO colored vs 100; share metrics vs 50; signed diffs vs 0.
   */
  function pillSign(value, kind) {
    if (value == null || !isFinite(value)) return null;
    var baseline = 0;
    if (kind === "pdo") baseline = 100;
    else if (kind === "sv" || kind === "last5Sv") baseline = 90;
    else if (kind === "sogShare" || kind === "cf" || kind === "hdcf" || kind === "xgf5v5") baseline = 50;
    if (value > baseline) return "pos";
    if (value < baseline) return "neg";
    return "even";
  }

  function parseMoneyPuckCsv(text) {
    var lines = String(text || "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return {};
    var header = lines[0].split(",");
    var idx = {};
    header.forEach(function (h, i) { idx[h] = i; });
    var byTeam = {};
    for (var i = 1; i < lines.length; i++) {
      var cols = lines[i].split(",");
      var situation = cols[idx.situation];
      var team = cols[idx.name] || cols[idx.team];
      if (!team) continue;
      if (situation === "5on4" || situation === "4on5") {
        if (!byTeam[team]) byTeam[team] = { team: team };
        var stxgf = Number(cols[idx.xGoalsFor]) || 0;
        var stxga = Number(cols[idx.xGoalsAgainst]) || 0;
        if (situation === "5on4") {
          byTeam[team].ppXgf = stxgf;
          byTeam[team].ppXga = stxga;
        } else {
          byTeam[team].pkXgf = stxgf;
          byTeam[team].pkXga = stxga;
        }
        var pp = byTeam[team].ppXgf;
        var pk = byTeam[team].pkXga;
        if (pp != null && pk != null) byTeam[team].stXg = round(pp - pk, 2);
        continue;
      }
      if (situation === "5on5") {
        if (!byTeam[team]) byTeam[team] = { team: team };
        var xp = Number(cols[idx.xGoalsPercentage]);
        var xgf5 = Number(cols[idx.xGoalsFor]) || 0;
        var xga5 = Number(cols[idx.xGoalsAgainst]) || 0;
        byTeam[team].xgfPct5v5 = isFinite(xp) && xp > 0 && xp < 1.5
          ? round(xp * 100, 1)
          : sogShare(xgf5, xga5);
        continue;
      }
      if (situation !== "all") continue;
      var gp = Number(cols[idx.games_played]) || 0;
      var xgf = Number(cols[idx.xGoalsFor]) || 0;
      var xga = Number(cols[idx.xGoalsAgainst]) || 0;
      var gf = Number(cols[idx.goalsFor]) || 0;
      var ga = Number(cols[idx.goalsAgainst]) || 0;
      var cf = Number(cols[idx.shotAttemptsFor]) || 0;
      var ca = Number(cols[idx.shotAttemptsAgainst]) || 0;
      var sf = Number(cols[idx.shotsOnGoalFor]) || 0;
      var sa = Number(cols[idx.shotsOnGoalAgainst]) || 0;
      var hdf = Number(cols[idx.highDangerShotsFor]) || 0;
      var hda = Number(cols[idx.highDangerShotsAgainst]) || 0;
      if (!byTeam[team]) byTeam[team] = { team: team };
      byTeam[team].games = gp;
      byTeam[team].xGoalsFor = xgf;
      byTeam[team].xGoalsAgainst = xga;
      byTeam[team].goalsFor = gf;
      byTeam[team].goalsAgainst = ga;
      byTeam[team].cfPct = sogShare(cf, ca);
      byTeam[team].sogShare = sogShare(sf, sa);
      byTeam[team].hdcfPct = sogShare(hdf, hda);
      byTeam[team].pdo = pdoFromShots(gf, ga, sf, sa);
      byTeam[team].gfMinusXg = round(gf - xgf, 2);
      byTeam[team].gaMinusXga = round(ga - xga, 2);
    }
    return byTeam;
  }

  function buildTeamProfile(opts) {
    opts = opts || {};
    var stand = opts.stand || {};
    var sum = opts.summary || {};
    var mp = opts.moneypuck || {};
    var last5 = opts.last5 || null;
    var gp = stand.gamesPlayed || sum.gamesPlayed || 0;
    var w = stand.wins != null ? stand.wins : sum.wins;
    var l = stand.losses != null ? stand.losses : sum.losses;
    var otl = stand.otLosses != null ? stand.otLosses : sum.otLosses;
    var gf = stand.goalFor != null ? stand.goalFor : sum.goalsFor;
    var ga = stand.goalAgainst != null ? stand.goalAgainst : sum.goalsAgainst;
    var sf = (sum.shotsForPerGame || 0) * gp;
    var sa = (sum.shotsAgainstPerGame || 0) * gp;
    if (mp.sogShare != null && mp.pdo != null) {
      /* prefer MoneyPuck all-situation shot totals when present */
    }
    var pdo = mp.pdo != null ? mp.pdo : pdoFromShots(gf, ga, sf, sa);
    var share = mp.sogShare != null ? mp.sogShare : sogShare(sf, sa);
    return {
      abbrev: opts.abbrev,
      name: opts.name,
      logo: opts.logo,
      record: recordString(w, l, otl),
      wins: w,
      losses: l,
      otLosses: otl,
      ptsPct: round(pointsPct(w, l, otl), 4),
      goalDiff: stand.goalDifferential != null ? stand.goalDifferential : (gf || 0) - (ga || 0),
      goalsFor: gf,
      goalsAgainst: ga,
      pdo: pdo,
      last5AvgGd: last5 ? last5.avg : null,
      last5SvPct: opts.last5SvPct != null ? opts.last5SvPct : null,
      last5Games: last5 ? last5.games : 0,
      last5Total: last5 ? last5.total : null,
      sogShare: share,
      xGoalsFor: mp.xGoalsFor != null ? round(mp.xGoalsFor, 1) : null,
      xGoalsAgainst: mp.xGoalsAgainst != null ? round(mp.xGoalsAgainst, 1) : null,
      gfMinusXg: mp.gfMinusXg != null ? mp.gfMinusXg : null,
      cfPct: mp.cfPct != null ? mp.cfPct : null,
      hdcfPct: mp.hdcfPct != null ? mp.hdcfPct : null,
      xgfPct5v5: mp.xgfPct5v5 != null ? mp.xgfPct5v5 : null,
      stXg: mp.stXg != null ? mp.stXg : null,
      gamesPlayed: gp,
      restDays: opts.restDays != null ? opts.restDays : null,
      b2b: opts.restDays === 1
    };
  }

  function formatAmerican(n) {
    if (n == null || !isFinite(n)) return "—";
    var v = Math.round(n);
    return (v > 0 ? "+" : "") + v;
  }

  function impliedWinPct(ml) {
    if (ml == null || !isFinite(ml) || ml === 0) return null;
    var p = ml > 0 ? 100 / (ml + 100) : (-ml) / ((-ml) + 100);
    return round(p * 100, 1);
  }

  function parsePartnerOdds(game) {
    function pick(list, desc, qualContains) {
      list = list || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].description !== desc) continue;
        if (qualContains && String(list[i].qualifier || "").indexOf(qualContains) === -1) continue;
        if (!qualContains && desc.indexOf("OVER") === -1 && list[i].qualifier) continue;
        return list[i];
      }
      for (var j = 0; j < list.length; j++) {
        if (list[j].description === desc && !qualContains) return list[j];
      }
      return null;
    }
    var away = (game && game.awayTeam && game.awayTeam.odds) || [];
    var home = (game && game.homeTeam && game.homeTeam.odds) || [];
    var awayMl = pick(away, "MONEY_LINE_2_WAY");
    var homeMl = pick(home, "MONEY_LINE_2_WAY");
    var over = pick(home, "OVER_UNDER", "O") || pick(away, "OVER_UNDER", "O");
    var under = pick(away, "OVER_UNDER", "U") || pick(home, "OVER_UNDER", "U");
    var total = null;
    var overQ = over && over.qualifier;
    var underQ = under && under.qualifier;
    var m = String(overQ || underQ || "").match(/[OU]?\s*([0-9.]+)/);
    if (m) total = Number(m[1]);
    return {
      awayMl: awayMl ? awayMl.value : null,
      homeMl: homeMl ? homeMl.value : null,
      total: total,
      overPrice: over ? over.value : null,
      underPrice: under ? under.value : null
    };
  }

  function rate(total, gp, fallback) {
    if (total == null || !isFinite(total)) return fallback;
    if (!gp) return fallback;
    return total / gp;
  }

  /**
   * Projected score from GF/GA rates and xG, with 5v5 xGF% tilt,
   * a small last-5 term, and home ice. Ties are broken toward home
   * (NHL games in the 2025-26 backtest never finished even).
   */
  function estimateScore(away, home) {
    away = away || {};
    home = home || {};
    var agp = away.gamesPlayed || 82;
    var hgp = home.gamesPlayed || 82;
    var awayGf = rate(away.goalsFor, agp, 3);
    var homeGf = rate(home.goalsFor, hgp, 3);
    var awayGa = rate(away.goalsAgainst, agp, 3);
    var homeGa = rate(home.goalsAgainst, hgp, 3);
    var awayXg = rate(away.xGoalsFor, agp, awayGf);
    var homeXg = rate(home.xGoalsFor, hgp, homeGf);
    var awayOff = 0.40 * awayGf + 0.35 * awayXg + 0.25 * homeGa;
    var homeOff = 0.40 * homeGf + 0.35 * homeXg + 0.25 * awayGa;
    if (away.last5AvgGd != null) awayOff += 0.04 * away.last5AvgGd;
    if (home.last5AvgGd != null) homeOff += 0.04 * home.last5AvgGd;
    if (away.hdcfPct != null && home.hdcfPct != null) {
      var hdTilt = (away.hdcfPct - home.hdcfPct) / 100;
      awayOff += hdTilt * 0.35;
      homeOff -= hdTilt * 0.35;
    }
    if (away.xgfPct5v5 != null && home.xgfPct5v5 != null) {
      var xTilt = (away.xgfPct5v5 - home.xgfPct5v5) / 100;
      awayOff += xTilt * 1.35;
      homeOff -= xTilt * 1.35;
    }
    homeOff += 0.32;
    if (away.restDays === 1) awayOff -= 0.15;
    if (home.restDays === 1) homeOff -= 0.15;
    if (home.restDays >= 3 && away.restDays === 1) homeOff += 0.08;
    if (away.stXg != null && home.stXg != null) {
      var stTilt = (away.stXg - home.stXg) / 20;
      awayOff += stTilt * 0.25;
      homeOff -= stTilt * 0.25;
    }
    awayOff = Math.max(1.2, awayOff);
    homeOff = Math.max(1.2, homeOff);
    var a = Math.round(awayOff);
    var h = Math.round(homeOff);
    if (a < 1) a = 1;
    if (h < 1) h = 1;
    if (a === h) {
      if (homeOff >= awayOff) h += 1;
      else a += 1;
    }
    return {
      away: a,
      home: h,
      awayRaw: round(awayOff, 2),
      homeRaw: round(homeOff, 2),
      label: a + "–" + h
    };
  }

  return {
    TEAMS: TEAMS,
    teamByAbbrev: teamByAbbrev,
    teamById: teamById,
    round: round,
    recordString: recordString,
    pointsPct: pointsPct,
    pdoFromShots: pdoFromShots,
    savePct: savePct,
    last5SavePct: last5SavePct,
    last5SavePctFromMp: last5SavePctFromMp,
    sogShare: sogShare,
    last5GoalDiff: last5GoalDiff,
    matchupEdge: matchupEdge,
    parseMoneyPuckCsv: parseMoneyPuckCsv,
    buildTeamProfile: buildTeamProfile,
    estimateScore: estimateScore,
    parsePartnerOdds: parsePartnerOdds,
    formatAmerican: formatAmerican,
    impliedWinPct: impliedWinPct,
    twoWayHold: function (a, h) {
      var pa = impliedWinPct(a);
      var ph = impliedWinPct(h);
      if (pa == null || ph == null) return null;
      return round(pa + ph - 100, 1);
    },
    countPositivePills: function (t) {
      t = t || {};
      var n = 0;
      if (pillSign(t.pdo, "pdo") === "pos") n += 1;
      if (pillSign(t.last5AvgGd, "last5") === "pos") n += 1;
      if (pillSign(t.last5SvPct, "last5Sv") === "pos") n += 1;
      if (pillSign(t.sogShare, "sogShare") === "pos") n += 1;
      if (pillSign(t.gfMinusXg, "xgDiff") === "pos") n += 1;
      if (pillSign(t.cfPct, "cf") === "pos") n += 1;
      if (pillSign(t.hdcfPct, "hdcf") === "pos") n += 1;
      if (pillSign(t.xgfPct5v5, "xgf5v5") === "pos") n += 1;
      if (pillSign(t.stXg, "stXg") === "pos") n += 1;
      return n;
    },
    gameLabel: function (gameType) {
      if (Number(gameType) === 1) return "Preseason";
      if (Number(gameType) === 3) return "Playoffs";
      return "Regular season";
    },
    explainEdge: explainEdge,
    pillSign: pillSign,
    METRIC_LABELS: METRIC_LABELS,
    EDGE_WEIGHTS: EDGE_WEIGHTS
  };
});
