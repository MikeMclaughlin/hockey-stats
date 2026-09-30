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
            "<td>" + (r.from || "") + " → " + (r.to || "") + "</td>" +
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
    $("meta").textContent = "Loading…";
    var q = qs();
    history.replaceState(null, "", "/streaks.html?" + q);
    fetch("/api/streaks?" + q)
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (err) {
        $("meta").textContent = "Error";
        $("note").textContent = String(err.message || err);
      });
  }

  fromUrl();
  $("controls").addEventListener("submit", function (e) {
    e.preventDefault();
    load();
  });
  load();
})();
