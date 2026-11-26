/* Lamp model: follows the Arduino's fade so the page brightens and dims with the light.
   level is the lamp's 0-255 brightness; brightness() maps 50..200 to 0..1 for the page. */
(function (SL) {
  "use strict";

  SL.createLamp = function (cfg, isReduced) {
    var state = "IDLE", from = cfg.LEVEL_IDLE, to = cfg.LEVEL_IDLE, t0 = 0, dur = 0;
    var listeners = [];

    function clamp01(x) { return Math.max(0, Math.min(1, x)); }

    function levelAt(now) {
      if (dur <= 0) return to;
      var t = clamp01((now - t0) / dur);
      var s = t * t * (3 - 2 * t);               // smoothstep
      return from + (to - from) * s;
    }

    // IDLE / ACTIVE / RETURNING / OFF — a new state continues from the current level.
    function setState(next, now) {
      if (next === state) return;
      var cur = levelAt(now);
      var target = next === "ACTIVE" ? cfg.LEVEL_ACTIVE : next === "OFF" ? 0 : cfg.LEVEL_IDLE;
      var span = cfg.LEVEL_ACTIVE - cfg.LEVEL_IDLE;
      dur = next === "OFF" ? cfg.OFF_FADE_MS : cfg.FADE_FULL_MS * Math.abs(target - cur) / span;
      if (isReduced()) dur *= 0.1;               // reduced motion: much shorter fade
      from = cur; to = target; t0 = now; state = next;
      listeners.forEach(function (fn) { fn(next); });
    }

    // Join late: act as if `next` began elapsedMs ago from the level it usually starts at.
    // (ACTIVE and OFF start from IDLE, RETURNING starts from ACTIVE.) Used for the first status after loading.
    function jumpTo(next, elapsedMs, now) {
      var span = cfg.LEVEL_ACTIVE - cfg.LEVEL_IDLE;
      from = next === "RETURNING" ? cfg.LEVEL_ACTIVE : cfg.LEVEL_IDLE;
      to = next === "ACTIVE" ? cfg.LEVEL_ACTIVE : next === "OFF" ? 0 : cfg.LEVEL_IDLE;
      dur = next === "OFF" ? cfg.OFF_FADE_MS : cfg.FADE_FULL_MS * Math.abs(to - from) / span;
      if (isReduced()) dur *= 0.1;
      t0 = now - Math.max(0, elapsedMs || 0);
      state = next;
      listeners.forEach(function (fn) { fn(next); });
    }

    return {
      setState: setState,
      jumpTo: jumpTo,
      getState: function () { return state; },
      level: levelAt,
      brightness: function (now) {
        return clamp01((levelAt(now) - cfg.LEVEL_IDLE) / (cfg.LEVEL_ACTIVE - cfg.LEVEL_IDLE));
      },
      onChange: function (fn) { listeners.push(fn); }
    };
  };
})(window.SL = window.SL || {});
