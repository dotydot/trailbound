/* ------------------------------------------------------------
   Turning a raw GPS track into numbers you can trust.

   This is the file that decides whether your app's elevation
   figures are credible. Raw GPS altitude is noisy enough to
   invent thousands of feet of "gain" on a flat walk, so
   everything here is about filtering before measuring.
   ------------------------------------------------------------ */

const M_TO_FT = 3.28084;
const M_TO_MI = 0.000621371;

/* ---------- geometry ---------- */
export function haversineMeters(a, b) {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = ((b.lat - a.lat) * Math.PI) / 180;
  const dλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ---------- cleaning ---------- */

/** Drop points the GPS itself doesn't trust, plus teleports. */
export function cleanPoints(points, { maxAccuracyM = 30, maxJumpMps = 12 } = {}) {
  const out = [];
  for (const p of points) {
    if (p.accuracy != null && p.accuracy > maxAccuracyM) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const dt = (p.t - prev.t) / 1000;
      if (dt <= 0) continue;
      const d = haversineMeters(prev, p);
      if (d / dt > maxJumpMps) continue;   // physically impossible for a hiker
    }
    out.push(p);
  }
  return out;
}

/** Rolling median smooths altitude spikes without lagging like a mean does. */
function medianSmooth(values, window = 5) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values
      .slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
      .filter((v) => v != null)
      .sort((a, b) => a - b);
    if (slice.length === 0) return null;
    return slice[Math.floor(slice.length / 2)];
  });
}

/**
 * Cumulative elevation gain with a hysteresis threshold.
 *
 * The threshold is the whole trick: only count a climb once it has
 * risen `thresholdFt` above the last confirmed low point. Without it,
 * GPS jitter of ±15 ft sampled 400 times will report ~3,000 ft of gain
 * on a level trail.
 *
 * Use ~10 ft with a barometer, ~25 ft on GPS altitude alone.
 */
export function elevationGain(altitudesFt, thresholdFt = 25) {
  const alts = (altitudesFt || []).filter((a) => a != null && isFinite(a));
  if (alts.length < 2) return { gain: 0, loss: 0, max: 0, min: 0 };

  let gain = 0, loss = 0;
  let anchor = alts[0];
  let dir = 0; // 1 climbing, -1 descending, 0 undecided

  for (const a of alts) {
    const delta = a - anchor;
    if (dir >= 0 && delta >= thresholdFt) {
      gain += delta; anchor = a; dir = 1;
    } else if (dir <= 0 && delta <= -thresholdFt) {
      loss += -delta; anchor = a; dir = -1;
    } else if (dir === 1 && delta < -thresholdFt) {
      anchor = a; dir = -1;
    } else if (dir === -1 && delta > thresholdFt) {
      anchor = a; dir = 1;
    }
  }
  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    max: Math.round(Math.max(...alts)),
    min: Math.round(Math.min(...alts)),
  };
}

/* ---------- the main reducer ---------- */

/** Every field the UI reads, with safe zeros. Early returns spread this
    so a short or failed track can never crash the results card. */
const EMPTY = {
  ok: false, reason: null,
  distance: 0, durationHr: 0, mph: 0,
  gain: 0, loss: 0, maxElev: 0, minElev: 0,
  rawGain: 0, noiseShed: 0,
  usingBaro: false, stepCount: null,
  pointCount: 0, droppedPoints: 0,
};

/**
 * @param rawPoints  rows from the points table
 * @param opts.baroAltitudesFt  optional barometric series
 * @param opts.stepCount        pedometer count for the same window
 */
export function summarizeTrack(rawPoints, opts = {}) {
  const { baroAltitudesFt = null, stepCount = null } = opts;
  const raw = Array.isArray(rawPoints) ? rawPoints : [];
  const pts = cleanPoints(raw);

  if (pts.length < 2) {
    return {
      ...EMPTY,
      reason: raw.length === 0 ? "no-points" : "too-few-points",
      stepCount,
      pointCount: pts.length,
      droppedPoints: raw.length - pts.length,
    };
  }

  /* distance + moving time (stationary samples excluded) */
  let meters = 0, movingMs = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineMeters(pts[i - 1], pts[i]);
    const dt = pts[i].t - pts[i - 1].t;
    meters += d;
    if (dt > 0 && d / (dt / 1000) > 0.3) movingMs += dt;  // >~0.7 mph counts as moving
  }

  /* elevation: prefer barometer, fall back to GPS altitude */
  const usingBaro = Array.isArray(baroAltitudesFt) && baroAltitudesFt.length > 2;
  const source = usingBaro
    ? baroAltitudesFt
    : pts.map((p) => (p.alt == null ? null : p.alt * M_TO_FT));
  const smoothed = medianSmooth(source, usingBaro ? 3 : 7);
  const threshold = usingBaro ? 10 : 25;

  const elev = elevationGain(smoothed, threshold);
  const rawElev = elevationGain(source, 0);   // what it'd be with no filtering

  const distance = +(meters * M_TO_MI).toFixed(2);
  const durationHr = +(movingMs / 3600000).toFixed(2);
  const mph = durationHr > 0 ? distance / durationHr : 0;

  return {
    ...EMPTY,
    ok: true,
    distance,
    durationHr,
    mph: +mph.toFixed(2),
    gain: elev.gain,
    loss: elev.loss,
    maxElev: elev.max,
    minElev: elev.min,
    rawGain: rawElev.gain,
    noiseShed: Math.max(0, rawElev.gain - elev.gain),
    usingBaro,
    stepCount,
    pointCount: pts.length,
    droppedPoints: raw.length - pts.length,
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

  if (!s.ok) {
    flags.push({ level: "reject", t: "No usable track",
      d: s.reason === "no-points"
        ? "No location points were recorded. Check that location permission is set to Always."
        : "Too few usable points to measure anything." });
    return { ok: false, flags, capRoom: Math.max(0, GATES.DAILY_XP_CAP - xpToday) };
  }

  if (mocked) {
    flags.push({ level: "reject", t: "Mock location", d: "A synthetic location provider was active." });
    ok = false;
  }
  if (s.distance < GATES.MIN_DISTANCE_MI) {
    flags.push({ level: "reject", t: "Too short", d: "Not enough movement to score." });
    ok = false;
  }
  if (s.mph > GATES.MAX_AVG_MPH) {
    flags.push({ level: "reject", t: "Speed gate",
      d: `${s.mph} mph average is faster than hiking.` });
    ok = false;
  }
  if (s.stepCount != null) {
    const expected = s.distance * 2100;
    const ratio = expected > 0 ? s.stepCount / expected : 1;
    if (ratio < GATES.STEP_RATIO_MIN) {
      flags.push({ level: "reject", t: "Step cross-check",
        d: `${Math.round(ratio * 100)}% of the steps this distance should take.` });
      ok = false;
    }
  }
  if (!s.usingBaro) {
    flags.push({ level: "info", t: "GPS altitude only",
      d: `Filtered out ${(s.noiseShed || 0).toLocaleString()} ft of jitter.` });
  }

  return { ok, flags, capRoom: Math.max(0, GATES.DAILY_XP_CAP - xpToday) };
}
