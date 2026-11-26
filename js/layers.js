/* Panel Layers: three translucent layers across the full screen.
   The curves are the ones drawn in Figma (frame 1920x1080), written as [x share of the width,
   y share of the height]. They are smoothed with smooth() (Catmull-Rom to cubic Béziers) and
   yAt(), taken unchanged from design-system/script.js.
   The back and middle layers are fixed. The front layer's top edge is the ridge: it rests on its
   Figma curve and the lamp's brightness lifts it. The newest value sits at the right edge and the
   line flows left. */
(function (SL) {
  "use strict";

  var root = document.documentElement;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var KEYS = ["back", "mid", "front"];

  /* ---------- helpers ---------- */

  function cssRaw(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function num(name, fallback) {
    var n = parseFloat(cssRaw(name));
    return isNaN(n) ? fallback : n;
  }
  function el(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /* ---------- layer shapes (from Figma) ---------- */
  var SHAPE = {
    back:  [[-0.0208, 0.163], [0.0428, 0.1427], [0.1014, 0.1239], [0.1559, 0.1073], [0.2071, 0.0936], [0.2558, 0.0833], [0.3029, 0.0771], [0.3493, 0.0757], [0.3959, 0.0797], [0.4505, 0.0899], [0.5067, 0.1023], [0.5671, 0.1157], [0.6341, 0.1289], [0.7105, 0.1405], [0.7987, 0.1493], [0.9013, 0.1542], [1.0209, 0.1537]],
    mid:   [[-0.0208, 0.5002], [0.0665, 0.4928], [0.1558, 0.4847], [0.2464, 0.4759], [0.3373, 0.4666], [0.4277, 0.4569], [0.5168, 0.4468], [0.6037, 0.4365], [0.6875, 0.4261], [0.7399, 0.4216], [0.788, 0.4216], [0.8324, 0.4253], [0.8737, 0.4319], [0.9127, 0.4407], [0.9497, 0.4508], [0.9856, 0.4617], [1.0209, 0.4724]],
    front: [[-0.0208, 0.7534], [0.0353, 0.7459], [0.0904, 0.7378], [0.1445, 0.7296], [0.1973, 0.7221], [0.2489, 0.716], [0.2993, 0.7117], [0.3483, 0.7101], [0.3959, 0.7117], [0.4414, 0.7172], [0.4847, 0.7256], [0.5266, 0.7358], [0.5677, 0.7465], [0.6089, 0.7562], [0.6507, 0.7638], [0.6941, 0.7679], [0.7396, 0.7673], [0.7803, 0.7621], [0.8173, 0.7539], [0.8515, 0.7441], [0.8841, 0.7341], [0.9163, 0.7253], [0.9491, 0.7192], [0.9836, 0.7173], [1.0209, 0.721]]
  };
  // The ridges overshoot the screen a little on both sides; extend them flat so blur never shows an edge.
  KEYS.forEach(function (k) {
    var a = SHAPE[k], first = a[0], last = a[a.length - 1];
    a.unshift([-0.1, first[1]]);
    a.push([1.1, last[1]]);
  });
  // Resting height of each layer: the mean of its curve. Damping squeezes the curve toward it.
  var LEVEL = {};
  KEYS.forEach(function (k) {
    var a = SHAPE[k]; LEVEL[k] = a.reduce(function (s, p) { return s + p[1]; }, 0) / a.length;
  });

  // Narrow screens flatten the ridges so they do not get steeper as the width shrinks.
  function damp(w) {
    var d = Math.pow(w / num("--desktop-w", 1440), num("--ridge-damp-exp", 0.6));
    return Math.min(1, Math.max(num("--ridge-damp-min", 0.4), d));
  }

  /* ---------- smooth curve: Catmull-Rom converted to cubic Béziers ---------- */

  function smooth(pts) {
    var ys = pts.map(function (p) { return p[1]; });
    var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
    function clamp(y) { return Math.max(yMin, Math.min(yMax, y)); }
    var segs = [], d = "M" + pts[0][0].toFixed(2) + "," + pts[0][1].toFixed(2);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      var c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
      var c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
      segs.push([p1, c1, c2, p2]);
      d += " C" + c1[0].toFixed(2) + "," + c1[1].toFixed(2) + " " + c2[0].toFixed(2) + "," + c2[1].toFixed(2) + " " + p2[0].toFixed(2) + "," + p2[1].toFixed(2);
    }
    return { d: d, segs: segs, first: pts[0], last: pts[pts.length - 1] };
  }

  function yAt(curve, x) {
    var segs = curve.segs;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (x >= s[0][0] && x <= s[3][0]) {
        var lo = 0, hi = 1, t = 0.5;
        for (var k = 0; k < 24; k++) {
          t = (lo + hi) / 2;
          var u = 1 - t;
          var bx = u * u * u * s[0][0] + 3 * u * u * t * s[1][0] + 3 * u * t * t * s[2][0] + t * t * t * s[3][0];
          if (bx < x) lo = t; else hi = t;
        }
        var v = 1 - t;
        return v * v * v * s[0][1] + 3 * v * v * t * s[1][1] + 3 * v * t * t * s[2][1] + t * t * t * s[3][1];
      }
    }
    return segs[0][0][1];
  }

  function bodyPath(curve, h, bleed) {
    return curve.d + " L" + curve.last[0].toFixed(2) + "," + (h + bleed) + " L" + curve.first[0].toFixed(2) + "," + (h + bleed) + " Z";
  }

  /* ---------- init ---------- */

  // box: the .layers element. sil: the .silhouette element that shares its size.
  SL.initLayers = function (box, sil, cfg, isReduced) {
    var W = 0, H = 0, dm = 1, bleed = 64;
    var front = null;                  // { body, ridge }
    var rest = null;                   // resting height of the front ridge, one value per pixel column
    var buf = [], lastT = 0, started = false;
    var lastB = -1;

    // CSS values are read once per build, never per frame: reading them forces the browser to
    // recalculate styles, which is slow while the lamp is fading and styles keep changing.
    var recAmp = 0.22;

    function layerPts(key) {
      return SHAPE[key].map(function (p) {
        return [p[0] * W, H * (LEVEL[key] + (p[1] - LEVEL[key]) * dm)];
      });
    }

    var REST_PAD = 0.15;               // the table covers a little beyond both edges
    function restY(x) {
      var f = (x + REST_PAD * W);
      var i = Math.max(0, Math.min(rest.length - 2, Math.floor(f)));
      var t = Math.max(0, Math.min(1, f - i));
      return rest[i] + (rest[i + 1] - rest[i]) * t;
    }
    // lifted ridge height at column x for brightness v
    function ridgeY(x, v) { return restY(x) - H * recAmp * v * dm; }

    /* The silhouette is cut to the area the back layer covers, so it only shows through a layer. */
    function clipSilhouette(backPts) {
      if (!sil) return;
      var inset = parseFloat(cssRaw("--silhouette-inset")) || 0;
      var c = smooth(backPts.map(function (p) { return [p[0], p[1] + inset]; }));
      var d = c.d + " L" + c.last[0].toFixed(2) + "," + (H + 1) + " L" + c.first[0].toFixed(2) + "," + (H + 1) + " Z";
      sil.style.clipPath = 'path("' + d + '")';
    }

    function build() {
      var w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      W = w; H = h; dm = damp(w); bleed = num("--layer-bleed", 64);
      recAmp = num("--record-amp", 0.22);
      box.querySelectorAll(":scope > svg").forEach(function (n) { n.remove(); });
      front = null;

      KEYS.forEach(function (key) {
        var svg = el("svg", { "class": "layer layer--" + key, viewBox: "0 0 " + w + " " + h, "aria-hidden": "true", focusable: "false" });
        var pts = layerPts(key), curve = smooth(pts);
        if (key === "back") clipSilhouette(pts);
        if (key === "front") {
          // resting ridge height for every pixel column (the live ridge is this plus the lift)
          rest = [];
          for (var x = -REST_PAD * w; x <= (1 + REST_PAD) * w + 1; x++) rest.push(yAt(curve, Math.max(pts[0][0], Math.min(pts[pts.length - 1][0], x))));
          var body = el("path", { "class": "body", d: bodyPath(curve, h, bleed) });
          var ridge = el("path", { "class": "ridge", d: curve.d });
          svg.appendChild(body); svg.appendChild(ridge);
          front = { body: body, ridge: ridge };
        } else {
          svg.appendChild(el("path", { "class": "body", d: bodyPath(curve, h, bleed) }));
        }
        box.appendChild(svg);
      });
      lastB = -1;
    }

    function setFront(pts) {
      var curve = smooth(pts);
      front.body.setAttribute("d", bodyPath(curve, H, bleed));
      front.ridge.setAttribute("d", curve.d);
    }

    // Reduced motion: no flow. A still ridge that rises with the brightness.
    function drawStill(b) {
      var pts = [], n = 24;
      for (var i = 0; i <= n; i++) { var x = (i / n) * W; pts.push([x, ridgeY(x, b)]); }
      pts.unshift([-0.1 * W, pts[0][1]]); pts.push([1.1 * W, pts[pts.length - 1][1]]);
      setFront(pts);
    }

    /* The ridge is drawn from one continuous signal so it never jumps:
       1. Every frame the brightness goes through a soft low-pass (two chained exponential
          filters), so hills come out round. It runs on real elapsed time, not on samples.
       2. The filter output is recorded on a fixed time grid. A recorded value never changes later.
       3. The right edge is the filter output right now, so the head moves every frame. */
    var f1 = 0, f2 = 0, prevNow = 0, prevOut = 0;

    function drawFlow(now, b) {
      var win = cfg.RIDGE_WINDOW_SEC * 1000, step = cfg.RIDGE_SAMPLE_MS;
      if (!started) {                  // the past before the page opened is a flat plain
        started = true; lastT = now; f1 = f2 = prevOut = b; prevNow = now;
        for (var k = Math.ceil(win / step) + 3; k >= 0; k--) buf.push({ t: now - k * step, v: b });
      }
      var dt = Math.min(now - prevNow, 1000);
      if (dt > 0) {
        var a = 1 - Math.exp(-dt / (cfg.RIDGE_SOFTEN_SEC * 1000));
        f1 += (b - f1) * a;
        f2 += (f1 - f2) * a;
      }
      if (now - lastT > win) lastT = now - step;           // back from a hidden tab
      while (lastT + step <= now) {                          // record grid points passed this frame
        lastT += step;
        var u = dt > 0 ? Math.max(0, Math.min(1, (lastT - (now - dt)) / dt)) : 1;
        buf.push({ t: lastT, v: prevOut + (f2 - prevOut) * u });
      }
      prevNow = now; prevOut = f2;
      while (buf.length > 2 && buf[1].t < now - win - 2 * step) buf.shift();

      var pts = [];
      for (var i = 0; i < buf.length; i++) {
        var x = (1 - (now - buf[i].t) / win) * W;
        if (x >= W - 0.5) continue;
        pts.push([x, ridgeY(x, buf[i].v)]);
      }
      var yNow = ridgeY(W, f2);
      if (pts.length && pts[0][0] > -0.1 * W) pts.unshift([-0.1 * W, ridgeY(-0.1 * W, 0)]);
      // beyond the right edge the line simply continues at the slope it has there (no kink at the edge)
      var prev = pts[pts.length - 1], slope = prev ? (yNow - prev[1]) / Math.max(1, W - prev[0]) : 0;
      pts.push([W, yNow], [1.1 * W, yNow + slope * 0.1 * W]);
      setFront(pts);
    }

    build();
    if ("ResizeObserver" in window) new ResizeObserver(build).observe(box);
    else window.addEventListener("resize", build);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);

    return {
      // call once per animation frame
      frame: function (now, b) {
        if (!front) return;
        if (isReduced()) {
          if (b !== lastB) { drawStill(b); lastB = b; }
        } else {
          drawFlow(now, b); lastB = b;
        }
      }
    };
  };
})(window.SL = window.SL || {});
