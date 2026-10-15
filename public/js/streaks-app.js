(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function qs() {
    var p = new URLSearchParams();
    if ($("length").value) p.set("length", $("length").value);
    p.set("minGoals", $("minGoals").value || "1");
    p.set("minAssists", $("minAssists").value || "1");
    p.set("minPoints", $("minPoints").value || "1");
    p.set("minAttempts", $("minAttempts").value || "3");
    p.set("minSog", $("minSog").value || "3");
    p.set("minGoalieSv", ($("minGoalieSv") && $("minGoalieSv").value) || "90");
    if ($("activeOnly") && $("activeOnly").checked) p.set("activeOnly", "1");
    return p.toString();
  }

  function fromUrl() {
    var u = new URLSearchParams(location.search);
    ["length", "minGoals", "minAssists", "minPoints", "minAttempts", "minSog"].forEach(function (k) {
      if (u.get(k) && $(k)) $(k).value = u.get(k);
    });
  }

  function dateText(value) {
    if (window.HockeyDates) return HockeyDates.formatTableDate(value);
    return value || "";
  }

  function lineChart(row) {
    var games = row.games;
    if (!games || !games.length) {
      var parts = String(row.line || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      games = parts.map(function (value) { return { value: value, date: "" }; });
    }
    if (!games.length) return "";
    var values = games.map(function (g) { return Number(g.value); }).map(function (n) { return isFinite(n) ? n : 0; });
    var peak = Math.max.apply(null, values.concat([1]));
    var yMax = Math.max(1, Math.ceil(peak - 1e-9));
    var ticks = [];
    if (yMax <= 6) {
      for (var t = 0; t <= yMax; t++) ticks.push(t);
    } else {
      ticks = [0, Math.round(yMax / 2), yMax];
    }
    var barSlot = 28;
    var padL = 22;
    var padT = 6;
    var plotH = 78;
    var width = padL + 8 + games.length * barSlot;
    var height = padT + plotH;
    var barW = 18;
    var parts = [];
    parts.push("<svg class='streak-svg' width='" + width + "' height='" + height + "' viewBox='0 0 " + width + " " + height + "' role='img' aria-label='Games " + values.join(", ") + "'>");
    ticks.forEach(function (tick) {
      var y = padT + plotH - (tick / yMax) * plotH;
      parts.push("<text class='streak-tick' x='16' y='" + (y + 3) + "' text-anchor='end'>" + tick + "</text>");
      parts.push("<line class='streak-grid' x1='" + padL + "' y1='" + y + "' x2='" + (width - 4) + "' y2='" + y + "'></line>");
    });
    games.forEach(function (g, i) {
      var value = values[i];
      var h = Math.max(0, (value / yMax) * plotH);
      var x = padL + i * barSlot + (barSlot - barW) / 2;
      var y = padT + plotH - h;
      parts.push("<rect class='streak-bar' x='" + x + "' y='" + y + "' width='" + barW + "' height='" + h + "' rx='2'></rect>");
      var label = String(g.value);
      var inside = h >= 14;
      var ty = inside ? y + h / 2 + 4 : Math.max(10, y - 3);
      parts.push("<text class='streak-val" + (inside ? " in" : "") + "' x='" + (x + barW / 2) + "' y='" + ty + "' text-anchor='middle'>" + label + "</text>");
    });
    parts.push("</svg>");
    var from = games[0].date || row.from;
    var to = games[games.length - 1].date || row.to;
    var range = dateText(from) + " → " + dateText(to);
    return "<div class='streak-chart'>" + parts.join("") + "<div class='streak-range'>" + range + "</div></div>";
  }

  function tableHtml(block) {
    var rows = block.rows || [];
    var body = rows.length
      ? rows.map(function (r) {
          return "<tr>" +
            "<td><a href='" + (r.nhlUrl || "#") + "' target='_blank' rel='noopener'>" + r.name + "</a></td>" +
            "<td>" + (r.sweater ? "#" + r.sweater + " " : "") + (r.position || "") + "</td>" +
            "<td>" + r.team + "</td>" +
            "<td class='num'>" + r.length + "</td>" +
            "<td class='num'>" + r.min + "</td>" +
            "<td class='num'>" + r.total + "</td>" +
            "<td class='num'>" + r.avg + "</td>" +
            "<td>" + dateText(r.from) + " → " + dateText(r.to) + "</td>" +
            "<td class='line-cell'>" + lineChart(r) + "</td>" +
            "</tr>";
        }).join("")
      : "<tr><td colspan='9' class='empty'>" + (block.emptyHint || "No players meet this streak.") + "</td></tr>";
    return (
      "<details class='panel' open>" +
        "<summary>" + block.label + " <span class='muted'>min " + block.min +
        " × " + block.length + " games · " + rows.length + " players</span></summary>" +
        "<div class='table-wrap'>" +
          "<table>" +
            "<thead><tr>" +
              "<th>Player</th><th>Pos</th><th>Team</th><th class='num'>N</th><th class='num'>Min</th>" +
              "<th class='num'>Total</th><th class='num'>Avg</th><th>Span</th><th>Line</th>" +
            "</tr></thead>" +
            "<tbody>" + body + "</tbody>" +
          "</table>" +
        "</div>" +
      "</details>"
    );
  }

  function render(data) {
    var order = ["goals", "assists", "points", "attempts", "sog", "goalieSv"];
    var hint = data.emptyHint || "No players meet this streak.";
    var html = order.map(function (k) {
      if (!data.tables || !data.tables[k]) return "";
      data.tables[k].emptyHint = hint;
      return tableHtml(data.tables[k]);
    }).join("");
    var any = order.some(function (k) {
      return data.tables && data.tables[k] && data.tables[k].rows && data.tables[k].rows.length;
    });
    $("panels").innerHTML = html || "<p class='empty'>" + hint + "</p>";
    if ($("length") && data.length != null && (!$("length").value || data.softened)) {
      $("length").value = String(data.length);
    }
    $("meta").textContent = (data.playerRowCount || 0) + " player-games · " +
      (data.gameCount || 0) + " boxscores" +
      (data.statsSeasonLabel ? " · stats " + data.statsSeasonLabel : "") +
      (data.scoreboardSeasonLabel ? " · scoreboard " + data.scoreboardSeasonLabel : "") +
      (data.earlySeason ? " · early season" : "");
    var note = "Boxscores through cache" +
      (data.fetchedThisCall ? " · fetched " + data.fetchedThisCall + " new this load" : " · using cache") +
      " · " + (data.playerRowCount || 0) + " player-games.";
    if (data.seasonNote) note += " " + data.seasonNote;
    if (data.softened) {
      note += " Streak length softened from " + data.lengthRequested + " to " + data.length +
        " because most players have fewer than five games.";
    }
    if (!any && hint) note += " " + hint;
    $("note").textContent = note;
  }

  function readStreaks(r) {
    return r.json().then(function (body) {
      if (!r.ok || (body && body.error)) {
        throw new Error((body && body.error) || ("HTTP " + r.status));
      }
      return body;
    }, function () {
      throw new Error(r.ok ? "Invalid response" : ("HTTP " + r.status));
    });
  }

  function load() {
    var panels = $("panels");
    var first = !panels || !panels.children.length;
    if (first) $("meta").textContent = "Loading…";
    if (window.HockeyLoading) HockeyLoading.show();
    var q = qs();
    history.replaceState(null, "", "/streaks.html?" + q);
    fetch("/api/streaks?" + q)
      .then(readStreaks)
      .then(render)
      .catch(function (err) {
        var message = (err && err.message) || String(err);
        $("meta").textContent = "Error";
        $("note").textContent = message;
        if (first && panels) {
          panels.textContent = "";
          var p = document.createElement("p");
          p.className = "empty";
          p.textContent = message;
          panels.appendChild(p);
        }
      })
      .then(function () {
        if (window.HockeyLoading) HockeyLoading.hide();
      });
  }

  function saveStreakPrefs() {
    if (!window.HockeyPrefs || !HockeyPrefs.signedIn()) return;
    HockeyPrefs.patch("streaks", {
      length: $("length") ? $("length").value : "",
      minGoals: $("minGoals").value,
      minAssists: $("minAssists").value,
      minPoints: $("minPoints").value,
      minAttempts: $("minAttempts").value,
      minSog: $("minSog").value,
      minGoalieSv: $("minGoalieSv") ? $("minGoalieSv").value : "",
      activeOnly: !!($("activeOnly") && $("activeOnly").checked)
    });
  }

  function applyStreakPrefs() {
    var saved = window.HockeyPrefs && HockeyPrefs.signedIn() && HockeyPrefs.section("streaks");
    if (!saved || location.search) return;
    ["length", "minGoals", "minAssists", "minPoints", "minAttempts", "minSog", "minGoalieSv"].forEach(function (k) {
      if (saved[k] != null && $(k)) $(k).value = saved[k];
    });
    if ($("activeOnly")) $("activeOnly").checked = !!saved.activeOnly;
  }

  function startStreaks() {
    fromUrl();
    applyStreakPrefs();
    load();
  }

  $("controls").addEventListener("submit", function (e) {
    e.preventDefault();
    saveStreakPrefs();
    load();
  });
  if (window.HockeyPrefs) HockeyPrefs.ready.then(startStreaks);
  else startStreaks();
})();
