/* UI pieces: state tones, silhouette picker, status note, "Who are you?" sheet. */
(function (SL) {
  "use strict";

  var root = document.documentElement;
  function cssRaw(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }

  /* ---------- tones: brightness 0..1 -> Dormant -> Sensing -> Awake (silhouette and note) ---------- */

  function hex(c) {
    c = c.replace("#", "");
    return [0, 2, 4].map(function (i) { return parseInt(c.substr(i, 2), 16); });
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // value at b, where the three token values sit at b = 0, 0.5, 1
  function pick(b, a0, a1, a2) {
    return b <= 0.5 ? lerp(a0, a1, b * 2) : lerp(a1, a2, (b - 0.5) * 2);
  }
  function pickRgb(b, c0, c1, c2) {
    return "rgb(" + [0, 1, 2].map(function (i) { return Math.round(pick(b, c0[i], c1[i], c2[i])); }).join(",") + ")";
  }

  // scene: holds the layers and the silhouette. note: the status text. Setting the values only on
  // these keeps the browser from recalculating styles for the whole page on every frame.
  SL.initTones = function (scene, note) {
    var t = {
      opacity: ["dormant", "sensing", "awake"].map(function (s) { return parseFloat(cssRaw("--silhouette-opacity-" + s)); }),
      scale: parseFloat(cssRaw("--silhouette-scale-sensing")) || 1,
      note: ["--text-faint", "--text-muted", "--text"].map(function (n) { return hex(cssRaw(n)); })
    };
    var last = -1;
    return function (b) {
      b = Math.round(b * 1000) / 1000;
      if (b === last) return;
      last = b;
      var k = Math.max(0, (b - 0.5) * 2);          // 0 up to Sensing, then 0..1 up to Awake
      var s = scene.style;
      s.setProperty("--silhouette-opacity", (Math.round(pick(b, t.opacity[0], t.opacity[1], t.opacity[2]) * 1000) / 1000).toString());
      s.setProperty("--sil-scale", (t.scale + (1 - t.scale) * k).toFixed(4));   // Sensing size -> Awake size
      s.setProperty("--sil-drop", (1 - k).toFixed(4));                          // Sensing sits lower, Awake higher
      note.style.setProperty("--note-tone", pickRgb(b, t.note[0], t.note[1], t.note[2]));
    };
  };

  /* ---------- silhouettes ----------
     Files live in assets/silhouettes/ and are listed in silhouettes.json ({"items": ["a.png", "b.webm"]}).
     Image and video share the same slot. With an empty list the smudge stays. */

  SL.initSilhouette = function (el, cfg) {
    var fig = el.querySelector(".silhouette__fig");
    var items = [], last = -1;
    var ready = fetch(cfg.SILHOUETTE_LIST)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && Array.isArray(j.items)) items = j.items; })
      .catch(function () {});

    function clear() {
      el.classList.remove("is-image", "is-video");
      el.style.removeProperty("--silhouette-src");
      fig.querySelectorAll("video").forEach(function (v) { v.remove(); });
    }

    function choose() {
      if (!items.length) return;
      var i;
      do { i = Math.floor(Math.random() * items.length); } while (items.length > 1 && i === last);
      last = i;
      // absolute address: a url() inside a CSS variable is resolved against the stylesheet, not the page
      var src = new URL("assets/silhouettes/" + items[i], document.baseURI).href;
      clear();
      if (/\.(mp4|webm)$/i.test(src)) {
        var v = document.createElement("video");
        v.src = src; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
        fig.appendChild(v); el.classList.add("is-video");
        v.play().catch(function () {});
      } else {
        el.style.setProperty("--silhouette-src", 'url("' + src + '")');
        el.classList.add("is-image");
      }
    }

    return {
      // call on every ACTIVE; never the same one twice in a row. Waits for the list if it has not loaded yet.
      pick: function () { ready.then(choose); }
    };
  };

  /* ---------- status note (F4) ---------- */

  var STATUS_TEXT = {
    here: "The light is here",
    resting: "The light is resting",
    away: "The light is away"
  };

  SL.initStatus = function (el) {
    var cur = null;
    return {
      set: function (key) {
        if (key === cur || !STATUS_TEXT[key]) return;
        cur = key;
        el.textContent = STATUS_TEXT[key];
        el.setAttribute("data-status", key);
      },
      // later: setDetail("Last movement 3 minutes ago") can share the same spot
      get: function () { return cur; }
    };
  };

  /* ---------- "Who are you?" sheet (F5) ---------- */

  SL.initSheet = function (openBtn, sheetRoot) {
    var closeBtn = sheetRoot.querySelector("[data-sheet-close]");
    var backdrop = sheetRoot.querySelector(".sheet__backdrop");
    var panel = sheetRoot.querySelector(".sheet");
    var isOpen = false, lastFocus = null;

    function setInert(v) { if (v) sheetRoot.setAttribute("inert", ""); else sheetRoot.removeAttribute("inert"); }

    function open() {
      if (isOpen) return;
      isOpen = true; lastFocus = document.activeElement;
      setInert(false);
      sheetRoot.classList.add("is-open");
      openBtn.setAttribute("aria-expanded", "true");
      panel.scrollTop = 0;
      closeBtn.focus({ preventScroll: true });
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      sheetRoot.classList.remove("is-open");
      openBtn.setAttribute("aria-expanded", "false");
      setInert(true);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }

    setInert(true);
    openBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) { e.preventDefault(); close(); }
    });

    return { isOpen: function () { return isOpen; } };
  };
})(window.SL = window.SL || {});
