/* ------------------------------------------------------------
   src/tracking/locationTask.js

   Recording, with three tiers of capability:
     1. background       TaskManager + startLocationUpdatesAsync
     2. foreground-only  watchPositionAsync (works in Expo Go)
     3. unavailable      no permission

   Also owns the SQLite schema. Barometer samples are now PERSISTED
   so a hike can be re-resolved after a balance change without
   re-walking it — that is the whole tuning loop.
   ------------------------------------------------------------ */

import * as Location from "expo-location";
import * as SQLite from "expo-sqlite";

export const LOCATION_TASK = "trailbound-location";

/* optional native module — absent in Expo Go */
let TaskManager = null;
let taskDefined = false;
try { TaskManager = require("expo-task-manager"); } catch (_) { TaskManager = null; }
export const hasBackgroundSupport = () => !!TaskManager;

let dbPromise = null;
const db = () => (dbPromise ??= SQLite.openDatabaseAsync("trailbound.db"));

export async function initDb() {
  const d = await db();
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'recording',
      step_count INTEGER,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL,
      t INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      alt REAL,
      accuracy REAL,
      speed REAL
    );
    CREATE TABLE IF NOT EXISTS baro (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL,
      t INTEGER NOT NULL,
      hpa REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_points_track ON points(track_id, t);
    CREATE INDEX IF NOT EXISTS idx_baro_track ON baro(track_id, t);
  `);
  /* older installs will not have these columns */
  try { await d.execAsync(`ALTER TABLE tracks ADD COLUMN step_count INTEGER`); } catch (_) {}
  try { await d.execAsync(`ALTER TABLE tracks ADD COLUMN note TEXT`); } catch (_) {}
  defineTaskOnce();
}

export async function activeTrackId() {
  const d = await db();
  const row = await d.getFirstAsync(
    `SELECT id FROM tracks WHERE status = 'recording' ORDER BY id DESC LIMIT 1`);
  return row?.id ?? null;
}

async function insertPoints(trackId, locations) {
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const l of locations) {
      await d.runAsync(
        `INSERT INTO points (track_id, t, lat, lng, alt, accuracy, speed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [trackId, Math.round(l.timestamp), l.coords.latitude, l.coords.longitude,
         l.coords.altitude ?? null, l.coords.accuracy ?? null, l.coords.speed ?? null]);
    }
  });
}

/* ---------- tier 1: background task ---------- */
function defineTaskOnce() {
  if (!TaskManager || taskDefined) return;
  try {
    TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
      if (error) { console.warn("[trailbound] task error:", error.message); return; }
      const locations = data?.locations ?? [];
      if (!locations.length) return;
      try {
        const trackId = await activeTrackId();
        if (!trackId) return;
        await insertPoints(trackId, locations);
      } catch (e) { console.warn("[trailbound] persist failed:", e.message); }
    });
    taskDefined = true;
  } catch (e) {
    console.warn("[trailbound] could not define task:", e.message);
    TaskManager = null;
  }
}

/* ---------- tier 2: foreground watch ---------- */
let watchSub = null;
async function startWatch(trackId) {
  watchSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 5000, distanceInterval: 10 },
    loc => { insertPoints(trackId, [loc]).catch(e =>
      console.warn("[trailbound] watch insert failed:", e.message)); });
}
async function stopWatch() {
  try { watchSub?.remove(); } catch (_) {}
  watchSub = null;
}

/* ---------- permissions ---------- */
export async function requestPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return { ok:false, reason:"foreground-denied" };

  let bgGranted = false;
  if (TaskManager) {
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      bgGranted = bg.status === "granted";
    } catch (_) {}
  }
  return { ok:true, reason: bgGranted ? "full" : "foreground-only" };
}

/* ---------- control ---------- */
function backgroundOptions() {
  return {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 15000,
    distanceInterval: 20,
    deferredUpdatesInterval: 60000,
    deferredUpdatesDistance: 100,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Trailbound is recording your hike",
      notificationBody: "Tap to open. Your route stays on this device.",
      notificationColor: "#9C6B3F",
    },
  };
}

