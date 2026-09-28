(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function qs() {
    var p = new URLSearchParams();
    p.set("length", $("length").value || "5");
    p.set("minGoals", $("minGoals").value || "1");
    p.set("minAssists", $("minAssists").value || "1");
    p.set("minPoints", $("minPoints").value || "1");
    p.set("minAttempts", $("minAttempts").value || "3");
    p.set("minSog", $("minSog").value || "3");
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
            "<td>" + r.name + "</td>" +
            "<td>" + r.team + "</td>" +
            "<td class='num'>" + r.length + "</td>" +
            "<td class='num'>" + r.min + "</td>" +
            "<td class='num'>" + r.total + "</td>" +
            "<td class='num'>" + r.avg + "</td>" +
            "<td>" + (r.from || "") + " → " + (r.to || "") + "</td>" +
            "<td>" + r.line + "</td>" +
            "</tr>";
        }).join("")
      : "<tr><td colspan='8' class='empty'>No players meet this streak.</td></tr>";
    return (
      "<details class='panel' open>" +
        "<summary>" + block.label + " <span class='muted'>min " + block.min +
        " × " + block.length + " games · " + rows.length + " players</span></summary>" +
        "<div class='table-wrap'>" +
          "<table>" +
            "<thead><tr>" +
              "<th>Player</th><th>Team</th><th class='num'>N</th><th class='num'>Min</th>" +
              "<th class='num'>Total</th><th class='num'>Avg</th><th>Span</th><th>Line</th>" +
            "</tr></thead>" +
            "<tbody>" + body + "</tbody>" +
          "</table>" +
        "</div>" +
      "</details>"
    );
  }

  function render(data) {
    var order = ["goals", "assists", "points", "attempts", "sog"];
    var html = order.map(function (k) {
      return data.tables && data.tables[k] ? tableHtml(data.tables[k]) : "";
    }).join("");
    $("panels").innerHTML = html || "<p class='empty'>No streak data yet.</p>";
    $("meta").textContent = (data.playerRowCount || 0) + " player-games · " +
      (data.gameCount || 0) + " boxscores";
    $("note").textContent = data.fetchedThisCall
      ? "Fetched " + data.fetchedThisCall + " new boxscores this load. Refresh to pull more."
      : "Using cached boxscores. Change filters and Apply.";
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
