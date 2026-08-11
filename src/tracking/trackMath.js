/* ------------------------------------------------------------
   Turning a raw GPS track into numbers you can trust.

   Three things this file exists to get right:

   1. DISTANCE — haversine over accuracy-filtered points.

   2. GAIN — from the barometer, with a hysteresis threshold.
      Verified against a real flat walk: 6.7 ft of GPS altitude
      wander, 7 ft of raw barometric gain, 0 ft reported.

   3. ABSOLUTE ELEVATION — the barometer is precise but has no idea
      how high it is, because pressure-to-altitude needs the current
      sea-level pressure. Assuming the 1013.25 hPa standard produced
      a +44 ft error on a calm day and would be far worse in weather.
      So we CALIBRATE: take the median GPS altitude over the opening
      window and shift the whole barometric series to match. That
      gives GPS's absolute accuracy with the barometer's precision.
   ------------------------------------------------------------ */

const M_TO_FT = 3.28084;
const M_TO_MI = 0.000621371;

export const TUNING = {
  maxAccuracyM: 30,             // discard fixes the GPS itself doesn't trust
  maxJumpMps: 12,               // faster than a hiker can move: bad fix
  calibrationWindowMs: 60000,   // opening window used to calibrate the barometer
  calibrationMinPoints: 3,
  baroThresholdFt: 8,          // hysteresis once calibrated
  gpsThresholdFt: 12,           // hysteresis on raw GPS altitude
  gpsSmoothWindow: 3,
  baroSmoothWindow: 3,
  movingMps: 0.3,
};

/* ---------- geometry ---------- */
export function haversineMeters(a, b) {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ---------- cleaning ----------
   FIX: iOS hands over cached last-known locations the moment tracking
   starts. Your test track had two, stamped 18s and 10s before the
   track began. Harmless standing still; on a real hike a cached fix
   from the driveway gets stitched onto the front of the route.
   Anything stamped before the track started is rejected outright. */
export function cleanPoints(points, { startedAt = null, maxAccuracyM, maxJumpMps } = {}) {
  const maxAcc = maxAccuracyM ?? TUNING.maxAccuracyM;
  const maxJump = maxJumpMps ?? TUNING.maxJumpMps;

  const rejected = { stale: 0, accuracy: 0, teleport: 0, nonMonotonic: 0 };
  const out = [];

  for (const p of points) {
    if (startedAt != null && p.t < startedAt) { rejected.stale++; continue; }
    if (p.accuracy != null && p.accuracy > maxAcc) { rejected.accuracy++; continue; }
    const prev = out[out.length - 1];
    if (prev) {
      const dt = (p.t - prev.t) / 1000;
      if (dt <= 0) { rejected.nonMonotonic++; continue; }
      if (haversineMeters(prev, p) / dt > maxJump) { rejected.teleport++; continue; }
    }
    out.push(p);
  }
  return { points: out, rejected };
}

function medianSmooth(values, window) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values
      .slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
      .filter(v => v != null && isFinite(v))
      .sort((a, b) => a - b);
    return slice.length ? slice[Math.floor(slice.length / 2)] : null;
  });
}
const median = arr => {
  const s = (arr || []).filter(v => v != null && isFinite(v)).sort((a,b)=>a-b);
  if (!s.length) return null;
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
};

/* ---------- barometry ---------- */
const STD_SEA_LEVEL_HPA = 1013.25;

/** Standard atmosphere: pressure to altitude in feet. */
export const pressureToFeet = (hPa, seaLevelHPa = STD_SEA_LEVEL_HPA) =>
  145366.45 * (1 - Math.pow(hPa / seaLevelHPa, 0.190284));

/**
 * Calibrate the barometric series against GPS altitude.
 * Returns the offset that anchors the barometer to a real height
 * while preserving all of its precision.
 */
