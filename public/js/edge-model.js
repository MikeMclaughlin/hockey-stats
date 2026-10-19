(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyEdgeModel = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Logistic P(home win), fit by gradient descent on graded games from
  // 2021-22 through 2024-25 (4,902 games). Features are standardized with
  // the training mean and sd. 2025-26 was held out: 675 of 1,226 picks
  // (55.1%), and 141 of 204 games at a 65%+ win chance (69.1%).
  // xG share is the pre-game 5-on-5 share already stored on each backtest
  // row (home minus away). PDO and last-five save percentage stay in the
  // feature list so the fit's column order is unchanged, and both weights
  // are 0 so those pills do not move the win chance.
  var NAMES = ["homeIce", "xgShare", "last5Gd", "pdo", "sv", "b2b", "projMargin"];
  var WEIGHTS = [0.171466, 0.350884, 0.048083, 0, 0, 0.155218, 0.135108];
  var MEAN = [0, -0.069604, -0.048633, 0.01022, -0.019319, 0.109343, 0.369645];
  var SD = [1, 5.825264, 1.867758, 2.824197, 3.883198, 0.455125, 1.143356];
  var VALIDATION = {
    season: "2025-26",
    games: 1226,
    picksRight: 675,
    pickPct: 55.1,
    confidentGames: 204,
    confidentRight: 141,
    confidentPct: 69.1
  };
  var LABELS = {
    homeIce: "Home ice",
    xgShare: "5-on-5 xG share, home minus away",
    last5Gd: "Last-five goal differential, home minus away",
    pdo: "PDO, home minus away",
    sv: "Last-five save percentage, home minus away",
    b2b: "Back-to-back, away tired minus home tired",
    projMargin: "Projected margin, home minus away"
  };

  // null and "" are missing. Number(null) is 0, which would treat a
  // blank xG share, PDO, or save percentage as a real zero and blow the
  // logit up early in the season.
  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function diff(home, away) {
    var h = num(home);
    var a = num(away);
    if (h == null || a == null) return 0;
    return h - a;
  }

  function sigmoid(z) {
    if (z > 30) return 1;
    if (z < -30) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  function rawFeatures(input) {
    input = input || {};
    return [
      1,
      diff(input.homeXg, input.awayXg),
      diff(input.homeLast5, input.awayLast5),
      diff(input.homePdo, input.awayPdo),
      diff(input.homeSv, input.awaySv),
      (input.awayB2B ? 1 : 0) - (input.homeB2B ? 1 : 0),
      diff(input.projectedHome, input.projectedAway)
    ];
  }

  // Each standardized feature is capped at ±2.5 training standard
  // deviations. A one-game rate can sit further out than the 2021-25 fit.
  // 2.5 keeps 2026-27 under 90% and moves two 2025-26 picks.
  var CAP_SD = 2.5;

  function homeWinProbability(input) {
    var raw = rawFeatures(input);
    var z = 0;
    for (var j = 0; j < WEIGHTS.length; j++) {
      var x = j === 0 ? 1 : (raw[j] - MEAN[j]) / SD[j];
      if (j > 0 && x > CAP_SD) x = CAP_SD;
      if (j > 0 && x < -CAP_SD) x = -CAP_SD;
      z += WEIGHTS[j] * x;
    }
    return sigmoid(z);
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function band(pct) {
    if (pct >= 65) return "Confident";
    if (pct >= 55) return "Lean";
    return "Toss-up";
  }

  function downgrade(label) {
    if (label === "Confident") return "Lean";
    if (label === "Lean") return "Toss-up";
    return "Toss-up";
  }

  // A last-5 xG downgrade keeps the win chance and changes the word.
  // Quote a band only when the chance actually sits in it.
  function labelTitle(model) {
    model = model || {};
    var pct = num(model.pickPct);
    var chance = "Calibrated win chance " + (pct == null ? "—" : pct) + "%.";
    if (model.dogGated) {
      return "Toss-up. The Edge side is the market underdog, and it does not have an absolute Edge score of " +
        UNDERDOG_ABS_SCORE + " or a lead in shots-on-goal share, even-strength expected-goals share, and shot-attempt share. " +
        chance;
    }
    if (model.scoreGated) {
      return "Toss-up. This Lean’s absolute Edge score is under " + scoreCutoff() + ", so it is not a firm pick. " + chance;
    }
    if (model.downgraded && model.labelBefore && model.labelBefore !== model.label) {
      return "Lowered from " + model.labelBefore + " to " + model.label +
        " because the pick's last-5 xG share is below the opponent. " +
        chance + " The side was not flipped.";
    }
    if (model.label === "Strong") {
      return "Strong. Win chance 65% or more, and the pick leads shots-on-goal share, even-strength expected-goals share, and shot-attempt share by an average of " +
        STRONG_AVG_GAP + " points or more. " + chance;
    }
    if (model.label === "Confident" && pct != null && pct >= 65) {
      return "Confident at 65% or more, and the pick leads shots-on-goal share, even-strength expected-goals share, and shot-attempt share. The average lead is under " +
        STRONG_AVG_GAP + " points. " + chance;
    }
    if (model.top3Demoted) {
      return "Lean. The win chance is in the Confident band, and the pick does not lead all three of shots-on-goal share, even-strength expected-goals share, and shot-attempt share. " +
        chance;
    }
    if (model.label === "Lean" && pct != null && pct >= 55 && pct < 65) {
      return "Lean, from 55% up to 65%, with an absolute Edge score of at least " + scoreCutoff() + ". " + chance;
    }
    if (model.label === "Toss-up" && pct != null && pct < 55) {
      return "Toss-up, under 55%. " + chance;
    }
    return (model.label || "Pick") + ". " + chance;
  }

  function sideName(side, input) {
    if (side === "away") return input.awayAbbrev || "Away";
    return input.homeAbbrev || "Home";
  }

  function last5Side(input) {
    var a = num(input.awayLast5Xg);
    var h = num(input.homeLast5Xg);
    if (a == null || h == null || a === h) return null;
    return h > a ? "home" : "away";
  }

  function projectedSide(input) {
    var a = num(input.projectedAway);
    var h = num(input.projectedHome);
    if (a == null || h == null || a === h) return null;
    return h > a ? "home" : "away";
  }

  function scoreCutoff() {
    var fromStats = null;
    if (typeof require === "function") {
      try { fromStats = require("./stats.js").TOSSUP_ABS_SCORE; }
      catch (e) { fromStats = null; }
    }
    var g = typeof globalThis !== "undefined" ? globalThis : null;
    if (fromStats == null && g && g.HockeyStats && g.HockeyStats.TOSSUP_ABS_SCORE != null) {
      fromStats = g.HockeyStats.TOSSUP_ABS_SCORE;
    }
    return fromStats == null ? 0.5 : fromStats;
  }

  // Same band as the old 65% Edge score. A market underdog needs this
  // absolute score, or a lead in all three top shares.
  var UNDERDOG_ABS_SCORE = 1.75;
  var STRONG_AVG_GAP = 3;

  function oldPickPct(edge) {
    if (!edge) return null;
    var score = num(edge.score);
    if (score == null) {
      if (edge.tossUp) return null;
      if (edge.winner && edge.winner !== "even") return 55;
      return null;
    }
    if (Math.abs(score) < scoreCutoff()) return null;
    return Math.abs(score) >= 1.75 ? 65 : 55;
  }

  function impliedPct(ml) {
    var n = num(ml);
    if (n == null || n === 0) return null;
    var p = n > 0 ? 100 / (n + 100) : (-n) / ((-n) + 100);
    return Math.round(p * 1000) / 10;
  }

  function marketSideFromMl(awayMl, homeMl) {
    var away = impliedPct(awayMl);
    var home = impliedPct(homeMl);
    if (away == null || home == null) return null;
    if (Math.abs(away - home) < 0.5) return "even";
    return away > home ? "away" : "home";
  }

  function top3Lead(input, pick) {
    var pairs = [
      ["awaySog", "homeSog"],
      ["awayXg", "homeXg"],
      ["awayCf", "homeCf"]
    ];
    var gaps = [];
    for (var i = 0; i < pairs.length; i++) {
      var away = num(input[pairs[i][0]]);
      var home = num(input[pairs[i][1]]);
      if (away == null || home == null) return { all: false, avg: null };
      gaps.push(pick === "home" ? home - away : away - home);
    }
    return {
      all: gaps[0] > 0 && gaps[1] > 0 && gaps[2] > 0,
      avg: (gaps[0] + gaps[1] + gaps[2]) / 3
    };
  }

  function chipsFor(input, pick) {
    var chips = [];
    var pickX = num(pick === "home" ? input.homeLast5Xg : input.awayLast5Xg);
    var oppX = num(pick === "home" ? input.awayLast5Xg : input.homeLast5Xg);
    if (pickX != null && oppX != null) {
      var lead = pickX - oppX;
      var shown = Math.round(lead);
      if (shown >= 5) {
        var strong = shown >= 10;
        chips.push({
          key: "xg",
          strong: strong,
          text: "xG last 5 +" + shown,
          title: "The picked team's last five games expected-goals share is " + shown +
            " points higher than the opponent. Backtest win rate " +
            (strong ? "70%" : "66%") + " when this lead is " +
            (strong ? "10 points or more." : "5 to 9 points.")
        });
      }
    }
    var pickGoals = num(pick === "home" ? input.projectedHome : input.projectedAway);
    var oppGoals = num(pick === "home" ? input.projectedAway : input.projectedHome);
    if (pickGoals != null && oppGoals != null && pickGoals - oppGoals >= 2) {
      var margin = Math.round((pickGoals - oppGoals) * 10) / 10;
      chips.push({
        key: "margin",
        strong: false,
        text: "Margin +" + margin,
        title: "The projected score favors the pick by " + margin +
          " goals. Backtest win rate 72.5% when the margin is 2 goals or more."
      });
    }
    var pickB2B = pick === "home" ? !!input.homeB2B : !!input.awayB2B;
    var oppB2B = pick === "home" ? !!input.awayB2B : !!input.homeB2B;
    if (oppB2B && !pickB2B) {
      chips.push({
        key: "rest",
        strong: false,
        text: "Rested vs B2B",
        title: "The opponent is on a back-to-back and the picked team is rested. Backtest win rate 67.2%."
      });
    }
    return chips;
  }

  function assess(input) {
    input = input || {};
    var homeP = homeWinProbability(input);
    var pick = homeP >= 0.5 ? "home" : "away";
    var pickP = (pick === "home" ? homeP : 1 - homeP) * 100;
    var pickPct = round1(pickP);
    var label = band(pickPct);
    var labelBefore = label;
    var pickX = num(pick === "home" ? input.homeLast5Xg : input.awayLast5Xg);
    var oppX = num(pick === "home" ? input.awayLast5Xg : input.homeLast5Xg);
    var downgraded = false;
    if (pickX != null && oppX != null && pickX < oppX) {
      var dropped = downgrade(label);
      downgraded = dropped !== label;
      label = dropped;
    }
    var top = top3Lead(input, pick);
    var score = num(input.edgeScore);
    var absScore = score == null ? null : Math.abs(score);
    var top3Demoted = false;
    if (label === "Confident" && !top.all) {
      label = "Lean";
      top3Demoted = true;
    }
    if (label === "Confident" && top.all && top.avg >= STRONG_AVG_GAP) label = "Strong";
    var scoreGated = false;
    if (label === "Lean" && absScore != null && absScore < scoreCutoff()) {
      label = "Toss-up";
      scoreGated = true;
    }
    var market = marketSideFromMl(input.awayMl, input.homeMl);
    var dogGated = false;
    if (label !== "Toss-up" && market && market !== "even" && pick !== market) {
      var bigScore = absScore != null && absScore >= UNDERDOG_ABS_SCORE;
      if (!(bigScore || top.all)) {
        label = "Toss-up";
        dogGated = true;
      }
    }
    var xgSide = last5Side(input);
    var projSide = projectedSide(input);
    var pickB2B = pick === "home" ? !!input.homeB2B : !!input.awayB2B;
    var oppB2B = pick === "home" ? !!input.awayB2B : !!input.homeB2B;
    var badRest = pickB2B && !oppB2B;
    var confidentPick = !!(xgSide && projSide && pick === xgSide && pick === projSide && !badRest);
    var month = String(input.gameDate || "").slice(5, 7);
    return {
      homeProb: round1(homeP * 100),
      awayProb: round1((1 - homeP) * 100),
      pick: pick,
      pickAbbrev: sideName(pick, input),
      pickPct: pickPct,
      label: label,
      labelBefore: labelBefore,
      downgraded: downgraded,
      top3Demoted: top3Demoted,
      scoreGated: scoreGated,
      dogGated: dogGated,
      confidentPick: confidentPick,
      earlySeason: month === "10" || month === "11",
      chips: chipsFor(input, pick),
      oldPct: oldPickPct({
        score: input.edgeScore,
        winner: input.edgeWinner,
        tossUp: input.edgeTossUp
      })
    };
  }

  function fromBacktestRow(row) {
    row = row || {};
    return assess({
      awayAbbrev: row.awayAbbrev,
      homeAbbrev: row.homeAbbrev,
      awayXg: row.awayXgf5,
      homeXg: row.homeXgf5,
      awaySog: row.awaySog,
      homeSog: row.homeSog,
      awayCf: row.awayCf,
      homeCf: row.homeCf,
      awayMl: row.openingAwayMl,
      homeMl: row.openingHomeMl,
      awayLast5Xg: row.awayLast5Xgf,
      homeLast5Xg: row.homeLast5Xgf,
      awayLast5: row.awayLast5,
      homeLast5: row.homeLast5,
      awayPdo: row.awayPdo,
      homePdo: row.homePdo,
      awaySv: row.awayLast5Sv,
      homeSv: row.homeLast5Sv,
      awayB2B: !!row.awayB2B,
      homeB2B: !!row.homeB2B,
      projectedAway: row.projectedAway,
      projectedHome: row.projectedHome,
      gameDate: row.gameDate,
      edgeScore: row.edgeScore,
      edgeWinner: row.edgeAbbrev === row.awayAbbrev ? "away" : row.edgeAbbrev === row.homeAbbrev ? "home" : null,
      edgeTossUp: !!row.edgeTossUp
    });
  }

  function fromMatchup(m) {
    m = m || {};
    var away = m.away || {};
    var home = m.home || {};
    var proj = m.projected || {};
    var edge = m.edge || {};
    return assess({
      awayAbbrev: away.abbrev,
      homeAbbrev: home.abbrev,
      awayXg: away.xgfPct5v5,
      homeXg: home.xgfPct5v5,
      awaySog: away.sogShare,
      homeSog: home.sogShare,
      awayCf: away.cfPct,
      homeCf: home.cfPct,
      awayMl: m.odds && m.odds.awayMl,
      homeMl: m.odds && m.odds.homeMl,
      awayLast5Xg: away.last5XgfPct,
      homeLast5Xg: home.last5XgfPct,
      awayLast5: away.last5AvgGd,
      homeLast5: home.last5AvgGd,
      awayPdo: away.pdo,
      homePdo: home.pdo,
      awaySv: away.last5SvPct,
      homeSv: home.last5SvPct,
      awayB2B: !!away.b2b,
      homeB2B: !!home.b2b,
      projectedAway: proj.away,
      projectedHome: proj.home,
      gameDate: m.gameDate,
      edgeScore: edge.score,
      edgeWinner: edge.winner,
      edgeTossUp: !!(m.edgeTossUp || (edge.score != null && Math.abs(edge.score) < scoreCutoff()))
    });
  }

  function coefficients() {
    return NAMES.map(function (name, i) {
      return {
        name: name,
        label: LABELS[name],
        weight: WEIGHTS[i],
        mean: MEAN[i],
        sd: SD[i]
      };
    });
  }

  return {
    NAMES: NAMES,
    WEIGHTS: WEIGHTS,
    MEAN: MEAN,
    SD: SD,
    VALIDATION: VALIDATION,
    homeWinProbability: homeWinProbability,
    oldPickPct: oldPickPct,
    UNDERDOG_ABS_SCORE: UNDERDOG_ABS_SCORE,
    STRONG_AVG_GAP: STRONG_AVG_GAP,
    assess: assess,
    labelTitle: labelTitle,
    fromBacktestRow: fromBacktestRow,
    fromMatchup: fromMatchup,
    coefficients: coefficients
  };
});
