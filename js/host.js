/* Host page: reads the Arduino over Web Serial and tells the server when the lamp's state changes.
   ?sim   plays a fake Arduino instead of a serial port (no hardware needed)
   ?mock  use the in-browser mock server even if Supabase keys are set
   ?warmup=N  (with ?sim) shorten the 30 s warm-up to N seconds, for tests
   ?off       (with ?sim) the switch is off at boot: the Arduino prints no state line */
(function (SL) {
  "use strict";

  var cfg = SL.config;
  var q = new URLSearchParams(location.search);
  if (q.get("hb")) cfg.HEARTBEAT_MS = +q.get("hb");     // ?hb=1000: heartbeat every second (tests)
  var SIM = q.has("sim");
  var WARMUP_MS = 30000;   // the Arduino ignores its sensor for 30 s after it boots

  /* ---------- serial text -> lines -> meaning ---------- */

  // Serial data arrives in arbitrary chunks, sometimes in the middle of a line.
  // Collect the text and hand back only complete lines.
  function LineBuffer() { this.rest = ""; }
  LineBuffer.prototype.push = function (chunk) {
    var text = this.rest + chunk, parts = text.split(/\r\n|\n|\r/);
    this.rest = parts.pop();                  // the unfinished tail waits for the next chunk
    return parts;
  };

  // Only "-> STATE" lines are states. "PIR:", "state=...", etc. are ignored on purpose.
  function parseLine(line) {
    var t = String(line).trim(), m;
    if ((m = /^->\s*(IDLE|ACTIVE|RETURNING|OFF)$/.exec(t))) return { type: "state", state: m[1] };
    if (/^start$/i.test(t)) return { type: "start" };
    if (/^warmup done$/i.test(t)) return { type: "warmup-done" };
    return { type: "other" };
  }
  SL.hostParse = { LineBuffer: LineBuffer, parseLine: parseLine };   // for tests

  /* ---------- page ---------- */

  var $ = function (id) { return document.getElementById(id); };
  var el = { connect: $("connect"), mode: $("mode"), conn: $("v-conn"), warm: $("v-warm"), state: $("v-state"),
             server: $("v-server"), beat: $("v-beat"), log: $("log"), warn: $("warn"), browser: $("browser-note") };
  var logLines = [], backend = null, warmEnd = 0, warmTimer = null, connected = false, beatTimer = null, lastBeat = 0;
  var writeCount = 0, lastWriteError = "";

  function clock(t) { var d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return String(n).padStart(2, "0"); }).join(":"); }
  function warn(msg) { el.warn.hidden = !msg; el.warn.textContent = msg || ""; }

  function pushLog(line) {
    logLines.unshift(clock(Date.now()) + "  " + line);
    logLines.length = Math.min(logLines.length, 10);
    el.log.innerHTML = "";
    logLines.forEach(function (l) { var li = document.createElement("li"); li.textContent = l; el.log.appendChild(li); });
  }

  function setConn(text) { el.conn.textContent = text; }

  function renderWarm() {
    if (!warmEnd) { el.warm.textContent = connected ? "Waiting for the Arduino to say start…" : "—"; return; }
    var left = warmEnd - Date.now();
    if (left > 0) { el.warm.textContent = "Warming up… " + Math.ceil(left / 1000) + " s (motion is ignored)"; }
    else { el.warm.textContent = "Done (counted down; waiting for “warmup done”)"; }
  }
  function startWarmup() {
    warmEnd = Date.now() + WARMUP_MS; clearInterval(warmTimer);
    warmTimer = setInterval(renderWarm, 250); renderWarm();
  }
  function warmupDone() {
    clearInterval(warmTimer); warmEnd = 0; el.warm.textContent = "Done — motion is detected now";
  }

  function renderServer() {
    var kind = backend ? backend.kind : "—";
    el.server.textContent = kind + (writeCount ? " · " + writeCount + " state change" + (writeCount > 1 ? "s" : "") + " sent" : "") + (lastWriteError ? " · error: " + lastWriteError : "");
  }

  function sendState(state) {
    el.state.textContent = state;
    if (!backend) return;
    backend.setState(state).then(function (wrote) {
      if (wrote) writeCount++;
      lastWriteError = ""; renderServer(); warn("");
    }).catch(function (e) {
      lastWriteError = (e && e.message) || String(e); renderServer();
      warn("Could not reach the server. The lamp still works; viewers just will not see changes. (" + lastWriteError + ")");
    });
  }

  // The Arduino counts OFF as its starting state and prints "-> ..." only when the state changes.
  // Switch on at boot: "-> IDLE" follows "start". Switch off at boot: nothing is printed, so if no state
  // line has come by the end of the warm-up, the lamp is OFF.
  var sawStateSinceStart = false;

  function onLine(line) {
    if (!line.trim()) return;
    pushLog(line);
    var p = parseLine(line);
    if (p.type === "start") { sawStateSinceStart = false; startWarmup(); }
    else if (p.type === "warmup-done") { warmupDone(); if (!sawStateSinceStart) sendState("OFF"); }
    else if (p.type === "state") { sawStateSinceStart = true; sendState(p.state); }
  }

  function heartbeat() {
    if (!backend) return;
    backend.heartbeat().then(function () { lastBeat = Date.now(); el.beat.textContent = clock(lastBeat); })
      .catch(function (e) { el.beat.textContent = "failed (" + ((e && e.message) || e) + ")"; });
  }
  // The heartbeat is timed in a Worker: Chrome slows the timers of a tab that is hidden or minimised
  // (to about once a minute after 5 minutes), which would make the site call the lamp "away".
  var beatWorker = null;
  function stopHeartbeat() {
    clearInterval(beatTimer);
    if (beatWorker) { beatWorker.terminate(); beatWorker = null; }
  }
  function startHeartbeat() {
    stopHeartbeat(); heartbeat();
    try {
      var src = "setInterval(function(){postMessage(1)}," + (+cfg.HEARTBEAT_MS || 20000) + ")";
      beatWorker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      beatWorker.onmessage = heartbeat;
    } catch (e) { beatTimer = setInterval(heartbeat, cfg.HEARTBEAT_MS); }
  }

  // Keep the laptop screen awake while connected (a sleeping laptop stops everything). Best effort.
  var wakeLock = null;
  function keepAwake() {
    if (!("wakeLock" in navigator)) return;
    navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; l.addEventListener("release", function () { wakeLock = null; }); }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () { if (connected && !wakeLock && document.visibilityState === "visible") keepAwake(); });

  function onConnected(label) {
    connected = true; setConn(label); el.connect.disabled = true; warmEnd = 0; renderWarm();
    if (backend) { backend.cleanup(cfg.EVENT_KEEP_DAYS).catch(function () {}); }
    startHeartbeat(); keepAwake();
  }
  function onDisconnected(why) {
    connected = false; setConn("Disconnected" + (why ? " — " + why : "")); el.connect.disabled = false;
    el.connect.textContent = "Connect again"; clearInterval(warmTimer); warmEnd = 0; el.warm.textContent = "—";
    stopHeartbeat();                   // no heartbeat: viewers will see "The light is away" after a minute
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    warn("The serial connection was lost. Check the USB cable, then press “Connect again”. The Arduino restarts when you reconnect, so wait for the 30 s warm-up.");
  }

  /* ---------- Web Serial ---------- */

  var port = null, reader = null;

  async function connectSerial() {
    warn("");
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
    } catch (e) {
      if (e && e.name === "NotFoundError") return;          // the picker was closed
      warn("Could not open the port: " + ((e && e.message) || e)); return;
    }
    onConnected("Connected (9600 baud)");
    pushLog("— connected —");
    readLoop();
  }

  async function readLoop() {
    var buf = new LineBuffer(), decoder = new TextDecoder();
    try {
      while (port && port.readable) {
        reader = port.readable.getReader();
        try {
          for (;;) {
            var r = await reader.read();
            if (r.done) break;
            buf.push(decoder.decode(r.value, { stream: true })).forEach(onLine);
            // push() returned lines already; nothing else to do with the rest
          }
        } finally { reader.releaseLock(); }
      }
    } catch (e) { /* cable pulled: read() throws */ }
    try { await port.close(); } catch (e) {}
    onDisconnected("port closed");
  }

  if (!SIM && "serial" in navigator) {
    navigator.serial.addEventListener("disconnect", function () { /* readLoop ends by itself and reports it */ });
  }

  /* ---------- simulator: a fake Arduino that prints the same lines ---------- */

  function runSimulator() {
    var warm = (parseFloat(q.get("warmup")) || 30) * 1000;
    WARMUP_MS = warm;
    var t0 = Date.now(), level = cfg.LEVEL_IDLE, state = "IDLE", pir = 0;
    var cycle = [                               // after warm-up, forever: ACTIVE 8 s, quiet 3 s, RETURNING 3 s, IDLE 6 s
      { at: 0, lines: ["PIR: 1", "-> ACTIVE"], state: "ACTIVE", pir: 1 },
      { at: 8000, lines: ["PIR: 0"], pir: 0 },
      { at: 11000, lines: ["-> RETURNING"], state: "RETURNING" },
      { at: 14000, lines: ["-> IDLE"], state: "IDLE" }
    ], period = 20000;

    function emit(lines) { lines.forEach(onLine); }
    var SWITCH_OFF = q.has("off");            // ?off: the switch is off at boot, so no state line is ever printed
    emit(SWITCH_OFF ? ["start"] : ["start", "-> IDLE"]);
    var fade = { from: level, to: level, t: 0, dur: 0 };
    function target(s) { return s === "ACTIVE" ? cfg.LEVEL_ACTIVE : cfg.LEVEL_IDLE; }
    function levelNow(now) {
      if (!fade.dur) return fade.to;
      var x = Math.max(0, Math.min(1, (now - fade.t) / fade.dur)); return fade.from + (fade.to - fade.from) * x * x * (3 - 2 * x);
    }
    function apply(step, now) {
      if (step.state) {
        level = levelNow(now); state = step.state;
        fade = { from: level, to: target(state), t: now, dur: cfg.FADE_FULL_MS * Math.abs(target(state) - level) / (cfg.LEVEL_ACTIVE - cfg.LEVEL_IDLE) };
      }
      if (step.pir !== undefined) pir = step.pir;
      emit(step.lines);
    }

    setTimeout(function () {
      emit(["warmup done"]);
      if (SWITCH_OFF) { state = "OFF"; level = 0; setInterval(function () { emit(["state=OFF  pir=0  level=0"]); }, 500); return; }
      var base = Date.now(), done = {};
      setInterval(function () {                 // runs the schedule
        var now = Date.now(), k = Math.floor((now - base) / period), within = (now - base) % period;
        cycle.forEach(function (st, i) { var key = k + ":" + i; if (!done[key] && within >= st.at) { done[key] = 1; apply(st, now); } });
      }, 50);
      setInterval(function () {                 // the Arduino prints its status twice a second
        emit(["state=" + state + "  pir=" + pir + "  level=" + Math.round(levelNow(Date.now()))]);
      }, 500);
    }, warm);
  }

  /* ---------- start ---------- */

  function init() {
    if (!SIM && !("serial" in navigator)) {
      el.browser.hidden = false; el.connect.disabled = true; setConn("Not supported in this browser");
    }
    SL.createBackend(cfg).then(function (be) {
      backend = be; SL.backend = be; renderServer();
      el.mode.textContent = (SIM ? "simulator · " : "") + (be.kind === "mock" ? "mock server (this browser only)" : "Supabase");
      if (SIM) { el.connect.hidden = true; onConnected("Simulated Arduino"); runSimulator(); }
    }).catch(function (e) { warn("Server setup failed: " + ((e && e.message) || e)); });
    el.connect.addEventListener("click", connectSerial);
    renderServer(); renderWarm();
  }
  init();
})(window.SL = window.SL || {});
