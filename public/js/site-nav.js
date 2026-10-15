(function () {
  "use strict";
  var page = document.body.getAttribute("data-page") || "";

  function link(href, id, label) {
    var current = page === id ? ' aria-current="page"' : "";
    return '<a href="' + href + '"' + current + ">" + label + "</a>";
  }

  document.write(
    '<div class="toolbar-row nav-links">' +
      '<nav class="nav" aria-label="Pages">' +
        link("/", "matchups", "Matchups") +
        link("/teams.html", "teams", "Team Stats") +
        link("/streaks.html", "streaks", "Player Streaks") +
        link("/scorers.html", "scorers", "Scorers") +
        link("/review.html", "review", "Review") +
        link("/backtest.html", "backtest", "Backtest") +
      "</nav>" +
      '<span class="app-version" title="App version">v2.0.1</span>' +
      '<div class="auth-slot" id="auth-slot"><a class="auth-btn" href="/api/auth/login">Sign in</a></div>' +
    "</div>"
  );
})();
