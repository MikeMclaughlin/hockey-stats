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
    row.graded = true;
    row.gradedAt = new Date().toISOString();
    return row;
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
    rows.forEach(function (r) {
      if (!r.graded) return;
      graded += 1;
      if (r.correct) exact += 1;
      if (r.winnerCorrect) winner += 1;
    });
    return {
      total: total,
      graded: graded,
      pending: total - graded,
      exact: exact,
      winner: winner,
      exactPct: graded ? Math.round((exact / graded) * 1000) / 10 : null,
      winnerPct: graded ? Math.round((winner / graded) * 1000) / 10 : null
    };
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
    verdict: verdict,
    winnerOf: winnerOf,
    hasStarted: hasStarted,
    shouldRelock: shouldRelock
  };
});
