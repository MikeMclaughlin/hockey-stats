(function () {
  "use strict";

  var COLORS = [
    "#1b4f8a", "#8a1b2b", "#0e7a4a", "#8a5a00", "#5b3a8c",
    "#0b6e7a", "#a33b16", "#3d5a1f", "#9a3d6a", "#2f4858",
    "#b86e00", "#1f4e3d", "#6b2d5b", "#3a4a8a", "#7a2e2e"
  ];
  var state = {
    payload: null,
    stat: "goals",
    tables: {
      goals: { sortKey: "goals", sortDir: -1 },
      points: { sortKey: "points", sortDir: -1 }
    }
  };

  function $(id) { return document.getElementById(id); }

  function showLoading() {
    if (window.HockeyLoading) HockeyLoading.show();
  }

  function hideLoading() {
    if (window.HockeyLoading) HockeyLoading.hide();
  }

  function cumulative(seq) {
    var out = [];
    var sum = 0;
    (seq || []).forEach(function (n) {
      sum += Number(n) || 0;
      out.push(sum);
    });
    return out;
  }

  function topSeries(players, stat) {
    var key = stat === "points" ? "points" : "goals";
    var sorted = (players || []).slice().sort(function (a, b) {
      if (b[key] !== a[key]) return b[key] - a[key];
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    if (!sorted.length) return [];
    var cutoff = sorted.length >= 10 ? sorted[9][key] : sorted[sorted.length - 1][key];
    var out = [];
    for (var i = 0; i < sorted.length && out.length < 15; i++) {
      if (out.length >= 10 && sorted[i][key] < cutoff) break;
      out.push(sorted[i]);
    }
    return out;
  }

  function cmpVal(row, key, seqKey) {
    if (key.indexOf("g") === 0 && /^g\d+$/.test(key)) {
      var idx = Number(key.slice(1)) - 1;
      var seq = row[seqKey] || [];
      if (idx >= seq.length) return null;
      return seq[idx];
    }
    if (key === "ppg") {
      var pts = Number(row.points);
      var gp = Number(row.gp);
      if (!isFinite(pts) || !gp) return gp ? 0 : null;
      return pts / gp;
    }
    if (key === "name" || key === "team") return String(row[key] || "");
    var n = Number(row[key]);
    return isFinite(n) ? n : null;
  }

  function compareRows(a, b, sort, seqKey, totalKey, rateKey) {
    function one(key, dir) {
      var av = cmpVal(a, key, seqKey);
      var bv = cmpVal(b, key, seqKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        var as = String(av);
        var bs = String(bv);
        if (as < bs) return -1 * dir;
        if (as > bs) return 1 * dir;
        return 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    }
    var c = one(sort.sortKey, sort.sortDir);
    if (c) return c;
    if (sort.sortKey !== totalKey) {
      c = one(totalKey, -1);
      if (c) return c;
    }
    if (sort.sortKey !== rateKey) {
      c = one(rateKey, -1);
      if (c) return c;
    }
    return one("name", 1);
  }

  function drawChart() {
    var svg = $("chart");
    if (!svg) return;
    var players = (state.payload && state.payload.players) || [];
    var series = topSeries(players, state.stat);
    var width = Math.max(320, (svg.parentNode && svg.parentNode.clientWidth) || 640);
    var height = width < 520 ? 250 : 300;
    var pad = { l: 36, r: 12, t: 14, b: 28 };
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    var seqKey = state.stat === "points" ? "pointsByGame" : "goalsByGame";
    var totalKey = state.stat === "points" ? "points" : "goals";
    var prepared = series.map(function (p, i) {
      return {
        name: p.name,
        team: p.team,
        total: p[totalKey],
        cum: cumulative(p[seqKey]),
        color: COLORS[i % COLORS.length]
      };
    });
    var maxG = 1;
    var maxY = 1;
    prepared.forEach(function (p) {
      if (p.cum.length > maxG) maxG = p.cum.length;
      p.cum.forEach(function (y) { if (y > maxY) maxY = y; });
    });
    function xTrue(game) {
      var span = Math.max(1, maxG - 1);
      return pad.l + ((game - 1) / span) * (width - pad.l - pad.r);
    }
    function xAt(game, index) {
      var n = prepared.length || 1;
      var jitter = n <= 1 ? 0 : ((index / (n - 1)) - 0.5) * 8;
      var x = xTrue(game) + jitter;
      var left = pad.l;
      var right = width - pad.r;
      if (x < left) x = left;
      if (x > right) x = right;
      return x;
    }
    function yAt(y) {
      return pad.t + (1 - y / maxY) * (height - pad.t - pad.b);
    }
    var parts = [];
    parts.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#fff"></rect>');
    var yStep = maxY <= 12 ? 1 : Math.ceil(maxY / 8);
    for (var y = 0; y <= maxY; y += yStep) {
      var yy = yAt(y);
      parts.push('<line x1="' + pad.l + '" y1="' + yy + '" x2="' + (width - pad.r) + '" y2="' + yy + '" stroke="#e3ebf3"></line>');
      parts.push('<text x="' + (pad.l - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="12" fill="#5a6d80">' + y + "</text>");
    }
    var xStep = maxG <= 16 ? 1 : Math.ceil(maxG / 10);
    for (var g = 1; g <= maxG; g += xStep) {
      var xx = xTrue(g);
      parts.push('<text x="' + xx + '" y="' + (height - 8) + '" text-anchor="middle" font-size="12" fill="#5a6d80">' + g + "</text>");
    }
    var plotW = width - pad.l - pad.r;
    var plotH = height - pad.t - pad.b;
    parts.push('<clipPath id="scorer-plot"><rect x="' + pad.l + '" y="' + pad.t + '" width="' + plotW + '" height="' + plotH + '"></rect></clipPath>');
    parts.push('<g clip-path="url(#scorer-plot)">');
    prepared.forEach(function (p, index) {
      if (!p.cum.length) return;
      var d = p.cum.map(function (y, i) {
        return (i ? "L" : "M") + xAt(i + 1, index).toFixed(1) + " " + yAt(y).toFixed(1);
      }).join(" ");
      parts.push('<path d="' + d + '" fill="none" stroke="' + p.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>');
    });
    parts.push("</g>");
    svg.innerHTML = parts.join("");
    var legend = $("legend");
    if (legend) {
      legend.innerHTML = prepared.map(function (p) {
        return '<li><span class="swatch" style="background:' + p.color + '"></span>' +
          '<span class="who"></span> <span class="tot"></span></li>';
      }).join("");
      var items = legend.querySelectorAll("li");
      prepared.forEach(function (p, i) {
        var who = items[i].querySelector(".who");
        var tot = items[i].querySelector(".tot");
        who.textContent = p.name + (p.team ? " · " + p.team : "");
        tot.textContent = String(p.total);
      });
    }
  }

  function cell(value, played) {
    if (!played) return "<td class='num g-blank'></td>";
    if (value > 0) return "<td class='num g-score'>" + value + "</td>";
    return "<td class='num g-zero'>0</td>";
  }

  function renderStatTable(kind) {
    var spec = kind === "points"
      ? {
          kind: "points",
          headId: "points-head",
          bodyId: "points-body",
          seqKey: "pointsByGame",
          totalKey: "points",
          rateKey: "ppg",
          rateLabel: "Points per game",
          totalTitle: "Total points. Click to sort.",
          rateTitle: "Points per game. Click to sort.",
          gameTitle: function (n) { return "Points in game " + n + ", from the player's first game. Click to sort."; },
          keep: function (p) { return (Number(p.points) || 0) >= 1; },
          total: function (p) { return p.points; },
          rate: function (p) { return p.gp ? (p.points / p.gp).toFixed(2) : "0.00"; }
        }
      : {
          kind: "goals",
          headId: "scorer-head",
          bodyId: "scorer-body",
          seqKey: "goalsByGame",
          totalKey: "goals",
          rateKey: "gpg",
          rateLabel: "Goals per game",
          totalTitle: "Total goals. Click to sort.",
          rateTitle: "Goals per game. Click to sort.",
          gameTitle: function (n) { return "Goals in game " + n + ", from the player's first game. Click to sort."; },
          keep: function (p) { return (Number(p.goals) || 0) >= 1; },
          total: function (p) { return p.goals; },
          rate: function (p) { return p.gp ? (p.goals / p.gp).toFixed(2) : "0.00"; }
        };
    var sort = state.tables[spec.kind];
    var payload = state.payload || {};
    var players = (payload.players || []).filter(spec.keep).slice().sort(function (a, b) {
      return compareRows(a, b, sort, spec.seqKey, spec.totalKey, spec.rateKey);
    });
    var maxGames = 0;
    players.forEach(function (p) {
      var seq = p[spec.seqKey] || [];
      if (seq.length > maxGames) maxGames = seq.length;
      if ((Number(p.gp) || 0) > maxGames) maxGames = Number(p.gp) || 0;
    });
    var head = $(spec.headId);
    var body = $(spec.bodyId);
    if (!head || !body) return;
    var cols = ["<th data-key='name' class='sticky'>Player</th>", "<th data-key='team'>Team</th>", "<th data-key='gp' class='num'>GP</th>"];
    for (var g = 1; g <= maxGames; g++) cols.push("<th data-key='g" + g + "' class='num'>G" + g + "</th>");
    cols.push("<th data-key='" + spec.totalKey + "' class='num'>Total</th>");
    cols.push("<th data-key='" + spec.rateKey + "' class='num'>" + spec.rateLabel + "</th>");
    head.innerHTML = "<tr>" + cols.join("") + "</tr>";
    head.querySelectorAll("th[data-key]").forEach(function (th) {
      var key = th.getAttribute("data-key");
      var text = "Click to sort.";
      if (key === "name") text = "Player name. Click to sort.";
      else if (key === "team") text = "Team abbreviation. Click to sort.";
      else if (key === "gp") text = "Games played. Click to sort.";
      else if (key === spec.totalKey) text = spec.totalTitle;
      else if (key === spec.rateKey) text = spec.rateTitle;
      else if (key && key.charAt(0) === "g") text = spec.gameTitle(key.slice(1));
      th.setAttribute("title", text);
      th.setAttribute("aria-label", text);
    });
    body.innerHTML = players.map(function (p) {
      var seq = p[spec.seqKey] || [];
      var games = "";
      for (var i = 0; i < maxGames; i++) games += cell(seq[i] || 0, i < seq.length);
      return "<tr><td class='sticky'></td><td class='scorer-team'></td><td class='num'>" + (p.gp || 0) + "</td>" +
        games + "<td class='num'>" + spec.total(p) + "</td><td class='num'>" + spec.rate(p) + "</td></tr>";
    }).join("");
    var rows = body.querySelectorAll("tr");
    players.forEach(function (p, i) {
      rows[i].querySelector(".sticky").textContent = p.name;
      rows[i].querySelector(".scorer-team").textContent = p.team || "";
    });
    head.querySelectorAll("th").forEach(function (th) {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.getAttribute("data-key") === sort.sortKey) {
        th.classList.add(sort.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-key");
        if (sort.sortKey === key) sort.sortDir *= -1;
        else {
          sort.sortKey = key;
          sort.sortDir = (key === "name" || key === "team") ? 1 : -1;
        }
        renderStatTable(spec.kind);
      });
    });
  }

  function renderTable() {
    renderStatTable("goals");
    renderStatTable("points");
  }

  function render(payload) {
    var next = payload || { players: [] };
    var nextCount = (next.players || []).length;
    var prevCount = state.payload && state.payload.players ? state.payload.players.length : 0;
    if (!nextCount && prevCount) {
      var metaKeep = $("meta");
      if (metaKeep) metaKeep.textContent = "Refresh returned no scorers. Showing the previous tables.";
      return;
    }
    state.payload = next;
    var meta = $("meta");
    var when = state.payload.generatedAt && window.HockeyDates
      ? HockeyDates.formatTableDate(state.payload.generatedAt)
      : "";
    if (meta) {
      meta.textContent = (state.payload.playerCount || 0) + " scorers" +
        (state.payload.seasonLabel ? " · " + state.payload.seasonLabel + " regular season" : "") +
        (when ? " · " + when : "");
    }
    var note = $("note");
    if (note) {
      var text = "Game number is each player’s own game log, earliest date first. A blank cell is a game not played. 0 is a game played without a goal in the goals table, or without a point in the points table.";
      if (state.payload.totalsMatchLeaders === false) {
        text += " Some totals differ from the NHL leaders list.";
      }
      note.textContent = text;
    }
    var chartStat = $("chart-stat");
    if (chartStat) chartStat.value = state.stat;
    drawChart();
    renderTable();
  }

  function fail(err) {
    var message = String(err && err.message ? err.message : err);
    var meta = $("meta");
    if (state.payload) {
      if (meta) meta.textContent = "Refresh failed. Showing the previous tables. " + message;
      return;
    }
    if (meta) meta.textContent = "Could not load scorers";
    var note = $("note");
    if (note) note.textContent = message;
    ["scorer-body", "points-body"].forEach(function (id) {
      var body = $(id);
      if (body && !body.children.length) {
        body.innerHTML = "<tr><td class='empty' colspan='6'>" + message + "</td></tr>";
      }
    });
  }

  function load() {
    var first = !state.payload;
    if (first) {
      var meta = $("meta");
      if (meta) meta.textContent = "Loading…";
    }
    showLoading();
    fetch("/api/scorers")
      .then(function (r) { return r.json().then(function (body) {
        if (!r.ok || body.error) throw new Error(body.error || ("HTTP " + r.status));
        return body;
      }); })
      .then(render)
      .catch(fail)
      .then(hideLoading);
  }

  var chartStat = $("chart-stat");
  if (chartStat) {
    chartStat.addEventListener("change", function () {
      state.stat = chartStat.value === "points" ? "points" : "goals";
      if (state.payload) drawChart();
    });
  }
  window.addEventListener("resize", function () {
    if (state.payload) drawChart();
  });
  load();
})();
