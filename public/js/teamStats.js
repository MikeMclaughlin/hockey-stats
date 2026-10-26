(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HockeyTeamStats = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function lastPeriodType(g) {
    return (g.gameOutcome && g.gameOutcome.lastPeriodType) ||
      (g.periodDescriptor && g.periodDescriptor.periodType) ||
      "REG";
  }

  function last5Form(games, abbrev, opts) {
    opts = opts || {};
    var types = opts.types || [1, 2];
    var venue = opts.venue || null;
    var used = [];
    (games || []).slice().reverse().forEach(function (g) {
      if (used.length >= 5) return;
      var st = String(g.gameState || "").toUpperCase();
      if (st !== "OFF" && st !== "FINAL" && st.indexOf("FINAL") !== 0) return;
      if (g.gameType && types.indexOf(Number(g.gameType)) === -1) return;
      var away = g.awayTeam || {};
      var home = g.homeTeam || {};
      var isAway = away.abbrev === abbrev;
      var isHome = home.abbrev === abbrev;
      if (!isAway && !isHome) return;
      if (venue === "home" && !isHome) return;
      if (venue === "away" && !isAway) return;
      var as = Number(away.score);
      var hs = Number(home.score);
      if (!isFinite(as) || !isFinite(hs)) return;
      var gf = isHome ? hs : as;
      var ga = isHome ? as : hs;
      var result = "W";
      if (gf < ga) {
        var pt = String(lastPeriodType(g) || "REG").toUpperCase();
        result = (pt === "OT" || pt === "SO") ? "OT" : "L";
      }
      used.push({
        id: g.id,
        gf: gf,
        ga: ga,
        result: result,
        date: g.gameDate,
        gameType: g.gameType,
        opponent: isHome ? away.abbrev : home.abbrev,
        venue: isHome ? "home" : "away",
        score: gf + "–" + ga
      });
    });
    var w = 0, l = 0, ot = 0, gf = 0, ga = 0;
    used.forEach(function (g) {
      if (g.result === "W") w += 1;
      else if (g.result === "OT") ot += 1;
      else l += 1;
      gf += g.gf;
      ga += g.ga;
    });
    var n = used.length || 0;
    return {
      games: n,
      w: w,
      l: l,
      ot: ot,
      gf: gf,
      ga: ga,
      gfGp: n ? Math.round((gf / n) * 100) / 100 : null,
      gaGp: n ? Math.round((ga / n) * 100) / 100 : null,
      list: used
    };
  }

  function numOrNull(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /**
   * Wins/losses/OTL must come from the same season as the shot summary.
   * Live standings (often 0-0-0 before the new season) are ignored when
   * their seasonId does not match the summary season.
   */
  function recordFromSources(stand, summary) {
    stand = stand || {};
    summary = summary || {};
    var standSeason = numOrNull(stand.seasonId);
    var sumSeason = numOrNull(summary.seasonId);
    var seasonsDiffer = standSeason != null && sumSeason != null && standSeason !== sumSeason;
    var sumHas = summary.wins != null || summary.losses != null || summary.otLosses != null ||
      Number(summary.gamesPlayed) > 0;
    var useSummary = (seasonsDiffer && sumHas) ||
      ((stand.wins == null && stand.losses == null) && sumHas);
    var src = useSummary ? summary : stand;
    var wins = src.wins != null ? Number(src.wins) : 0;
    var losses = src.losses != null ? Number(src.losses) : 0;
    var otl = src.otLosses != null ? Number(src.otLosses) : (src.otl != null ? Number(src.otl) : 0);
    var gf = src.goalFor != null ? Number(src.goalFor) : (src.goalsFor != null ? Number(src.goalsFor) : null);
    var ga = src.goalAgainst != null ? Number(src.goalAgainst) : (src.goalsAgainst != null ? Number(src.goalsAgainst) : null);
    var goalDiff = src.goalDifferential != null ? Number(src.goalDifferential) : (gf != null && ga != null ? gf - ga : null);
    var ptsPct = src.pointPct != null ? Number(src.pointPct) : (src.pointPctg != null ? Number(src.pointPctg) : null);
    var gamesPlayed = src.gamesPlayed != null ? Number(src.gamesPlayed) : (wins + losses + otl);
    if (!gamesPlayed) {
      return {
        wins: 0,
        losses: 0,
        otl: 0,
        goalDiff: null,
        ptsPct: null,
        goalsFor: null,
        goalsAgainst: null,
        gamesPlayed: 0,
        source: useSummary ? "summary" : "standings",
        seasonId: useSummary ? sumSeason : standSeason
      };
    }
    return {
      wins: wins,
      losses: losses,
      otl: otl,
      goalDiff: goalDiff,
      ptsPct: ptsPct,
      goalsFor: gf,
      goalsAgainst: ga,
      gamesPlayed: gamesPlayed,
      source: useSummary ? "summary" : "standings",
      seasonId: useSummary ? sumSeason : standSeason
    };
  }

  function row(team, stand, summary, form) {
    stand = stand || {};
    summary = summary || {};
    form = form || { games: 0, w: 0, l: 0, ot: 0, gfGp: null, gaGp: null };
    var rec = recordFromSources(stand, summary);
    var gp = rec.gamesPlayed || stand.gamesPlayed || summary.gamesPlayed || 0;
    var sog = summary.shotsForPerGame;
    var soga = summary.shotsAgainstPerGame;
    if (sog == null && summary.shotsFor != null && gp) sog = summary.shotsFor / gp;
    if (soga == null && summary.shotsAgainst != null && gp) soga = summary.shotsAgainst / gp;
    var ptsPct = rec.ptsPct;
    if (ptsPct == null && gp) {
      ptsPct = Math.round((((rec.wins * 2) + rec.otl) / (gp * 2)) * 1000) / 1000;
    }
    return {
      abbrev: team.abbrev,
      name: team.name,
      wins: rec.wins,
      losses: rec.losses,
      otl: rec.otl,
      sogGp: sog != null ? Math.round(Number(sog) * 10) / 10 : null,
      sogaGp: soga != null ? Math.round(Number(soga) * 10) / 10 : null,
      l5w: form.w,
      l5l: form.l,
      l5ot: form.ot,
      l5gfGp: form.gfGp,
      l5gaGp: form.gaGp,
      l5pdo: form.l5pdo != null ? form.l5pdo : last5Pdo(form.list || []),
      ptsPct: ptsPct,
      goalDiff: rec.goalDiff,
      pdo: seasonPdo(rec, summary),
      b2bWinPct: null,
      b2bRecord: null,
      b2bGames: 0,
      preseason: {},
      lastFive: form.list || []
    };
  }

  function pdoFromShots(gf, ga, sf, sa) {
    if (!sf || !sa || !isFinite(sf) || !isFinite(sa)) return null;
    var sh = (Number(gf) || 0) / sf;
    var sv = 1 - (Number(ga) || 0) / sa;
    return Math.round((sh + sv) * 1000) / 10;
  }

  function savePct(ga, sa) {
    if (!sa || !isFinite(sa)) return null;
    return Math.round(100 * (sa - (Number(ga) || 0)) / sa * 10) / 10;
  }

  function seasonPdo(rec, summary) {
    rec = rec || {};
    summary = summary || {};
    var gp = rec.gamesPlayed || 0;
    if (!gp || rec.goalsFor == null || rec.goalsAgainst == null) return null;
    var sf = summary.shotsForPerGame != null ? Number(summary.shotsForPerGame) * gp : null;
    var sa = summary.shotsAgainstPerGame != null ? Number(summary.shotsAgainstPerGame) * gp : null;
    return pdoFromShots(rec.goalsFor, rec.goalsAgainst, sf, sa);
  }

  function last5Pdo(list) {
    var rows = list || [];
    if (!rows.length) return null;
    var gf = 0, ga = 0, sf = 0, sa = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].sf == null || rows[i].sa == null || !rows[i].sf || !rows[i].sa) return null;
      gf += Number(rows[i].gf) || 0;
      ga += Number(rows[i].ga) || 0;
      sf += Number(rows[i].sf);
      sa += Number(rows[i].sa);
    }
    return pdoFromShots(gf, ga, sf, sa);
  }

  function last5SavePct(list) {
    var rows = list || [];
    if (!rows.length) return null;
    var ga = 0, sa = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].sa == null || !rows[i].sa) return null;
      ga += Number(rows[i].ga) || 0;
      sa += Number(rows[i].sa);
    }
    return savePct(ga, sa);
  }

  function finishedGames(games, abbrev, gameType) {
    var out = [];
    (games || []).forEach(function (g) {
      if (!g) return;
      var st = String(g.gameState || "").toUpperCase();
      if (st !== "OFF" && st !== "FINAL" && st.indexOf("FINAL") !== 0) return;
      if (gameType != null && Number(g.gameType) !== Number(gameType)) return;
      var away = g.awayTeam || {};
      var home = g.homeTeam || {};
      var isAway = away.abbrev === abbrev;
      var isHome = home.abbrev === abbrev;
      if (!isAway && !isHome) return;
      var as = Number(away.score);
      var hs = Number(home.score);
      if (!isFinite(as) || !isFinite(hs)) return;
      var gf = isHome ? hs : as;
      var ga = isHome ? as : hs;
      var pt = String(lastPeriodType(g) || "REG").toUpperCase();
      var result = "W";
      if (gf < ga) result = (pt === "OT" || pt === "SO") ? "OT" : "L";
      else if (gf === ga) result = "T";
      out.push({
        id: g.id,
        date: g.gameDate,
        gameType: Number(g.gameType),
        venue: isHome ? "home" : "away",
        gf: gf,
        ga: ga,
        result: result,
        opponent: isHome ? away.abbrev : home.abbrev
      });
    });
    out.sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
    return out;
  }

  function attachShots(list, shotById) {
    return (list || []).map(function (g) {
      var copy = {
        id: g.id,
        date: g.date,
        gameType: g.gameType,
        venue: g.venue,
        gf: g.gf,
        ga: g.ga,
        result: g.result,
        opponent: g.opponent,
        sf: g.sf,
        sa: g.sa
      };
      var shots = shotById && shotById[String(g.id)];
      if (shots) {
        var sf = g.venue === "home" ? Number(shots.home) : Number(shots.away);
        var sa = g.venue === "home" ? Number(shots.away) : Number(shots.home);
        if (isFinite(sf) && isFinite(sa)) {
          copy.sf = sf;
          copy.sa = sa;
        }
      }
      return copy;
    });
  }

  function annotateShots(form, shotById) {
    (form && form.list || []).forEach(function (g) {
      var shots = shotById && shotById[String(g.id)];
      if (!shots) return;
      var sf = g.venue === "home" ? Number(shots.home) : Number(shots.away);
      var sa = g.venue === "home" ? Number(shots.away) : Number(shots.home);
      if (isFinite(sf) && isFinite(sa)) {
        g.sf = sf;
        g.sa = sa;
      }
    });
    if (form) form.l5pdo = last5Pdo(form.list || []);
    return form;
  }

  function totalsFromGames(list) {
    var w = 0, l = 0, ot = 0, gf = 0, ga = 0, sf = 0, sa = 0, shotGames = 0;
    (list || []).forEach(function (g) {
      if (g.result === "W") w += 1;
      else if (g.result === "OT") ot += 1;
      else l += 1;
      gf += Number(g.gf) || 0;
      ga += Number(g.ga) || 0;
      if (g.sf != null && g.sa != null && isFinite(g.sf) && isFinite(g.sa) && g.sf > 0 && g.sa > 0) {
        sf += g.sf;
        sa += g.sa;
        shotGames += 1;
      }
    });
    var n = (list || []).length;
    var complete = n > 0 && shotGames === n;
    return {
      games: n,
      wins: w,
      losses: l,
      otl: ot,
      gf: gf,
      ga: ga,
      sf: complete ? sf : null,
      sa: complete ? sa : null,
      lastDate: n ? list[n - 1].date : null
    };
  }

  function b2bFromGames(games, abbrev) {
    var list = finishedGames(games, abbrev, 2);
    var wins = 0;
    var n = 0;
    for (var i = 1; i < list.length; i++) {
      var prev = Date.parse(String(list[i - 1].date || "").slice(0, 10) + "T00:00:00Z");
      var cur = Date.parse(String(list[i].date || "").slice(0, 10) + "T00:00:00Z");
      if (!isFinite(prev) || !isFinite(cur)) continue;
      if (Math.round((cur - prev) / 86400000) !== 1) continue;
      n += 1;
      if (list[i].result === "W") wins += 1;
    }
    if (!n) return { b2bWinPct: null, b2bWins: 0, b2bGames: 0, b2bRecord: null };
    return {
      b2bWinPct: Math.round((100 * wins / n) * 10) / 10,
      b2bWins: wins,
      b2bGames: n,
      b2bRecord: wins + "–" + (n - wins)
    };
  }

  /**
   * Fill stats that have no regular-season sample with finished preseason
   * games. Regular-season values already on the row are left alone.
   * Venue splits only replace an empty last-five; season record stays put.
   */
  function applyPreseason(row, games, abbrev, shotById, venue) {
    var flags = Object.assign({}, row.preseason || {});
    var recGp = (Number(row.wins) || 0) + (Number(row.losses) || 0) + (Number(row.otl) || 0);
    if (!venue && !recGp) {
      var preAll = attachShots(finishedGames(games, abbrev, 1), shotById);
      var tot = totalsFromGames(preAll);
      if (tot.games > 0) {
        row.wins = tot.wins;
        row.losses = tot.losses;
        row.otl = tot.otl;
        row.goalDiff = tot.gf - tot.ga;
        row.ptsPct = Math.round((((tot.wins * 2) + tot.otl) / (tot.games * 2)) * 1000) / 1000;
        flags.record = true;
        flags.ptsPct = true;
        flags.goalDiff = true;
        if (tot.sf != null && tot.sa != null) {
          row.sogGp = Math.round((tot.sf / tot.games) * 10) / 10;
          row.sogaGp = Math.round((tot.sa / tot.games) * 10) / 10;
          row.pdo = pdoFromShots(tot.gf, tot.ga, tot.sf, tot.sa);
          flags.sog = true;
          if (row.pdo != null) flags.pdo = true;
        }
      }
    }
    var formGames = (Number(row.l5w) || 0) + (Number(row.l5l) || 0) + (Number(row.l5ot) || 0);
    if (!formGames) {
      var preForm = last5Form(games, abbrev, { types: [1], venue: venue || null });
      annotateShots(preForm, shotById);
      if (preForm.games) {
        row.l5w = preForm.w;
        row.l5l = preForm.l;
        row.l5ot = preForm.ot;
        row.l5gfGp = preForm.gfGp;
        row.l5gaGp = preForm.gaGp;
        row.lastFive = preForm.list;
        row.l5pdo = preForm.l5pdo;
        flags.last5 = true;
        if (row.l5pdo != null) flags.l5pdo = true;
      }
    }
    row.preseason = flags;
    return row;
  }

  return {
    last5Form: last5Form,
    row: row,
    recordFromSources: recordFromSources,
    pdoFromShots: pdoFromShots,
    seasonPdo: seasonPdo,
    last5Pdo: last5Pdo,
    last5SavePct: last5SavePct,
    finishedGames: finishedGames,
    attachShots: attachShots,
    annotateShots: annotateShots,
    totalsFromGames: totalsFromGames,
    b2bFromGames: b2bFromGames,
    applyPreseason: applyPreseason
  };
});
