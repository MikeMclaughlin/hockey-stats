(function () {
  "use strict";

  var data = {};
  var signedIn = false;
  var timer = null;
  var resolveReady;
  var ready = new Promise(function (resolve) { resolveReady = resolve; });
  var menuOpen = false;

  function finish() {
    if (resolveReady) resolveReady();
    resolveReady = null;
  }

  function initial(name) {
    var s = String(name || "").trim();
    return s ? s.charAt(0).toUpperCase() : "?";
  }

  function closeMenu(returnFocus) {
    var slot = document.getElementById("auth-slot");
    if (!slot) return;
    var btn = slot.querySelector(".user-menu-btn");
    var panel = slot.querySelector(".user-menu-panel");
    menuOpen = false;
    if (panel) panel.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (returnFocus && btn) btn.focus();
  }

  function openMenu(focusItem) {
    var slot = document.getElementById("auth-slot");
    if (!slot) return;
    var btn = slot.querySelector(".user-menu-btn");
    var panel = slot.querySelector(".user-menu-panel");
    menuOpen = true;
    if (panel) panel.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "true");
    if (focusItem) {
      var item = slot.querySelector(".user-menu-item");
      if (item) item.focus();
    }
  }

  function paintAuth(me) {
    var slot = document.getElementById("auth-slot");
    if (!slot) return;
    if (!me || me.enabled === false) {
      slot.classList.add("auth-off");
      slot.innerHTML = "";
      return;
    }
    slot.classList.remove("auth-off");
    if (!(me.user && me.user.name)) {
      slot.innerHTML = '<a class="auth-btn" href="/api/auth/login">Sign in</a>';
      return;
    }
    var name = String(me.user.name);
    slot.innerHTML =
      '<div class="user-menu">' +
        '<button type="button" class="user-menu-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu-panel">' +
          '<span class="user-initial" aria-hidden="true"></span>' +
          '<span class="user-menu-name"></span>' +
        "</button>" +
        '<div id="user-menu-panel" class="user-menu-panel" role="menu" hidden>' +
          (me.admin ? '<p class="user-menu-status" role="presentation">Admin</p>' : "") +
          '<a class="user-menu-item" role="menuitem" href="/api/auth/logout">Sign out</a>' +
        "</div>" +
      "</div>";
    slot.querySelector(".user-initial").textContent = initial(name);
    slot.querySelector(".user-menu-name").textContent = name;
    var btn = slot.querySelector(".user-menu-btn");
    btn.setAttribute("aria-label", "Account menu for " + name);
    btn.addEventListener("click", function () {
      if (menuOpen) closeMenu(false);
      else openMenu(false);
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        openMenu(true);
      } else if (e.key === "Escape") {
        closeMenu(true);
      }
    });
    var item = slot.querySelector(".user-menu-item");
    if (item) {
      item.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeMenu(true);
        }
      });
    }
  }

  document.addEventListener("click", function (e) {
    if (!menuOpen) return;
    var slot = document.getElementById("auth-slot");
    if (slot && slot.contains(e.target)) return;
    closeMenu(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menuOpen) closeMenu(true);
  });

  function save() {
    if (!signedIn) return;
    fetch("/api/prefs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }).catch(function () {});
  }

  function patch(section, partial) {
    var cur = data[section] && typeof data[section] === "object" ? data[section] : {};
    var next = {};
    Object.keys(cur).forEach(function (k) { next[k] = cur[k]; });
    Object.keys(partial || {}).forEach(function (k) { next[k] = partial[k]; });
    data[section] = next;
    if (!signedIn) return;
    clearTimeout(timer);
    timer = setTimeout(save, 250);
  }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (me) {
      paintAuth(me);
      signedIn = !!(me && me.enabled && me.user);
      if (!signedIn) return null;
      return fetch("/api/prefs", { credentials: "same-origin" }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      });
    })
    .then(function (body) {
      if (body && body.prefs && typeof body.prefs === "object") data = body.prefs;
    })
    .catch(function () {})
    .then(finish);

  window.HockeyPrefs = {
    ready: ready,
    signedIn: function () { return signedIn; },
    section: function (name) {
      var value = data[name];
      return value && typeof value === "object" ? value : null;
    },
    patch: patch
  };
})();