export async function startTracking() {
  await abortStaleTracks();
  const d = await db();
  const res = await d.runAsync(
    `INSERT INTO tracks (started_at, status) VALUES (?, 'recording')`, [Date.now()]);
  const trackId = res.lastInsertRowId;

  if (TaskManager) {
    try {
      defineTaskOnce();
      const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (!already) await Location.startLocationUpdatesAsync(LOCATION_TASK, backgroundOptions());
      return { trackId, mode:"background" };
    } catch (e) {
      console.log("[trailbound] background unavailable, using foreground watch");
    }
  }
  try {
    await startWatch(trackId);
    return { trackId, mode:"foreground-only" };
  } catch (e) {
    await d.runAsync(`UPDATE tracks SET status = 'aborted' WHERE id = ?`, [trackId]);
    throw e;
  }
}

async function abortStaleTracks() {
  const d = await db();
  await d.runAsync(
    `UPDATE tracks SET status = 'aborted', ended_at = ? WHERE status = 'recording'`,
    [Date.now()]);
}

export async function stopTracking() {
  const d = await db();
  const trackId = await activeTrackId();
  await stopWatch();
  if (TaskManager) {
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    } catch (_) {}
  }
  if (trackId) {
    await d.runAsync(
      `UPDATE tracks SET ended_at = ?, status = 'complete' WHERE id = ?`,
      [Date.now(), trackId]);
  }
  return trackId;
}

/* ---------- barometer persistence ----------
   Without this a hike can never be re-resolved: the pressure series
   only existed in memory and the elevation maths cannot be re-run. */
export async function saveBaroSamples(trackId, samples) {
  if (!trackId || !samples?.length) return 0;
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const s of samples) {
      await d.runAsync(`INSERT INTO baro (track_id, t, hpa) VALUES (?, ?, ?)`,
        [trackId, Math.round(s.t), s.hPa]);
    }
  });
  return samples.length;
}

export async function loadBaroSamples(trackId) {
  const d = await db();
  const rows = await d.getAllAsync(
    `SELECT t, hpa FROM baro WHERE track_id = ? ORDER BY t ASC`, [trackId]);
  return (rows ?? []).map(r => ({ t: r.t, hPa: r.hpa }));
}

export async function saveStepCount(trackId, steps) {
  if (!trackId) return;
  const d = await db();
  await d.runAsync(`UPDATE tracks SET step_count = ? WHERE id = ?`, [steps ?? null, trackId]);
}

/* ---------- reading ---------- */
export async function loadTrack(trackId) {
  const d = await db();
  const track = await d.getFirstAsync(`SELECT * FROM tracks WHERE id = ?`, [trackId]);
  const points = await d.getAllAsync(
    `SELECT t, lat, lng, alt, accuracy, speed FROM points WHERE track_id = ? ORDER BY t ASC`,
    [trackId]);
  return { ...track, points: points ?? [] };
}

/** Everything needed to re-resolve a past hike. */
export async function loadFullTrack(trackId) {
  const track = await loadTrack(trackId);
  const baro = await loadBaroSamples(trackId);
  return { ...track, baro };
}

export async function listTracks(limit = 40) {
  const d = await db();
  const rows = await d.getAllAsync(
    `SELECT t.id, t.started_at, t.ended_at, t.status, t.step_count, t.note,
            (SELECT COUNT(*) FROM points p WHERE p.track_id = t.id) AS point_count,
            (SELECT COUNT(*) FROM baro b WHERE b.track_id = t.id) AS baro_count
     FROM tracks t ORDER BY t.id DESC LIMIT ?`, [limit]);
  return rows ?? [];
}

export async function setTrackNote(trackId, note) {
  const d = await db();
  await d.runAsync(`UPDATE tracks SET note = ? WHERE id = ?`, [note ?? null, trackId]);
}

export async function deleteTrack(trackId) {
  const d = await db();
  await d.runAsync(`DELETE FROM points WHERE track_id = ?`, [trackId]);
  await d.runAsync(`DELETE FROM baro WHERE track_id = ?`, [trackId]);
  await d.runAsync(`DELETE FROM tracks WHERE id = ?`, [trackId]);
}

export async function dbStats() {
  const d = await db();
  const t = await d.getFirstAsync(`SELECT COUNT(*) n FROM tracks`);
  const p = await d.getFirstAsync(`SELECT COUNT(*) n FROM points`);
  const b = await d.getFirstAsync(`SELECT COUNT(*) n FROM baro`);
  return { tracks: t?.n ?? 0, points: p?.n ?? 0, baro: b?.n ?? 0 };
}