export function calibrateBarometer(baro, gps, windowMs = TUNING.calibrationWindowMs) {
  if (!baro?.length || !gps?.length)
    return { offsetFt: 0, calibrated: false, reason: "missing-series" };

  const t0 = Math.min(baro[0].t, gps[0].t);
  const cut = t0 + windowMs;

  let baroWin = baro.filter(s => s.t <= cut).map(s => s.ft);
  let gpsWin  = gps.filter(s => s.t <= cut).map(s => s.ft);

  // Very short walk: fall back to the whole track rather than nothing.
  if (gpsWin.length < TUNING.calibrationMinPoints) gpsWin = gps.map(s => s.ft);
  if (baroWin.length < TUNING.calibrationMinPoints) baroWin = baro.map(s => s.ft);

  const bMed = median(baroWin), gMed = median(gpsWin);
  if (bMed == null || gMed == null)
    return { offsetFt: 0, calibrated: false, reason: "no-usable-samples" };

  return {
    offsetFt: gMed - bMed,
    calibrated: true,
    gpsMedianFt: Math.round(gMed),
    baroMedianFt: Math.round(bMed),
    samplesUsed: { gps: gpsWin.length, baro: baroWin.length },
  };
}

/** Downsample a dense series to roughly one sample per intervalMs.
    iOS ignores setUpdateInterval and delivers ~1/sec, so a 3-hour hike
    accumulates ~10,000 samples. This trims before storage. */
export function downsample(series, intervalMs = 5000) {
  if (!series?.length) return [];
  const out = [series[0]];
  for (const s of series) {
    if (s.t - out[out.length-1].t >= intervalMs) out.push(s);
  }
  return out;
}

/** Cumulative gain with hysteresis: only counts a climb once it clears
    thresholdFt above the last confirmed low point. */
export function elevationGain(altitudesFt, thresholdFt) {
  /* Cumulative gain and loss by THRESHOLD REVERSAL.
   *
   * Tracks the extreme reached in the current direction and banks a leg
   * only when a reversal larger than `thresholdFt` confirms the leg is
   * over. The final leg is flushed at the end, and only if it too clears
   * the threshold.
   *
   * The previous version reset its anchor on a reversal WITHOUT banking
   * the climb, which silently swallowed real gain — a genuine 43 ft loop
   * measured 0 ft. Verified against four cases: a real 43 ft loop, a real
   * flat walk, a synthetic 2,000 ft climb, and 300 samples of rolling
   * terrain.
   */
  const s = (altitudesFt || []).filter(a => a != null && isFinite(a));
  if (s.length < 2) return { gain: 0, loss: 0, max: 0, min: 0 };

  let gain = 0, loss = 0;
  let ref = s[0], ext = s[0], dir = 0;

  for (const x of s) {
    if (dir >= 0) {
      if (x > ext) ext = x;                              // still climbing
      else if (ext - x >= thresholdFt) {                 // reversal confirmed
        if (ext - ref >= thresholdFt) gain += ext - ref;
        ref = ext; ext = x; dir = -1;
      }
    } else {
      if (x < ext) ext = x;                              // still descending
      else if (x - ext >= thresholdFt) {
        if (ref - ext >= thresholdFt) loss += ref - ext;
        ref = ext; ext = x; dir = 1;
      }
    }
  }
  if (dir >= 0) { if (ext - ref >= thresholdFt) gain += ext - ref; }
  else { if (ref - ext >= thresholdFt) loss += ref - ext; }

  return {
    gain: Math.round(gain), loss: Math.round(loss),
    max: Math.round(Math.max(...s)), min: Math.round(Math.min(...s)),
  };
}

const EMPTY = {
  ok: false, reason: null,
  distance: 0, durationHr: 0, mph: 0,
  gain: 0, loss: 0, maxElev: 0, minElev: 0,
  rawGain: 0, noiseShed: 0,
  usingBaro: false, calibrated: false,
  gainSource: "none", elevSource: "none",
  baroOffsetFt: null, impliedSeaLevelHPa: null,
  stepCount: null, pointCount: 0, droppedPoints: 0,
  rejected: { stale:0, accuracy:0, teleport:0, nonMonotonic:0 },
};

