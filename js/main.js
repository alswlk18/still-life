/* Wiring. ?test: keys drive the lamp, nothing touches a server. Otherwise the lamp follows the server
   (Supabase, or the in-browser mock). */
(function (SL) {
  "use strict";

  var cfg = SL.config;
  var params = new URLSearchParams(location.search);
  var testMode = params.has("test");
  if (params.get("away")) cfg.AWAY_AFTER_MS = +params.get("away");   // ?away=4000: call it away after 4 s (tests)
  var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  function reduced() { return mq.matches; }

  var lamp = SL.createLamp(cfg, reduced);
  var layers = SL.initLayers(document.querySelector("[data-layers]"), document.querySelector(".silhouette"), cfg, reduced);
  var applyTones = SL.initTones(document.querySelector(".scene"), document.getElementById("status"));
  var silhouette = SL.initSilhouette(document.querySelector(".silhouette"), cfg);
  var status = SL.initStatus(document.getElementById("status"));
  var sheet = SL.initSheet(document.getElementById("open-about"), document.getElementById("about"));

  SL.lamp = lamp;   // handy for tests and the console
  lamp.onChange(function (s) { if (s === "ACTIVE") silhouette.pick(); });

  /* ---------- test mode (F8): nothing is read from or written to a server ---------- */
  if (testMode) {
    status.set("here");
    var returnTimer = null, held = false, away = false;

    function now() { return performance.now(); }
    function isSpace(e) { return e.code === "Space" || e.key === " "; }

    document.addEventListener("keydown", function (e) {
      if (sheet.isOpen()) return;
      if (isSpace(e)) {
        e.preventDefault();
        if (e.repeat || held || lamp.getState() === "OFF") return;
        held = true;
        clearTimeout(returnTimer);
        lamp.setState("ACTIVE", now());
      } else if (e.key === "o" || e.key === "O") {      // switch off / on
        clearTimeout(returnTimer); held = false;
        if (lamp.getState() === "OFF") { lamp.setState("IDLE", now()); status.set(away ? "away" : "here"); }
        else { lamp.setState("OFF", now()); status.set("resting"); }
      } else if (e.key === "x" || e.key === "X") {      // host connection lost / back
        away = !away;
        status.set(away ? "away" : lamp.getState() === "OFF" ? "resting" : "here");
      }
    });
    document.addEventListener("keyup", function (e) {
      if (!isSpace(e)) return;
      e.preventDefault();
      if (!held) return;
      held = false;
      clearTimeout(returnTimer);
      returnTimer = setTimeout(function () {
        if (lamp.getState() === "ACTIVE") lamp.setState("RETURNING", now());
      }, cfg.RETURN_DELAY_MS);
    });

    console.info("[Still, Life] test mode — Space: hold = ACTIVE, release = RETURNING after 3s · O: lamp off/on · X: host away/back");
  } else {
    status.set("away");   // until the first status arrives
    startLive();
  }

  /* ---------- live mode: follow the lamp through the server (F1, F4) ----------
     The server only says WHICH state the lamp is in. The brightness is moved here, with the same fade
     as the Arduino (lamp.js), so nothing needs to be streamed. */
  function startLive() {
    var be = null, last = null, joined = false;

    function connectionOf(st) {
      if (!st || !st.seenAt) return "away";
      if (be.serverNow() - st.seenAt > cfg.AWAY_AFTER_MS) return "away";
      return st.state === "OFF" ? "resting" : "here";
    }

    function update() {
      if (!be) return;
      var now = performance.now(), conn = connectionOf(last);
      status.set(conn);

      if (!joined) {                                  // first status: start from where the lamp is now
        joined = true;
        if (conn === "away" || !last) lamp.jumpTo("IDLE", 0, now);
        else lamp.jumpTo(last.state, Math.max(0, be.serverNow() - last.changedAt), now);
        return;
      }
      var cur = lamp.getState();
      if (conn === "away") {                          // no host: settle back to calm
        if (cur === "ACTIVE") lamp.setState("RETURNING", now);
        else if (cur === "OFF") lamp.setState("IDLE", now);
      } else if (last && last.state !== cur) {
        lamp.setState(last.state, now);
      }
    }

    function refresh() {
      return be.getStatus().then(function (st) { last = st; update(); }).catch(function () {});
    }

    SL.createBackend(cfg).then(function (backend) {
      be = backend; SL.backend = backend;
      be.subscribe(function (msg) { if (msg.kind === "status" && msg.status) { last = msg.status; update(); } });
      return refresh();
    }).then(function () {
      setInterval(update, 1000);                      // freshness changes with time, not only with messages
      setInterval(refresh, cfg.POLL_MS);              // in case a realtime message was missed
      document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    }).catch(function (e) { console.warn("[Still, Life] server unavailable:", e); });
  }

  /* ---------- frame loop ---------- */
  function tick(t) {
    var b = lamp.brightness(t);
    applyTones(b);
    layers.frame(t, b);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})(window.SL = window.SL || {});
