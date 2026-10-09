(function () {
  "use strict";

  function host() {
    return document.querySelector("main");
  }

  function cover() {
    var main = host();
    if (!main) return null;
    var el = main.querySelector(":scope > .load-cover");
    if (el) return el;
    el = document.createElement("div");
    el.className = "load-cover";
    el.hidden = true;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = '<div class="load-spinner" aria-hidden="true"></div><span class="visually-hidden">Loading</span>';
    main.appendChild(el);
    return el;
  }

  function show() {
    var el = cover();
    if (el) el.hidden = false;
  }

  function hide() {
    var main = host();
    if (!main) return;
    var el = main.querySelector(":scope > .load-cover");
    if (el) el.hidden = true;
  }

  window.HockeyLoading = { show: show, hide: hide };
})();