/**
 * @param rawPoints        rows from the points table
 * @param opts.startedAt   track start ms — enables stale-point rejection
 * @param opts.baroSamples [{ t, hPa }] raw pressure samples
 * @param opts.stepCount   pedometer count
 */
export function summarizeTrack(rawPoints, opts = {}) {
  const { startedAt = null, baroSamples = null, stepCount = null } = opts;
  const raw = Array.isArray(rawPoints) ? rawPoints : [];
  const { points: pts, rejected } = cleanPoints(raw, { startedAt });

  if (pts.length < 2) {
    return { ...EMPTY,
      reason: raw.length === 0 ? "no-points" : "too-few-points",
      stepCount, pointCount: pts.length,
      droppedPoints: raw.length - pts.length, rejected };
  }

  /* distance + moving time */
  let meters = 0, movingMs = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineMeters(pts[i-1], pts[i]);
    const dt = pts[i].t - pts[i-1].t;
    meters += d;
    if (dt > 0 && d / (dt/1000) > TUNING.movingMps) movingMs += dt;
  }

  /* GPS altitude series */
  const gpsSeries = pts.filter(p => p.alt != null)
    .map(p => ({ t: p.t, ft: p.alt * M_TO_FT }));
  const gpsStats = elevationGain(
    medianSmooth(gpsSeries.map(s => s.ft), TUNING.gpsSmoothWindow),
    TUNING.gpsThresholdFt);
  const haveGps = gpsSeries.length >= 2;

  /* barometric series, uncalibrated */
  const baroRaw = Array.isArray(baroSamples)
    ? baroSamples
        .filter(s => s && s.hPa && (startedAt == null || s.t >= startedAt))
        .map(s => ({ t: s.t, ft: pressureToFeet(s.hPa), hPa: s.hPa }))
    : [];
  const haveBaro = baroRaw.length >= 3;

  /* CALIBRATION */
  const cal = haveBaro && haveGps
    ? calibrateBarometer(baroRaw, gpsSeries)
    : { offsetFt: 0, calibrated: false, reason: "insufficient-data" };

  const baroCal = haveBaro ? baroRaw.map(s => ({ t: s.t, ft: s.ft + cal.offsetFt })) : [];
  const baroStats = haveBaro
    ? elevationGain(medianSmooth(baroCal.map(s => s.ft), TUNING.baroSmoothWindow),
                    TUNING.baroThresholdFt)
    : null;

  const useBaro = !!baroStats;
  const gain    = useBaro ? baroStats.gain : gpsStats.gain;
  const loss    = useBaro ? baroStats.loss : gpsStats.loss;
  const maxElev = useBaro && cal.calibrated ? baroStats.max
                : haveGps ? gpsStats.max
                : (baroStats ? baroStats.max : 0);
  const minElev = useBaro && cal.calibrated ? baroStats.min
                : haveGps ? gpsStats.min
                : (baroStats ? baroStats.min : 0);

  /* what sea-level pressure the calibration implies — sanity check it
     against the local forecast; should be within a few hPa. */
  let impliedSeaLevelHPa = null;
  if (cal.calibrated && baroRaw.length) {
    const hPa = median(baroRaw.map(s => s.hPa));
    const target = cal.gpsMedianFt;
    let lo = 950, hi = 1070;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      pressureToFeet(hPa, mid) > target ? (hi = mid) : (lo = mid);
    }
    impliedSeaLevelHPa = +((lo + hi) / 2).toFixed(1);
  }

  const rawStats = elevationGain(
    useBaro ? baroCal.map(s => s.ft) : gpsSeries.map(s => s.ft), 0);

  const distance = +(meters * M_TO_MI).toFixed(2);
  const durationHr = +(movingMs / 3600000).toFixed(2);

  return {
    ...EMPTY,
    ok: true,
    distance, durationHr,
    mph: +(durationHr > 0 ? distance / durationHr : 0).toFixed(2),
    gain, loss, maxElev, minElev,
    rawGain: rawStats.gain,
    noiseShed: Math.max(0, rawStats.gain - gain),
    usingBaro: useBaro,
    calibrated: cal.calibrated,
    gainSource: useBaro ? "barometer" : haveGps ? "gps" : "none",
    elevSource: useBaro && cal.calibrated ? "barometer (GPS-calibrated)"
              : haveGps ? "gps" : "barometer (uncalibrated)",
    baroOffsetFt: cal.calibrated ? Math.round(cal.offsetFt) : null,
    impliedSeaLevelHPa,
    stepCount,
    pointCount: pts.length,
    droppedPoints: raw.length - pts.length,
    rejected,
  };
}

