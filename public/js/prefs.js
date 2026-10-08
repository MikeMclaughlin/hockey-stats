(function () {
  "use strict";

  var data = {};
  var signedIn = false;
  var timer = null;
  var resolveReady;
  var ready = new Promise(function (resolve) { resolveReady = resolve; });

  function finish() {
    if (resolveReady) resolveReady();
    resolveReady = null;
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
    if (me.user && me.user.name) {
      slot.innerHTML = '<span class="auth-name"></span><a class="auth-btn" href="/api/auth/logout">Sign out</a>';
      slot.querySelector(".auth-name").textContent = me.user.name;
    }
  }

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
