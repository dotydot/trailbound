/* ------------------------------------------------------------
   Location recording with three tiers of capability:

     1. background      TaskManager + startLocationUpdatesAsync.
                        Survives screen lock. Needs a dev/production
                        build with foreground-service permissions.
     2. foreground-only  watchPositionAsync. Works in ANY build
                        including Expo Go, but the app must stay open.
     3. unavailable      no location permission at all.

   The TaskManager import is guarded so this file loads in Expo Go,
   where that native module doesn't exist.
   ------------------------------------------------------------ */

import * as Location from "expo-location";
import * as SQLite from "expo-sqlite";

export const LOCATION_TASK = "trailbound-location";

/* ---------- optional native module ---------- */
let TaskManager = null;
let taskDefined = false;
try {
  // eslint-disable-next-line
  TaskManager = require("expo-task-manager");
} catch (_) {
  TaskManager = null;   // Expo Go, or module not installed
}

export const hasBackgroundSupport = () => !!TaskManager;

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
  defineTaskOnce();
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

/* ---------- tier 1: background task ---------- */
function defineTaskOnce() {
  if (!TaskManager || taskDefined) return;
  try {
    TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
      if (error) {
        console.warn("[trailbound] task error:", error.message);
        return;
      }
      const locations = data?.locations ?? [];
      if (locations.length === 0) return;
      try {
        const trackId = await activeTrackId();
        if (!trackId) return;
        await insertPoints(trackId, locations);
      } catch (e) {
        console.warn("[trailbound] persist failed:", e.message);
      }
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
    { accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 5000, distanceInterval: 10 },
    (loc) => {
      insertPoints(trackId, [loc]).catch((e) =>
        console.warn("[trailbound] watch insert failed:", e.message));
    }
  );
}
async function stopWatch() {
  try { watchSub?.remove(); } catch (_) {}
  watchSub = null;
}

/* ---------- permissions ---------- */
export async function requestPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return { ok: false, reason: "foreground-denied" };

  // Only worth asking if we can actually use it. In Expo Go this prompt
  // either doesn't appear or grants something unusable.
  let bgGranted = false;
  if (TaskManager) {
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      bgGranted = bg.status === "granted";
    } catch (_) {}
  }
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
  await abortStaleTracks();

  const d = await db();
  const res = await d.runAsync(
    `INSERT INTO tracks (started_at, status) VALUES (?, 'recording')`,
    [Date.now()]
  );
  const trackId = res.lastInsertRowId;

  if (TaskManager) {
    try {
      defineTaskOnce();
      const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (!already) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, backgroundOptions());
      }
      return { trackId, mode: "background" };
    } catch (e) {
      // Expected when the manifest lacks foreground-service permissions.
      console.log("[trailbound] background unavailable, using foreground watch");
    }
  }

  try {
    await startWatch(trackId);
    return { trackId, mode: "foreground-only" };
  } catch (e) {
    await d.runAsync(`UPDATE tracks SET status = 'aborted' WHERE id = ?`, [trackId]);
    throw e;
  }
}

async function abortStaleTracks() {
  const d = await db();
  await d.runAsync(
    `UPDATE tracks SET status = 'aborted', ended_at = ? WHERE status = 'recording'`,
    [Date.now()]
  );
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

export async function pointCount(trackId) {
  const d = await db();
  const row = await d.getFirstAsync(
    `SELECT COUNT(*) AS n FROM points WHERE track_id = ?`, [trackId]
  );
  return row?.n ?? 0;
}
