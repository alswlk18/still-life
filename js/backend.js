/* Server access for both pages (index.html and host.html). Everything else talks only to this file.

   Two implementations of one interface:
   - Supabase: used when SUPABASE_URL and SUPABASE_ANON_KEY are set in config.js
   - Mock:     used when they are empty or the address has ?mock. Tabs of the same browser talk to each
               other through BroadcastChannel and localStorage, so the whole chain can be tried without a server.

   const be = await SL.createBackend(SL.config);
   be.kind                      "supabase" | "mock"
   be.setState(state)           host: record a state change (only if it differs from the previous one)
   be.heartbeat()               host: "I am still here" (refreshes seen_at)
   be.getStatus()               -> { state, changedAt, seenAt } (ms since epoch, server clock) or null
   be.subscribe(callback)       callback({ kind: "status", status }) / callback({ kind: "event", event }); returns unsubscribe
   be.cleanup()                 host: delete lamp_events older than EVENT_KEEP_DAYS
   be.serverNow()               "now" on the server's clock, so a phone with a wrong clock still judges freshness correctly
*/
(function (SL) {
  "use strict";

  var STATES = ["IDLE", "ACTIVE", "RETURNING", "OFF"];

  /* ---------- Mock ---------- */

  function createMock() {
    var KEY_STATUS = "sl.mock.status", KEY_EVENTS = "sl.mock.events", CHANNEL = "sl-mock";
    var chan = ("BroadcastChannel" in window) ? new BroadcastChannel(CHANNEL) : null;
    var listeners = [], lastState = null;

    function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; } }
    function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
    function emit(msg) { listeners.forEach(function (fn) { fn(msg); }); }
    function send(msg) { if (chan) chan.postMessage(msg); }

    if (chan) chan.onmessage = function (e) { emit(e.data); };
    // Fallback for browsers without BroadcastChannel: localStorage fires "storage" in the other tabs.
    window.addEventListener("storage", function (e) {
      if (chan || e.key !== KEY_STATUS || !e.newValue) return;
      try { emit({ kind: "status", status: JSON.parse(e.newValue) }); } catch (err) {}
    });

    function putStatus(patch) {
      var cur = read(KEY_STATUS, { state: "IDLE", changedAt: Date.now(), seenAt: 0 });
      var next = Object.assign({}, cur, patch);
      write(KEY_STATUS, next);
      send({ kind: "status", status: next });
      return next;
    }

    return {
      kind: "mock",
      serverNow: function () { return Date.now(); },
      setState: function (state) {
        if (STATES.indexOf(state) < 0) return Promise.reject(new Error("unknown state " + state));
        if (state === lastState) return Promise.resolve(false);
        lastState = state;
        var now = Date.now();
        var events = read(KEY_EVENTS, []); events.push({ state: state, createdAt: now }); write(KEY_EVENTS, events.slice(-500));
        send({ kind: "event", event: { state: state, createdAt: now } });
        putStatus({ state: state, changedAt: now, seenAt: now });
        return Promise.resolve(true);
      },
      heartbeat: function () { putStatus({ seenAt: Date.now() }); return Promise.resolve(); },
      getStatus: function () {
        var st = read(KEY_STATUS, null);
        return Promise.resolve(st);
      },
      subscribe: function (fn) {
        listeners.push(fn);
        return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
      },
      cleanup: function (keepDays) {
        var cutoff = Date.now() - (keepDays || 7) * 86400000;
        var events = read(KEY_EVENTS, []).filter(function (e) { return e.createdAt >= cutoff; });
        write(KEY_EVENTS, events);
        return Promise.resolve();
      }
    };
  }

  /* ---------- Supabase ---------- */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = function () { reject(new Error("could not load supabase-js")); };
      document.head.appendChild(s);
    });
  }

  function fromRow(row) {
    if (!row) return null;
    return { state: row.state, changedAt: Date.parse(row.changed_at), seenAt: Date.parse(row.seen_at) };
  }

  function createSupabase(cfg) {
    return loadScript(cfg.SUPABASE_JS_URL).then(function () {
      var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 10 } }
      });
      var offset = 0, lastState = null;

      // The server decides what time it is: triggers in schema.sql stamp changed_at / seen_at.
      // The browser only measures how far its own clock is from the server's.
      function syncClock() {
        var t0 = Date.now();
        return sb.rpc("server_now").then(function (r) {
          if (r.error || !r.data) return;
          var t1 = Date.now();
          offset = Date.parse(r.data) - (t0 + t1) / 2;
        });
      }
      function fail(r) { if (r.error) throw r.error; return r; }

      return syncClock().catch(function () {}).then(function () {
        return {
          kind: "supabase",
          serverNow: function () { return Date.now() + offset; },
          setState: function (state) {
            if (STATES.indexOf(state) < 0) return Promise.reject(new Error("unknown state " + state));
            if (state === lastState) return Promise.resolve(false);
            return sb.from("lamp_events").insert({ state: state }).then(fail).then(function () {
              return sb.from("lamp_status").update({ state: state }).eq("id", 1);
            }).then(fail).then(function () { lastState = state; return true; });
          },
          heartbeat: function () {
            // the value is replaced by the server's clock; sending it only makes the row count as "updated"
            return sb.from("lamp_status").update({ seen_at: new Date().toISOString() }).eq("id", 1).then(fail).then(function () {});
          },
          getStatus: function () {
            return sb.from("lamp_status").select("state,changed_at,seen_at").eq("id", 1).maybeSingle()
              .then(fail).then(function (r) { return fromRow(r.data); });
          },
          subscribe: function (fn) {
            var ch = sb.channel("still-life")
              .on("postgres_changes", { event: "*", schema: "public", table: "lamp_status" }, function (p) {
                if (p.new && p.new.state) fn({ kind: "status", status: fromRow(p.new) });
              })
              .on("postgres_changes", { event: "INSERT", schema: "public", table: "lamp_events" }, function (p) {
                if (p.new) fn({ kind: "event", event: { state: p.new.state, createdAt: Date.parse(p.new.created_at) } });
              })
              .subscribe();
            return function () { sb.removeChannel(ch); };
          },
          cleanup: function (keepDays) {
            var cutoff = new Date(Date.now() + offset - (keepDays || 7) * 86400000).toISOString();
            return sb.from("lamp_events").delete().lt("created_at", cutoff).then(fail).then(function () {});
          }
        };
      });
    });
  }

  /* ---------- choose ---------- */

  SL.createBackend = function (cfg) {
    var forceMock = new URLSearchParams(location.search).has("mock");
    var hasKeys = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
    if (forceMock || !hasKeys) return Promise.resolve(createMock());
    return createSupabase(cfg);
  };
  SL.createMockBackend = createMock;   // for tests
})(window.SL = window.SL || {});
