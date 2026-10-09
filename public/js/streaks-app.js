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
            "<td>" + (window.HockeyDates ? HockeyDates.formatTableDate(r.from) : (r.from || "")) +
              " → " + (window.HockeyDates ? HockeyDates.formatTableDate(r.to) : (r.to || "")) + "</td>" +
            "<td>" + r.line + (r.incomplete ? " (incomplete)" : "") + "</td>" +
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

  function load() {
    var panels = $("panels");
    var first = !panels || !panels.children.length;
    if (first) $("meta").textContent = "Loading…";
    if (window.HockeyLoading) HockeyLoading.show();
    var q = qs();
    history.replaceState(null, "", "/streaks.html?" + q);
    fetch("/api/streaks?" + q)
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (err) {
        $("meta").textContent = "Error";
        $("note").textContent = String(err.message || err);
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
