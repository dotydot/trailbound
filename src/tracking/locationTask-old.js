/* ------------------------------------------------------------
   Background location recording, with a foreground fallback.

   Two paths:
     1. TaskManager + startLocationUpdatesAsync — true background,
        survives screen lock. Needs the foreground-service
        permissions compiled into the Android manifest.
     2. watchPositionAsync — works in any build, but only while
        the app is open. Used automatically when path 1 is
        rejected, so testing is never blocked by a stale binary.

   IMPORTANT: defineTask runs at module scope, before React mounts.
   Import this file once from App.js at the top level.
   ------------------------------------------------------------ */

import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import * as SQLite from "expo-sqlite";

export const LOCATION_TASK = "trailbound-location";

/* ---------- storage ---------- */
let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync("trailbound.db");
  return dbPromise;
}

export async function initDb() {
  const d = await db();
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL DEFAULT 'recording'
    );
    CREATE TABLE IF NOT EXISTS points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL,
      t INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      alt REAL,
      accuracy REAL,
      speed REAL,
      FOREIGN KEY (track_id) REFERENCES tracks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_points_track ON points(track_id, t);
  `);
}

export async function activeTrackId() {
  const d = await db();
  const row = await d.getFirstAsync(
    `SELECT id FROM tracks WHERE status = 'recording' ORDER BY id DESC LIMIT 1`
  );
  return row?.id ?? null;
}

async function insertPoints(trackId, locations) {
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const l of locations) {
      await d.runAsync(
        `INSERT INTO points (track_id, t, lat, lng, alt, accuracy, speed)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          trackId,
          Math.round(l.timestamp),
          l.coords.latitude,
          l.coords.longitude,
          l.coords.altitude ?? null,
          l.coords.accuracy ?? null,
          l.coords.speed ?? null,
        ]
      );
    }
  });
}

/* ---------- path 1: the background task ---------- */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[trailbound] location task error:", error.message);
    return;
  }
  const locations = data?.locations ?? [];
  if (locations.length === 0) return;
  try {
    const trackId = await activeTrackId();
    if (!trackId) return;
    await insertPoints(trackId, locations);
  } catch (e) {
    console.warn("[trailbound] failed to persist points:", e);
  }
});

/* ---------- path 2: foreground watch ---------- */
let watchSub = null;

async function startWatchFallback(trackId) {
  watchSub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 5000,
      distanceInterval: 10,
    },
    (loc) => {
      insertPoints(trackId, [loc]).catch((e) =>
        console.warn("[trailbound] watch insert failed:", e.message)
      );
    }
  );
}

async function stopWatchFallback() {
  try { watchSub?.remove(); } catch (_) {}
  watchSub = null;
}

/* ---------- permissions ---------- */
export async function requestPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return { ok: false, reason: "foreground-denied" };

  // iOS shows the "Always Allow" upgrade prompt only after foreground is
  // granted, and only once. Ask when the user first starts a hike.
  let bgGranted = false;
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    bgGranted = bg.status === "granted";
  } catch (_) { /* not available in this build */ }

  return { ok: true, reason: bgGranted ? "full" : "foreground-only" };
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
  // Never leave a stale 'recording' row behind — it eats new points.
  await abortStaleTracks();

  const d = await db();
  const res = await d.runAsync(
    `INSERT INTO tracks (started_at, status) VALUES (?, 'recording')`,
    [Date.now()]
  );
  const trackId = res.lastInsertRowId;

  try {
    const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (!already) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, backgroundOptions());
    }
    return { trackId, mode: "background" };
  } catch (e) {
    console.warn("[trailbound] background updates unavailable:", e.message);
    // Fall back to a plain position watch. Works in any build; the app
    // must stay open, which is fine for testing the track math.
    try {
      await startWatchFallback(trackId);
      return { trackId, mode: "foreground-only" };
    } catch (e2) {
      await d.runAsync(`UPDATE tracks SET status = 'aborted' WHERE id = ?`, [trackId]);
      throw e2;
    }
  }
}

async function abortStaleTracks() {
  const d = await db();
  await d.runAsync(
    `UPDATE tracks SET status = 'aborted', ended_at = ?
     WHERE status = 'recording'`,
    [Date.now()]
  );
}

export async function stopTracking() {
  const d = await db();
  const trackId = await activeTrackId();

  await stopWatchFallback();
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch (e) {
    console.warn("[trailbound] stop failed:", e.message);
  }

  if (trackId) {
    await d.runAsync(
      `UPDATE tracks SET ended_at = ?, status = 'complete' WHERE id = ?`,
      [Date.now(), trackId]
    );
  }
  return trackId;
}

export async function loadTrack(trackId) {
  const d = await db();
  const track = await d.getFirstAsync(`SELECT * FROM tracks WHERE id = ?`, [trackId]);
  const points = await d.getAllAsync(
    `SELECT t, lat, lng, alt, accuracy, speed FROM points WHERE track_id = ? ORDER BY t ASC`,
    [trackId]
  );
  return { ...track, points: points ?? [] };
}

/** Live point count, for showing progress while recording. */
export async function pointCount(trackId) {
  const d = await db();
  const row = await d.getFirstAsync(
    `SELECT COUNT(*) AS n FROM points WHERE track_id = ?`, [trackId]
  );
  return row?.n ?? 0;
}
