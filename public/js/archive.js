(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyArchive = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function winnerOf(away, home) {
    if (away == null || home == null) return null;
    if (away > home) return "away";
    if (home > away) return "home";
    return "tie";
  }

  function emptyStore() {
    return { version: 1, byId: {} };
  }

  function parseTime(iso) {
    var t = Date.parse(iso || "");
    return isFinite(t) ? t : null;
  }

  /**
   * Puck drop freezes the lock. Before that, a changed projection may replace it.
   */
  function hasStarted(row, nowMs) {
    if (!row) return false;
    if (isFinalState(row.gameState)) return true;
    var state = String(row.gameState || "").toUpperCase();
    if (state === "LIVE" || state === "CRIT" || state.indexOf("LIVE") === 0) return true;
    var start = parseTime(row.startTimeUTC);
    if (start != null && nowMs != null && start <= nowMs) return true;
    return false;
  }

  function shouldRelock(existing, incoming, now) {
    if (!existing || existing.graded) return false;
    if (!incoming) return false;
    var nowMs = parseTime(now);
    if (nowMs == null) nowMs = Date.now();
    if (hasStarted(existing, nowMs) || hasStarted(incoming, nowMs)) return false;
    if (isFinalState(incoming.gameState)) return false;
    if (incoming.projectedAway == null || incoming.projectedHome == null) return false;
    return Number(existing.projectedAway) !== Number(incoming.projectedAway) ||
      Number(existing.projectedHome) !== Number(incoming.projectedHome);
  }

  function applyProjection(existing, row, now) {
    if (!existing.priorLocks) existing.priorLocks = [];
    existing.priorLocks.push({
      projectedAway: existing.projectedAway,
      projectedHome: existing.projectedHome,
      projectedLabel: existing.projectedLabel,
      lockedAt: existing.lockedAt || existing.createdAt || null
    });
    existing.projectedAway = row.projectedAway;
    existing.projectedHome = row.projectedHome;
    existing.projectedLabel = row.projectedAway + "–" + row.projectedHome;
    existing.lockedAt = now || new Date().toISOString();
    existing.relocked = true;
    return existing;
  }

  /**
   * First projection for a game is frozen once the puck drops.
   * Pass { relock: true } to replace the lock while the game is still in the future.
   */
  function freezeEstimate(store, row, opts) {
    store = store || emptyStore();
    store.byId = store.byId || {};
    opts = opts || {};
    var id = String(row.id);
    var existing = store.byId[id];
    if (existing) {
      if (!existing.lockedAt) existing.lockedAt = existing.createdAt || new Date().toISOString();
      if (row.gameState) existing.gameState = row.gameState;
      if (row.startTimeUTC) existing.startTimeUTC = row.startTimeUTC;
      if (opts.relock && shouldRelock(existing, row, opts.now)) {
        applyProjection(existing, row, opts.now);
      }
      var nowMs = parseTime(opts.now);
      if (nowMs == null) nowMs = Date.now();
      existing.lockOpen = !existing.graded && !hasStarted(existing, nowMs);
      return existing;
    }
    var saved = {
      id: row.id,
      seasonId: row.seasonId || null,
      gameDate: row.gameDate || null,
      startTimeUTC: row.startTimeUTC || null,
      venue: row.venue || null,
      awayAbbrev: row.awayAbbrev,
      homeAbbrev: row.homeAbbrev,
      awayName: row.awayName,
      homeName: row.homeName,
      projectedAway: row.projectedAway,
      projectedHome: row.projectedHome,
      projectedLabel: row.projectedAway + "–" + row.projectedHome,
      createdAt: new Date().toISOString(),
      lockedAt: new Date().toISOString(),
      graded: false,
      correct: null,
      winnerCorrect: null,
      actualAway: null,
      actualHome: null,
      actualLabel: null,
      gameState: row.gameState || "FUT"
    };
    store.byId[id] = saved;
    return saved;
  }

  function teamPills(t) {
    t = t || {};
    return {
      record: t.record || null,
      ptsPct: t.ptsPct != null ? t.ptsPct : null,
      goalDiff: t.goalDiff != null ? t.goalDiff : null,
      pdo: t.pdo != null ? t.pdo : null,
      last5AvgGd: t.last5AvgGd != null ? t.last5AvgGd : null,
      last5SvPct: t.last5SvPct != null ? t.last5SvPct : null,
      sogShare: t.sogShare != null ? t.sogShare : null,
      gfMinusXg: t.gfMinusXg != null ? t.gfMinusXg : null,
      cfPct: t.cfPct != null ? t.cfPct : null,
      hdcfPct: t.hdcfPct != null ? t.hdcfPct : null,
      xgfPct5v5: t.xgfPct5v5 != null ? t.xgfPct5v5 : null,
      stXg: t.stXg != null ? t.stXg : null,
      restDays: t.restDays != null ? t.restDays : null
    };
  }

  function freezeMatchupArchive(store, row) {
    store = store || emptyStore();
    store.byId = store.byId || {};
    var id = String(row.id);
    if (store.byId[id]) {
      if (!store.byId[id].lockedAt) store.byId[id].lockedAt = store.byId[id].createdAt;
      return store.byId[id];
    }
    store.byId[id] = {
      id: row.id,
      seasonId: row.seasonId || null,
      gameDate: row.gameDate || null,
      startTimeUTC: row.startTimeUTC || null,
      venue: row.venue || null,
      gameType: row.gameType || null,
      awayAbbrev: row.awayAbbrev,
      homeAbbrev: row.homeAbbrev,
      estimatedAway: row.estimatedAway,
      estimatedHome: row.estimatedHome,
      estimatedLabel: row.estimatedAway + "–" + row.estimatedHome,
      awayPills: row.awayPills || teamPills(row.away),
      homePills: row.homePills || teamPills(row.home),
      odds: row.odds || null,
      createdAt: new Date().toISOString(),
      lockedAt: new Date().toISOString()
    };
    return store.byId[id];
  }

  function applyResult(row, actualAway, actualHome, gameState) {
    if (actualAway == null || actualHome == null || !isFinite(actualAway) || !isFinite(actualHome)) {
      return row;
    }
    row.actualAway = Number(actualAway);
    row.actualHome = Number(actualHome);
    row.actualLabel = row.actualAway + "–" + row.actualHome;
    row.gameState = gameState || row.gameState;
    row.correct = row.projectedAway === row.actualAway && row.projectedHome === row.actualHome;
    row.winnerCorrect = winnerOf(row.projectedAway, row.projectedHome) === winnerOf(row.actualAway, row.actualHome);
    var errs = scoreErrors(row);
    row.totalGoalsError = errs.totalGoalsError;
    row.marginError = errs.marginError;
    row.projectedTotal = errs.projectedTotal;
    row.actualTotal = errs.actualTotal;
    row.graded = true;
    row.gradedAt = row.gradedAt || new Date().toISOString();
    return row;
  }

  function scoreErrors(row) {
    row = row || {};
    if (row.projectedAway == null || row.projectedHome == null || row.actualAway == null || row.actualHome == null) {
      return { totalGoalsError: null, marginError: null, projectedTotal: null, actualTotal: null };
    }
    var projectedTotal = Number(row.projectedAway) + Number(row.projectedHome);
    var actualTotal = Number(row.actualAway) + Number(row.actualHome);
    var projectedMargin = Number(row.projectedAway) - Number(row.projectedHome);
    var actualMargin = Number(row.actualAway) - Number(row.actualHome);
    return {
      totalGoalsError: Math.abs(projectedTotal - actualTotal),
      marginError: Math.abs(projectedMargin - actualMargin),
      projectedTotal: projectedTotal,
      actualTotal: actualTotal
    };
  }

  function isFinalState(state) {
    var s = String(state || "").toUpperCase();
    return s === "OFF" || s === "FINAL" || s.indexOf("FINAL") === 0;
  }

  function listEstimates(store) {
    store = store || emptyStore();
    return Object.keys(store.byId || {}).map(function (k) { return store.byId[k]; });
  }

  function summarize(rows) {
    var total = rows.length;
    var graded = 0;
    var exact = 0;
    var winner = 0;
    var totalErr = 0;
    var marginErr = 0;
    rows.forEach(function (r) {
      if (!r.graded) return;
      graded += 1;
      if (r.correct) exact += 1;
      if (r.winnerCorrect) winner += 1;
      var errs = scoreErrors(r);
      if (errs.totalGoalsError != null) totalErr += errs.totalGoalsError;
      if (errs.marginError != null) marginErr += errs.marginError;
    });
    return {
      total: total,
      graded: graded,
      pending: total - graded,
      exact: exact,
      winner: winner,
      exactPct: graded ? Math.round((exact / graded) * 1000) / 10 : null,
      winnerPct: graded ? Math.round((winner / graded) * 1000) / 10 : null,
      meanTotalGoalsError: graded ? Math.round((totalErr / graded) * 100) / 100 : null,
      meanMarginError: graded ? Math.round((marginErr / graded) * 100) / 100 : null,
      empty: graded === 0
    };
  }

  /**
   * Keep the pre-game Edge pick until puck drop, then lock it.
   * A game that has already started does not gain a new pick.
   * edgeWinner is the 2.6 side. pointsEdgeWinner is the older points score side.
   */
  function rememberEdge(existing, row, nowMs) {
    if (!existing || !row || !row.edgeWinner) return existing;
    if (existing.edgeLocked) return existing;
    if (hasStarted(existing, nowMs) || hasStarted(row, nowMs)) {
      if (existing.edgeWinner) existing.edgeLocked = true;
      return existing;
    }
    if (!existing.pointsEdgeWinner && row.pointsEdgeWinner) {
      existing.pointsEdgeWinner = row.pointsEdgeWinner;
    }
    existing.edgeWinner = row.edgeWinner;
    existing.edgeScore = row.edgeScore != null ? row.edgeScore : null;
    existing.edgeAbbrev = row.edgeAbbrev || null;
    existing.edgeTossUp = !!row.edgeTossUp;
    existing.edgeLabel = row.edgeLabel || null;
    existing.edgeLocked = false;
    return existing;
  }

  // American prices at or beyond this size are live-board junk, not a pregame line.
  var IMPOSSIBLE_ML = 10000;

  function priceImpossible(ml) {
    if (ml == null || ml === "" || !isFinite(Number(ml))) return false;
    return Math.abs(Number(ml)) >= IMPOSSIBLE_ML;
  }

  /**
   * True when this saved line was first captured at or after puck drop,
   * or the price itself cannot be a pregame moneyline.
   */
  function oddsCapturedAfterStart(row) {
    if (!row) return false;
    if (priceImpossible(row.awayMl) || priceImpossible(row.homeMl)) return true;
    if (row.voidedReason) return true;
    var start = parseTime(row.startTimeUTC);
    var captured = parseTime(row.capturedAt);
    if (start != null && captured != null && captured >= start) return true;
    return false;
  }

  function clearOddsLines(row) {
    if (!row) return row;
    row.awayMl = null;
    row.homeMl = null;
    row.total = null;
    row.overPrice = null;
    row.underPrice = null;
    row.voidedReason = "captured-after-start";
    row.locked = true;
    return row;
  }

  function oddsLines(odds) {
    if (!odds) return null;
    var awayMl = odds.awayMl != null && odds.awayMl !== "" ? Number(odds.awayMl) : null;
    var homeMl = odds.homeMl != null && odds.homeMl !== "" ? Number(odds.homeMl) : null;
    var total = odds.total != null && odds.total !== "" ? Number(odds.total) : null;
    if (!isFinite(awayMl)) awayMl = null;
    if (!isFinite(homeMl)) homeMl = null;
    if (!isFinite(total)) total = null;
    if (awayMl == null && homeMl == null && total == null) return null;
    var overPrice = odds.overPrice != null ? Number(odds.overPrice) : null;
    var underPrice = odds.underPrice != null ? Number(odds.underPrice) : null;
    return {
      awayMl: awayMl,
      homeMl: homeMl,
      total: total,
      overPrice: isFinite(overPrice) ? overPrice : null,
      underPrice: isFinite(underPrice) ? underPrice : null,
      partner: odds.partner || null
    };
  }

  /**
   * Keep the moneyline and total until puck drop. After the game starts,
   * a line captured before the start is locked and later prices do not
   * replace it. A first line seen only after the start is not saved.
   * A line already stored from after the start is wiped.
   */
  function snapshotOdds(store, row, nowIso) {
    store = store || { version: 1, byId: {} };
    store.byId = store.byId || {};
    var id = String(row && row.id);
    var existing = store.byId[id];
    var nowMs = parseTime(nowIso);
    if (nowMs == null) nowMs = Date.now();
    if (existing && oddsCapturedAfterStart(existing)) {
      var hadLine = existing.awayMl != null || existing.homeMl != null || existing.total != null;
      clearOddsLines(existing);
      if (row && row.gameState) existing.gameState = row.gameState;
      if (row && row.startTimeUTC && !existing.startTimeUTC) existing.startTimeUTC = row.startTimeUTC;
      return { store: store, row: existing, wrote: hadLine };
    }
    var started = hasStarted(row, nowMs) || (existing && hasStarted(existing, nowMs));
    if (started && !existing) {
      return { store: store, row: null, wrote: false };
    }
    if (existing && (existing.locked || existing.voidedReason || started)) {
      var changed = !existing.locked;
      existing.locked = true;
      if (row.gameState) existing.gameState = row.gameState;
      if (row.startTimeUTC && !existing.startTimeUTC) existing.startTimeUTC = row.startTimeUTC;
      return { store: store, row: existing, wrote: changed };
    }
    var lines = oddsLines(row && row.odds);
    if (lines && (priceImpossible(lines.awayMl) || priceImpossible(lines.homeMl))) {
      return { store: store, row: existing || null, wrote: false };
    }
    if (!lines) return { store: store, row: existing || null, wrote: false };
    var now = nowIso || new Date().toISOString();
    var saved = {
      id: row.id,
      gameDate: row.gameDate || (existing && existing.gameDate) || null,
      startTimeUTC: row.startTimeUTC || (existing && existing.startTimeUTC) || null,
      gameState: row.gameState || (existing && existing.gameState) || null,
      awayAbbrev: row.awayAbbrev || (existing && existing.awayAbbrev) || null,
      homeAbbrev: row.homeAbbrev || (existing && existing.homeAbbrev) || null,
      awayMl: lines.awayMl,
      homeMl: lines.homeMl,
      total: lines.total,
      overPrice: lines.overPrice,
      underPrice: lines.underPrice,
      partner: lines.partner,
      capturedAt: (existing && existing.capturedAt) || now,
      updatedAt: now,
      locked: !!started
    };
    store.byId[id] = saved;
    return { store: store, row: saved, wrote: true };
  }

  function verdict(row) {
    if (!row || !row.graded) return "pending";
    if (row.correct) return "exact";
    if (row.winnerCorrect) return "winner";
    return "miss";
  }

  return {
    emptyStore: emptyStore,
    freezeEstimate: freezeEstimate,
    freezeMatchupArchive: freezeMatchupArchive,
    teamPills: teamPills,
    applyResult: applyResult,
    isFinalState: isFinalState,
    listEstimates: listEstimates,
    summarize: summarize,
    scoreErrors: scoreErrors,
    rememberEdge: rememberEdge,
    verdict: verdict,
    winnerOf: winnerOf,
    hasStarted: hasStarted,
    oddsLines: oddsLines,
    snapshotOdds: snapshotOdds,
    shouldRelock: shouldRelock,
    priceImpossible: priceImpossible,
    oddsCapturedAfterStart: oddsCapturedAfterStart,
    clearOddsLines: clearOddsLines,
    IMPOSSIBLE_ML: IMPOSSIBLE_ML
  };
});
