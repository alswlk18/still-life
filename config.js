/* Still, Life — settings. Change values here, not in the scripts. */
window.SL = window.SL || {};
SL.config = {
  RIDGE_WINDOW_SEC: 30,     // the screen width of the front ridge = this many seconds
  RIDGE_SAMPLE_MS: 100,     // how often the softened brightness is recorded for the ridge (fine = no visible steps)
  RIDGE_SOFTEN_SEC: 0.6,    // how round the ridge hills are (time constant of the soft filter; larger = rounder, later)

  // Same numbers as arduino/pir_soft_light.ino
  LEVEL_IDLE: 50,
  LEVEL_ACTIVE: 200,
  FADE_FULL_MS: 3000,       // time to travel the whole 50 <-> 200 span
  OFF_FADE_MS: 1000,        // OFF fades to 0 over this long
  RETURN_DELAY_MS: 3000,    // test mode: key released -> RETURNING after this long

  // Server (step 2). Leave both empty until the Supabase project exists: the site then runs on the
  // in-browser mock (tabs of the same browser talk to each other). Only the public anon key goes here.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SUPABASE_JS_URL: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",

  HEARTBEAT_MS: 20000,      // host: how often it says "I am still here"
  AWAY_AFTER_MS: 60000,     // site: no heartbeat for this long = "The light is away"
  POLL_MS: 10000,           // site: re-read the status now and then in case a realtime message was missed
  EVENT_KEEP_DAYS: 7,       // lamp_events older than this are deleted when the host connects

  SILHOUETTE_LIST: "assets/silhouettes/silhouettes.json"
};
