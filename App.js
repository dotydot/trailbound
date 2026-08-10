/* ------------------------------------------------------------
   Trailbound — minimal end-to-end shell.

   Start a hike, walk around, stop, see the summary and the
   validation result. That's Phase 2: prove the numbers are
   trustworthy on real hardware before building anything on top.
   ------------------------------------------------------------ */

import React, { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Barometer, Pedometer } from "expo-sensors";
import { deactivateKeepAwake } from "expo-keep-awake";

import {
  initDb, requestPermissions, startTracking, stopTracking,
  loadTrack, activeTrackId,
} from "./src/tracking/locationTask";   // side effect: defines the task
import { summarizeTrack, validate } from "./src/tracking/trackMath";

const C = {
  paper: "#EDEFE3", paperDeep: "#E2E5D6", contour: "#9C6B3F",
  ink: "#1E3A2F", inkSoft: "#4A6355", danger: "#A63D2E", ok: "#3F7A52",
};

/* barometric altitude from pressure — far better than GPS altitude */
const SEA_LEVEL_HPA = 1013.25;
const pressureToFeet = (hPa) =>
  145366.45 * (1 - Math.pow(hPa / SEA_LEVEL_HPA, 0.190284));

export default function App() {
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const baroSeries = useRef([]);
  const baroSub = useRef(null);
  const pedoSub = useRef(null);
  const steps = useRef(0);
  const startedAt = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        await initDb();
        const id = await activeTrackId();
        if (id) { setRecording(true); startedAt.current = Date.now(); tick(); }
      } catch (e) {
        setErr(`Database failed to open: ${e.message}`);
      }
      setReady(true);
    })();
    return () => clearInterval(timer.current);
  }, []);

  function tick() {
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startedAt.current || Date.now())) / 1000));
    }, 1000);
  }

  function cleanupSensors() {
    try { baroSub.current?.remove(); } catch (_) {}
    try { pedoSub.current?.remove(); } catch (_) {}
    baroSub.current = null;
    pedoSub.current = null;
  }

  async function begin() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const perm = await requestPermissions();
      if (!perm.ok) {
        Alert.alert(
          "Location access needed",
          "Trailbound needs location access to record your route. Enable it in Settings."
        );
        setBusy(false);
        return;
      }
      if (perm.reason === "foreground-only") {
        Alert.alert(
          "Background access not granted",
          "Recording will stop when the screen locks. Choose Always Allow in Settings for full hikes."
        );
      }

      baroSeries.current = [];
      steps.current = 0;

      try {
        if (await Barometer.isAvailableAsync()) {
          Barometer.setUpdateInterval(5000);
          baroSub.current = Barometer.addListener(({ pressure }) => {
            if (pressure) baroSeries.current.push(pressureToFeet(pressure));
          });
        }
      } catch (_) { /* no barometer; GPS altitude will be used */ }

      try {
        if (await Pedometer.isAvailableAsync()) {
          pedoSub.current = Pedometer.watchStepCount((r) => { steps.current = r.steps; });
        }
      } catch (_) { /* no pedometer; step gate will be skipped */ }

      const started = await startTracking();
      setMode(started.mode);
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      setResult(null);
      tick();
      deactivateKeepAwake().catch(() => {});
    } catch (e) {
      cleanupSensors();
      setErr(`Couldn't start tracking: ${e.message}`);
    }
    setBusy(false);
  }

  async function end() {
    if (busy) return;
    setBusy(true);
    try {
      const trackId = await stopTracking();
      cleanupSensors();
      clearInterval(timer.current);
      setRecording(false);

      if (!trackId) {
        setErr("No active track found to close.");
        setBusy(false);
        return;
      }

      const track = await loadTrack(trackId);
      const summary = summarizeTrack(track.points, {
        baroAltitudesFt: baroSeries.current.length > 2 ? baroSeries.current : null,
        stepCount: steps.current || null,
      });
      const v = validate(summary, { mocked: false, xpToday: 0 });
      setResult({ summary, v, trackId });
    } catch (e) {
      setErr(`Couldn't finish the hike: ${e.message}`);
      setRecording(false);
    }
    setBusy(false);
  }

  if (!ready) {
    return (
      <View style={[s.safe, s.center]}>
        <Text style={s.hint}>Starting up…</Text>
      </View>
    );
  }

  const sum = result?.summary;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.wrap}>
          <Text style={s.eyebrow}>Trailbound</Text>
          <Text style={s.h1}>{recording ? "Recording" : "Ready"}</Text>

          {recording && (
            <>
              <Text style={s.timer}>{fmt(elapsed)}</Text>
              <Text style={s.hint}>
                {mode === "foreground-only"
                  ? "Foreground only — keep the app open. Background needs a rebuild with the service permissions."
                  : "Put the phone away. The screen can sleep — the route keeps recording."}
              </Text>
            </>
          )}

          <Pressable
            onPress={recording ? end : begin}
            disabled={busy}
            style={[s.btn, recording && s.btnStop, busy && s.btnBusy]}
          >
            <Text style={s.btnText}>
              {busy ? "Working…" : recording ? "Finish hike" : "Start hike"}
            </Text>
          </Pressable>

          {err && (
            <View style={s.errBox}>
              <Text style={s.errTitle}>Something went wrong</Text>
              <Text style={s.errText}>{err}</Text>
            </View>
          )}

          {sum && (
            <View style={s.card}>
              <Text style={s.cardTitle}>
                {result.v.ok ? "Track accepted" : "Track rejected"}
              </Text>

              <Row k="Distance" v={`${n(sum.distance)} mi`} />
              <Row k="Elevation gain" v={`${n(sum.gain).toLocaleString()} ft`} />
              <Row k="Peak elevation" v={`${n(sum.maxElev).toLocaleString()} ft`} />
              <Row k="Moving time" v={`${n(sum.durationHr)} hr`} />
              <Row k="Average pace" v={`${n(sum.mph)} mph`} />
              <Row k="Altitude source" v={sum.usingBaro ? "barometer" : "GPS only"} />
              <Row k="Noise filtered" v={`${n(sum.noiseShed).toLocaleString()} ft`} />
              <Row k="Points kept" v={`${n(sum.pointCount)} (${n(sum.droppedPoints)} dropped)`} />
              <Row k="Steps" v={sum.stepCount == null ? "n/a" : sum.stepCount} />

              {(result.v.flags || []).map((f, i) => (
                <View key={i} style={s.flag}>
                  <Text style={[s.flagLevel, {
                    color: f.level === "reject" ? C.danger
                         : f.level === "warn" ? C.contour : C.inkSoft }]}>
                    {f.level}
                  </Text>
                  <Text style={s.flagText}>{f.t} — {f.d}</Text>
                </View>
              ))}

              <Text style={s.note}>
                Next: hand this summary to the encounter engine and render the log.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const n = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

const fmt = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};

const Row = ({ k, v }) => (
  <View style={s.row}>
    <Text style={s.rowK}>{k}</Text>
    <Text style={s.rowV}>{String(v)}</Text>
  </View>
);

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  center: { justifyContent: "center", alignItems: "center" },
  wrap: { padding: 22, paddingBottom: 60 },
  eyebrow: { fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.contour },
  h1: { fontSize: 34, fontWeight: "700", color: C.ink, marginTop: 2 },
  timer: { fontSize: 46, fontVariant: ["tabular-nums"], color: C.ink, marginTop: 14 },
  hint: { fontSize: 14, color: C.inkSoft, marginTop: 8, lineHeight: 20 },
  btn: { marginTop: 26, backgroundColor: C.ink, paddingVertical: 17, alignItems: "center" },
  btnStop: { backgroundColor: C.danger },
  btnBusy: { opacity: 0.5 },
  btnText: { color: C.paper, fontSize: 15, letterSpacing: 2, textTransform: "uppercase", fontWeight: "600" },
  errBox: { marginTop: 20, borderWidth: 1, borderColor: C.danger, padding: 14, backgroundColor: "#FBEDEA" },
  errTitle: { fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", color: C.danger },
  errText: { fontSize: 14, color: C.ink, marginTop: 6, lineHeight: 20 },
  card: { marginTop: 26, borderWidth: 1, borderColor: C.contour, padding: 16, backgroundColor: C.paperDeep },
  cardTitle: { fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase", color: C.contour, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6,
         borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.06)" },
  rowK: { fontSize: 14, color: C.inkSoft },
  rowV: { fontSize: 14, color: C.ink, fontWeight: "600", fontVariant: ["tabular-nums"] },
  flag: { flexDirection: "row", gap: 10, marginTop: 10 },
  flagLevel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2, width: 54 },
  flagText: { flex: 1, fontSize: 13, color: C.inkSoft, lineHeight: 18 },
  note: { marginTop: 16, fontSize: 13, fontStyle: "italic", color: C.inkSoft },
});
