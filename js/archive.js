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

  /**
   * First projection for a game is frozen. Later refreshes do not rewrite it.
   */
  function freezeEstimate(store, row) {
    store = store || emptyStore();
    store.byId = store.byId || {};
    var id = String(row.id);
    var existing = store.byId[id];
    if (existing) {
      if (!existing.lockedAt) existing.lockedAt = existing.createdAt || new Date().toISOString();
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
    applyResult: applyResult,
    isFinalState: isFinalState,
    listEstimates: listEstimates,
    summarize: summarize,
    verdict: verdict,
    winnerOf: winnerOf
  };
});