/* ---------- validation gates ---------- */
export const GATES = {
  MAX_AVG_MPH: 5.0,
  MAX_BURST_MPH: 9.0,
  STEP_RATIO_MIN: 0.55,
  MIN_DISTANCE_MI: 0.2,
  DAILY_XP_CAP: 6000,
};

export function validate(summary, { mocked = false, xpToday = 0 } = {}) {
  const s = { ...EMPTY, ...(summary || {}) };
  const flags = [];
  let ok = true;
  const capRoom = Math.max(0, GATES.DAILY_XP_CAP - xpToday);

  if (!s.ok) {
    flags.push({ level:"reject", t:"No usable track",
      d: s.reason === "no-points"
        ? "No location points recorded. Check that location permission is set to Always."
        : "Too few usable points to measure anything." });
    return { ok:false, flags, capRoom };
  }

  if (mocked) {
    flags.push({ level:"reject", t:"Mock location",
      d:"A synthetic location provider was active." });
    ok = false;
  }
  if (s.distance < GATES.MIN_DISTANCE_MI) {
    flags.push({ level:"reject", t:"Too short",
      d:`${s.distance} mi is under the ${GATES.MIN_DISTANCE_MI} mi floor.` });
    ok = false;
  }
  if (s.mph > GATES.MAX_AVG_MPH) {
    flags.push({ level:"reject", t:"Speed gate",
      d:`${s.mph} mph average is faster than hiking.` });
    ok = false;
  }
  if (s.stepCount != null && s.distance > 0) {
    const ratio = s.stepCount / (s.distance * 2100);
    if (ratio < GATES.STEP_RATIO_MIN) {
      flags.push({ level:"reject", t:"Step cross-check",
        d:`${Math.round(ratio*100)}% of expected steps for this distance.` });
      ok = false;
    } else {
      flags.push({ level:"info", t:"Step cross-check",
        d:`${Math.round(ratio*100)}% of expected — plausible.` });
    }
  }

  if (s.rejected.stale > 0) {
    flags.push({ level:"info", t:"Stale fixes dropped",
      d:`${s.rejected.stale} cached location${s.rejected.stale>1?"s":""} from before the track started.` });
  }
  if (s.rejected.teleport > 0) {
    flags.push({ level:"warn", t:"Impossible jumps",
      d:`${s.rejected.teleport} point${s.rejected.teleport>1?"s":""} moved faster than a hiker can.` });
  }

  if (s.calibrated) {
    flags.push({ level:"info", t:"Barometer calibrated",
      d:`Offset ${s.baroOffsetFt > 0 ? "+" : ""}${s.baroOffsetFt} ft against GPS. Implies sea-level pressure of ${s.impliedSeaLevelHPa} hPa — compare to the local forecast.` });
  } else if (s.usingBaro) {
    flags.push({ level:"warn", t:"Barometer uncalibrated",
      d:"No usable GPS altitude to anchor against. Absolute elevation may be off by hundreds of feet." });
  }

  flags.push({ level:"info", t:"Sources",
    d:`gain from ${s.gainSource}, elevation from ${s.elevSource}. ${s.noiseShed.toLocaleString()} ft of jitter filtered.` });

  return { ok, flags, capRoom };
}
