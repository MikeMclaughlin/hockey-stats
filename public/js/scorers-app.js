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
    sortKey: "goals",
    sortDir: -1
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

  function cmpVal(row, key) {
    if (key.indexOf("g") === 0 && /^g\d+$/.test(key)) {
      var idx = Number(key.slice(1)) - 1;
      var seq = row.goalsByGame || [];
      if (idx >= seq.length) return null;
      return seq[idx];
    }
    if (key === "name" || key === "team") return String(row[key] || "");
    var n = Number(row[key]);
    return isFinite(n) ? n : null;
  }

  function compare(a, b) {
    function one(key, dir) {
      var av = cmpVal(a, key);
      var bv = cmpVal(b, key);
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
    var c = one(state.sortKey, state.sortDir);
    if (c) return c;
    if (state.sortKey !== "goals") {
      c = one("goals", -1);
      if (c) return c;
    }
    if (state.sortKey !== "gpg") {
      c = one("gpg", -1);
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
    function xAt(game, index) {
      var n = prepared.length || 1;
      var jitter = (index - (n - 1) / 2) * 0.14;
      var x = game + jitter;
      var span = Math.max(1, maxG - 1);
      return pad.l + ((x - 1) / span) * (width - pad.l - pad.r);
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
      var xx = xAt(g, (prepared.length - 1) / 2);
      parts.push('<text x="' + xx + '" y="' + (height - 8) + '" text-anchor="middle" font-size="12" fill="#5a6d80">' + g + "</text>");
    }
    prepared.forEach(function (p, index) {
      if (!p.cum.length) return;
      var d = p.cum.map(function (y, i) {
        return (i ? "L" : "M") + xAt(i + 1, index).toFixed(1) + " " + yAt(y).toFixed(1);
      }).join(" ");
      parts.push('<path d="' + d + '" fill="none" stroke="' + p.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>');
    });
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

  function renderTable() {
    var payload = state.payload || {};
    var players = (payload.players || []).slice().sort(compare);
    var maxGames = payload.maxGames || 0;
    var head = $("scorer-head");
    var body = $("scorer-body");
    if (!head || !body) return;
    var cols = ["<th data-key='name' class='sticky'>Player</th>", "<th data-key='team'>Team</th>", "<th data-key='gp' class='num'>GP</th>"];
    for (var g = 1; g <= maxGames; g++) cols.push("<th data-key='g" + g + "' class='num'>G" + g + "</th>");
    cols.push("<th data-key='goals' class='num'>Total</th>");
    cols.push("<th data-key='gpg' class='num'>Goals per game</th>");
    head.innerHTML = "<tr>" + cols.join("") + "</tr>";
    body.innerHTML = players.map(function (p) {
      var seq = p.goalsByGame || [];
      var games = "";
      for (var i = 0; i < maxGames; i++) games += cell(seq[i] || 0, i < seq.length);
      var gpg = p.gp ? (p.goals / p.gp).toFixed(2) : "0.00";
      return "<tr><td class='sticky'></td><td class='team'></td><td class='num'>" + (p.gp || 0) + "</td>" +
        games + "<td class='num'>" + p.goals + "</td><td class='num'>" + gpg + "</td></tr>";
    }).join("");
    var rows = body.querySelectorAll("tr");
    players.forEach(function (p, i) {
      rows[i].querySelector(".sticky").textContent = p.name;
      rows[i].querySelector(".team").textContent = p.team || "";
    });
    head.querySelectorAll("th").forEach(function (th) {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.getAttribute("data-key") === state.sortKey) {
        th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-key");
        if (state.sortKey === key) state.sortDir *= -1;
        else {
          state.sortKey = key;
          state.sortDir = (key === "name" || key === "team") ? 1 : -1;
        }
        renderTable();
      });
    });
  }

  function render(payload) {
    state.payload = payload || { players: [] };
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
      var text = "Game number is each player’s own game log, earliest date first. A blank cell is a game not played. 0 is a game played without a goal.";
      if (state.payload.totalsMatchLeaders === false) {
        text += " Some totals differ from the NHL leaders list.";
      }
      note.textContent = text;
    }
    document.querySelectorAll(".stat-toggle button").forEach(function (btn) {
      var on = btn.getAttribute("data-stat") === state.stat;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-on", on);
    });
    drawChart();
    renderTable();
  }

  function fail(err) {
    var meta = $("meta");
    if (meta) meta.textContent = "Could not load scorers";
    var note = $("note");
    if (note) note.textContent = String(err && err.message ? err.message : err);
    if (!state.payload) {
      var body = $("scorer-body");
      if (body && !body.children.length) {
        body.innerHTML = "<tr><td class='empty' colspan='6'>" + String(err && err.message ? err.message : err) + "</td></tr>";
      }
    }
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

  document.querySelectorAll(".stat-toggle button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.stat = btn.getAttribute("data-stat") === "points" ? "points" : "goals";
      if (state.payload) render(state.payload);
    });
  });
  window.addEventListener("resize", function () {
    if (state.payload) drawChart();
  });
  load();
})();
