/* ------------------------------------------------------------
   App.js
   The whole vertical slice: record a hike, prove the numbers,
   resolve it into encounters, tell the story, take the loot.
   ------------------------------------------------------------ */

import React, { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Barometer, Pedometer } from "expo-sensors";
import { deactivateKeepAwake } from "expo-keep-awake";

import {
  initDb, requestPermissions, startTracking, stopTracking,
  loadTrack, activeTrackId,
} from "./src/tracking/locationTask";
import { summarizeTrack, validate, downsample } from "./src/tracking/trackMath";

import { resolveHike, commitHike } from "./src/game/engine";
import { buildLog, CORE_PACK } from "./src/game/narrative";
import { REGIONS, levelFromXp } from "./src/game/world";
import {
  initCharacterTable, loadCharacter, saveCharacter, resetCharacter,
  applyElapsed, applyDailyCap, awardBadges,
} from "./src/game/character";

import AfterAction from "./src/screens/AfterAction";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6", contour:"#9C6B3F",
  ink:"#1E3A2F", inkSoft:"#4A6355", danger:"#A63D2E", ok:"#3F7A52", gold:"#B0682A",
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [character, setCharacter] = useState(null);
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(null);   // { summary, validation, result, log }
  const [banner, setBanner] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const baroSamples = useRef([]);   // [{ t, hPa }]
  const baroSub = useRef(null);
  const pedoSub = useRef(null);
  const steps = useRef(0);
  const startedAt = useRef(null);
  const timer = useRef(null);

  /* ---------- boot ---------- */
  useEffect(() => {
    (async () => {
      try {
        await initDb();
        await initCharacterTable();
        const loaded = applyElapsed(await loadCharacter());
        await saveCharacter(loaded);
        setCharacter(loaded);

        const id = await activeTrackId();
        if (id) { setRecording(true); startedAt.current = Date.now(); tick(); }
      } catch (e) {
        setErr(`Startup failed: ${e.message}`);
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
    baroSub.current = null; pedoSub.current = null;
  }

  /* ---------- start ---------- */
  async function begin() {
    if (busy) return;
    setBusy(true); setErr(null); setBanner(null);
    try {
      const perm = await requestPermissions();
      if (!perm.ok) {
        Alert.alert("Location access needed",
          "Trailbound needs location access to record your route. Enable it in Settings.");
        setBusy(false); return;
      }
      if (perm.reason === "foreground-only") {
        Alert.alert("Foreground only",
          "Recording will stop when the screen locks. Keep the app open, or grant Always Allow in Settings.");
      }

      baroSamples.current = [];
      steps.current = 0;

      try {
        if (await Barometer.isAvailableAsync()) {
          Barometer.setUpdateInterval(5000);   // iOS ignores this; we downsample later
          baroSub.current = Barometer.addListener(({ pressure }) => {
            if (pressure) baroSamples.current.push({ t: Date.now(), hPa: pressure });
          });
        }
      } catch (_) {}

      try {
        if (await Pedometer.isAvailableAsync()) {
          pedoSub.current = Pedometer.watchStepCount(r => { steps.current = r.steps; });
        }
      } catch (_) {}

      const started = await startTracking();
      setMode(started.mode);
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      setPending(null);
      tick();
      deactivateKeepAwake().catch(() => {});
    } catch (e) {
      cleanupSensors();
      setErr(`Couldn't start tracking: ${e.message}`);
    }
    setBusy(false);
  }

  /* ---------- finish: the whole pipeline ---------- */
  async function end() {
    if (busy) return;
    setBusy(true);
    try {
      const trackId = await stopTracking();
      cleanupSensors();
      clearInterval(timer.current);
      setRecording(false);

      if (!trackId) { setErr("No active track to close."); setBusy(false); return; }

      const track = await loadTrack(trackId);

      /* 1. numbers you can trust */
      const trimmed = downsample(baroSamples.current, 5000);
      const summary = summarizeTrack(track.points, {
        startedAt: track.started_at,
        baroSamples: trimmed,
        stepCount: steps.current || null,
      });

      /* 2. gates */
      const validation = validate(summary, { mocked: false, xpToday: character.dailyXp || 0 });

      /* 3. the game */
      const result = resolveHike(summary, character, {
        trackPoints: track.points,
        seed: `${trackId}-${track.started_at}`,
        intention: character.intention,
      });

      /* 4. the story */
      const log = buildLog(result, summary, character, [CORE_PACK], { seed: trackId });

      setPending({ summary, validation, result, log, trackId });
      console.log("[trailbound] resolved track", trackId, summary);
    } catch (e) {
      setErr(`Couldn't finish the hike: ${e.message}`);
      setRecording(false);
    }
    setBusy(false);
  }

  /* ---------- commit ---------- */
  async function commit(hauledIds) {
    if (!pending) return;
    try {
      let next = commitHike(character, pending.result, pending.summary, hauledIds);

      const capped = applyDailyCap(next, pending.result.xp.total);
      next = capped.character;
      if (capped.capped) {
        next.xp = (character.xp || 0) + capped.granted;
      }

      const withBadges = awardBadges(next);
      next = withBadges.character;
      next.conditionUpdatedAt = Date.now();

      await saveCharacter(next);
      setCharacter(next);
      setPending(null);

      const bits = [];
      if (pending.result.levelUp) bits.push(`Level ${pending.result.levelUp}.`);
      if (withBadges.earned.length)
        bits.push(`Badges: ${withBadges.earned.map(b => b.name).join(", ")}.`);
      if (capped.capped) bits.push("Daily XP cap reached.");
      if (pending.result.tally.settled) bits.push("Account settled.");
      setBanner(bits.join(" ") || "Hike recorded.");
    } catch (e) {
      setErr(`Couldn't save: ${e.message}`);
    }
  }

  async function wipe() {
    const fresh = await resetCharacter();
    setCharacter(fresh);
    setPending(null);
    setBanner("Character reset. Tracks kept.");
  }

  /* ---------- render ---------- */
  if (!ready || !character) {
    return (
      <View style={[s.safe, s.center]}>
        <Text style={s.hint}>Starting up…</Text>
      </View>
    );
  }

  if (pending) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.safe}>
          <AfterAction
            summary={pending.summary}
            validation={pending.validation}
            result={pending.result}
            log={pending.log}
            character={character}
            onCommit={commit}
            onDiscard={() => setPending(null)}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const prog = levelFromXp(character.xp || 0);
  const region = REGIONS[character.regionId];

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.wrap}>
          <Text style={s.eyebrow}>Trailbound · {region?.name}</Text>
          <Text style={s.h1}>{recording ? "Recording" : "Ready"}</Text>

          <View style={s.statRow}>
            <Stat label="Level" v={prog.level} />
            <Stat label="Condition" v={character.condition} />
            <Stat label="Hikes" v={character.hikes} />
            <Stat label="Vertical" v={`${(character.totalGain || 0).toLocaleString()} ft`} />
          </View>

          {recording && (
            <>
              <Text style={s.timer}>{fmt(elapsed)}</Text>
              <Text style={s.hint}>
                {mode === "foreground-only"
                  ? "Foreground only — keep the app open."
                  : "Put the phone away. The screen can sleep — the route keeps recording."}
              </Text>
            </>
          )}

          <Pressable onPress={recording ? end : begin} disabled={busy}
            style={[s.btn, recording && s.btnStop, busy && s.btnBusy]}>
            <Text style={s.btnText}>
              {busy ? "Working…" : recording ? "Finish hike" : "Start hike"}
            </Text>
          </Pressable>

          {banner && (
            <View style={s.banner}>
              <Text style={s.bannerText}>{banner}</Text>
            </View>
          )}

          {err && (
            <View style={s.errBox}>
              <Text style={s.errTitle}>Something went wrong</Text>
              <Text style={s.errText}>{err}</Text>
            </View>
          )}

          {!recording && character.hikes > 0 && (
            <Text style={s.note}>
              {Object.values(character.nemeses || {}).filter(n => !n.defeated && n.turnbacks > 0).length}
              {" "}open account(s) · {(character.stash || []).length} items in the stash
            </Text>
          )}

          <Pressable onPress={wipe} style={s.linkBtn}>
            <Text style={s.linkText}>Reset character</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const fmt = sec => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};

const Stat = ({ label, v }) => (
  <View style={s.stat}>
    <Text style={s.statLabel}>{label}</Text>
    <Text style={s.statValue}>{String(v)}</Text>
  </View>
);

const s = StyleSheet.create({
  safe:{ flex:1, backgroundColor:C.paper },
  center:{ justifyContent:"center", alignItems:"center" },
  wrap:{ padding:22, paddingBottom:60 },
  eyebrow:{ fontSize:10, letterSpacing:2, textTransform:"uppercase", color:C.contour },
  h1:{ fontSize:32, fontWeight:"700", color:C.ink, marginTop:2 },

  statRow:{ flexDirection:"row", marginTop:16, borderWidth:1, borderColor:"#C4A882" },
  stat:{ flex:1, padding:10, backgroundColor:C.paperDeep },
  statLabel:{ fontSize:8.5, letterSpacing:1.2, textTransform:"uppercase", color:C.inkSoft },
  statValue:{ fontSize:16, fontWeight:"700", color:C.ink, marginTop:2,
              fontVariant:["tabular-nums"] },

  timer:{ fontSize:44, fontVariant:["tabular-nums"], color:C.ink, marginTop:18 },
  hint:{ fontSize:14, color:C.inkSoft, marginTop:8, lineHeight:20 },

  btn:{ marginTop:24, backgroundColor:C.ink, paddingVertical:17, alignItems:"center" },
  btnStop:{ backgroundColor:C.danger },
  btnBusy:{ opacity:0.5 },
  btnText:{ color:C.paper, fontSize:15, letterSpacing:2,
            textTransform:"uppercase", fontWeight:"600" },

  banner:{ marginTop:18, borderWidth:1, borderColor:C.contour,
           backgroundColor:"#FFF8E8", padding:13 },
  bannerText:{ fontSize:14, color:C.ink, lineHeight:20 },

  errBox:{ marginTop:18, borderWidth:1, borderColor:C.danger,
           backgroundColor:"#FBEDEA", padding:13 },
  errTitle:{ fontSize:11, letterSpacing:1.4, textTransform:"uppercase", color:C.danger },
  errText:{ fontSize:14, color:C.ink, marginTop:5, lineHeight:20 },

  note:{ marginTop:20, fontSize:13, color:C.inkSoft, fontStyle:"italic", lineHeight:19 },
  linkBtn:{ marginTop:26, alignItems:"center", paddingVertical:8 },
  linkText:{ fontSize:12, color:C.inkSoft, textDecorationLine:"underline" },
});
