/* ------------------------------------------------------------
   App.js
   Four tabs: hike, accounts, badges, dev tools.
   The after-action report takes over the whole screen when a
   hike resolves — it is the only modal moment in the app.
   ------------------------------------------------------------ */

import React, { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Barometer, Pedometer } from "expo-sensors";
import { deactivateKeepAwake } from "expo-keep-awake";

import {
  initDb, requestPermissions, startTracking, stopTracking,
  loadTrack, activeTrackId, saveBaroSamples, saveStepCount,
} from "./src/tracking/locationTask";
import { summarizeTrack, validate, downsample } from "./src/tracking/trackMath";

import {
  resolveHike, commitHike, REGIONS, levelFromXp,
  CAMPAIGNS, chapterSatisfied, resolveRequirement, requirementLabel,
} from "./src/game/rules";
import { buildLog, CORE_PACK } from "./src/game/narrative";
import {
  initCharacterTable, loadCharacter, saveCharacter, resetCharacter,
  applyElapsed, applyDailyCap, awardBadges,
} from "./src/game/character";

import AfterAction from "./src/screens/AfterAction";
import DevTools from "./src/screens/DevTools";
import Accounts from "./src/screens/Accounts";
import Badges from "./src/screens/Badges";
import Campaign from "./src/screens/Campaign";
import TabBar from "./src/screens/TabBar";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6", contour:"#9C6B3F",
  ink:"#1E3A2F", inkSoft:"#4A6355", danger:"#A63D2E", ok:"#3F7A52", water:"#4A7C94",
};

const TABS = [
  { key:"hike",     label:"Hike",     icon:"hike" },
  { key:"campaign", label:"Story",    icon:"story" },
  { key:"accounts", label:"Accounts", icon:"accounts" },
  { key:"badges",   label:"Character",icon:"badges" },
  { key:"dev",      label:"Dev",      icon:"dev" },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [character, setCharacter] = useState(null);
  const [tab, setTab] = useState("hike");
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(null);
  const [banner, setBanner] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const baroSamples = useRef([]);
  const baroSub = useRef(null);
  const pedoSub = useRef(null);
  const steps = useRef(0);
  const startedAt = useRef(null);
  const timer = useRef(null);

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
      } catch (e) { setErr(`Startup failed: ${e.message}`); }
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
          Barometer.setUpdateInterval(5000);
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
      setElapsed(0); setRecording(true); setPending(null);
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
      if (!trackId) { setErr("No active track to close."); setBusy(false); return; }

      const trimmed = downsample(baroSamples.current, 5000);
      await saveBaroSamples(trackId, trimmed);
      await saveStepCount(trackId, steps.current || null);

      const track = await loadTrack(trackId);
      const summary = summarizeTrack(track.points, {
        startedAt: track.started_at,
        baroSamples: trimmed,
        stepCount: steps.current || null,
      });
      const validation = validate(summary, { mocked:false, xpToday: character.dailyXp || 0 });
      const result = resolveHike(summary, character, {
        trackPoints: track.points,
        seed: `${trackId}-${track.started_at}`,
      });
      const log = buildLog(result, summary, character, [CORE_PACK], { seed: trackId });

      setPending({ summary, validation, result, log, trackId });
      console.log("[trailbound] resolved track", trackId, summary);
    } catch (e) {
      setErr(`Couldn't finish the hike: ${e.message}`);
      setRecording(false);
    }
    setBusy(false);
  }

  async function commit(hauledIds) {
    if (!pending) return;
    try {
      let next = commitHike(character, pending.result, pending.summary, hauledIds);
      const capped = applyDailyCap(next, pending.result.xp.total);
      next = capped.character;
      if (capped.capped) next.xp = (character.xp || 0) + capped.granted;

      const withBadges = awardBadges(next);
      next = withBadges.character;
      next.conditionUpdatedAt = Date.now();

      /* did this hike advance the story?
         Checked AFTER commitHike so the personal ladder sees the new bests —
         a hike that sets a new record should count toward the chapter it just
         set the record for, not the one before it. */
      let chapterMsg = null;
      const campaign = CAMPAIGNS[next.activeCampaign];
      const chapter = campaign?.chapters?.[next.activeChapter];
      if (chapter && !next.chapterComplete) {
        const check = chapterSatisfied(chapter, character, pending.summary, {
          season: next.season || "summer",
          restDays: 0,
        });
        if (check.ok) {
          next.chapterComplete = true;
          next.chapterHistory = [...(next.chapterHistory || []), {
            id: chapter.id, ch: chapter.ch, title: chapter.title,
            distance: pending.summary.distance, gain: pending.summary.gain,
            at: Date.now(),
          }];
          chapterMsg = `Chapter ${chapter.ch} complete.`;
        } else if (check.shortfall.length) {
          chapterMsg = `Chapter ${chapter.ch}: ${check.shortfall.join(", ")}.`;
        }
      }

      await saveCharacter(next);
      setCharacter(next);
      setPending(null);

      const bits = [];
      if (pending.result.levelUp) bits.push(`Level ${pending.result.levelUp}.`);
      if (withBadges.earned.length)
        bits.push(`Badges: ${withBadges.earned.map(b => b.name).join(", ")}.`);
      if (capped.capped) bits.push("Daily XP cap reached.");
      if (pending.result.tally.named) bits.push("Something has your name now.");
      if (pending.result.tally.settled) bits.push("Account settled.");
      if (chapterMsg) bits.push(chapterMsg);
      setBanner(bits.join(" ") || "Hike recorded.");
      if (next.chapterComplete) setTab("campaign");
    } catch (e) { setErr(`Couldn't save: ${e.message}`); }
  }

  /* ---------- campaign ---------- */
  async function startCampaign(id) {
    const camp = id ? CAMPAIGNS[id] : null;
    const next = {
      ...character,
      activeCampaign: camp ? camp.id : null,
      activeChapter: camp ? camp.start : null,
      chapterComplete: false,
      chapterHistory: camp ? (character.chapterHistory || []) : [],
    };
    await saveCharacter(next);
    setCharacter(next);
    setBanner(camp ? `${camp.name} begun.` : "Campaign abandoned. Character kept.");
  }

  async function chooseBranch(chapterId) {
    const next = {
      ...character,
      activeChapter: chapterId,
      chapterComplete: false,
    };
    await saveCharacter(next);
    setCharacter(next);
    const camp = CAMPAIGNS[next.activeCampaign];
    const ch = camp?.chapters?.[chapterId];
    setBanner(ch ? `Next: ${ch.title}.` : "Objective set.");
    setTab("hike");
  }

  async function setRegion(regionId) {
    const next = { ...character, regionId };
    await saveCharacter(next);
    setCharacter(next);
    setBanner(`Region set to ${REGIONS[regionId]?.name}.`);
  }

  async function setSeason(season) {
    const next = { ...character, season };
    await saveCharacter(next);
    setCharacter(next);
  }

  function wipe() {
    Alert.alert("Reset character?", "Tracks are kept. Progress is not.", [
      { text:"Cancel", style:"cancel" },
      { text:"Reset", style:"destructive", onPress: async () => {
          const fresh = await resetCharacter();
          setCharacter(fresh); setPending(null);
          setBanner("Character reset. Tracks kept.");
        } },
    ]);
  }

  if (!ready || !character) {
    return <View style={[s.safe, s.center]}><Text style={s.hint}>Starting up…</Text></View>;
  }

  /* the after-action report takes the whole screen */
  if (pending) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={s.safe}>
          <AfterAction
            summary={pending.summary} validation={pending.validation}
            result={pending.result} log={pending.log} character={character}
            onCommit={commit} onDiscard={() => setPending(null)} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const openCount = Object.values(character.nemeses || {})
    .filter(n => !n.defeated && n.turnbacks > 0).length;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
        <View style={{ flex:1 }}>
          {tab === "hike" && (
            <HikeTab
              character={character} recording={recording} mode={mode}
              elapsed={elapsed} busy={busy} banner={banner} err={err}
              onStart={begin} onStop={end} openCount={openCount}
              onGoCampaign={() => setTab("campaign")} />
          )}
          {tab === "campaign" && (
            <Campaign
              character={character}
              onStart={startCampaign}
              onChoose={chooseBranch}
              onSetRegion={setRegion}
              onSetSeason={setSeason} />
          )}
          {tab === "accounts" && <Accounts character={character} />}
          {tab === "badges" && <Badges character={character} />}
          {tab === "dev" && (
            <DevTools character={character} onClose={() => setTab("hike")}
              onWipe={wipe} />
          )}
        </View>
        <TabBar tabs={TABS} active={tab} onChange={setTab}
          badges={{ accounts: openCount,
                    campaign: character.chapterComplete ? 1 : 0 }} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/* ---------- the hike tab ---------- */
function HikeTab({ character, recording, mode, elapsed, busy, banner, err,
                   onStart, onStop, openCount, onGoCampaign }) {
  const prog = levelFromXp(character.xp || 0);
  const region = REGIONS[character.regionId];

  const campaign = CAMPAIGNS[character.activeCampaign];
  const chapter = campaign?.chapters?.[character.activeChapter];
  const objective = chapter
    ? resolveRequirement(chapter, character, { season: character.season || "summer" })
    : null;

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.eyebrow}>Trailbound · {region?.name}</Text>
      <Text style={s.h1}>{recording ? "Recording" : "Ready"}</Text>

      <View style={s.statRow}>
        <Stat label="Level" v={prog.level} />
        <Stat label="Condition" v={character.condition} />
        <Stat label="Hikes" v={character.hikes} />
        <Stat label="Vertical" v={(character.totalGain || 0).toLocaleString()} />
      </View>

      {/* the objective: the reason to hike THIS hike */}
      {!recording && (
        <Pressable onPress={onGoCampaign} style={s.objBox}>
          {chapter ? (
            <>
              <Text style={s.objLabel}>
                {character.chapterComplete
                  ? `Chapter ${chapter.ch} complete — choose where next`
                  : `Chapter ${chapter.ch} · ${chapter.title}`}
              </Text>
              {!character.chapterComplete && (
                <Text style={s.objValue}>{requirementLabel(objective?.easiest)}</Text>
              )}
            </>
          ) : (
            <>
              <Text style={s.objLabel}>No story running</Text>
              <Text style={s.objValue}>Start a campaign</Text>
            </>
          )}
        </Pressable>
      )}

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

      <Pressable onPress={recording ? onStop : onStart} disabled={busy}
        style={[s.btn, recording && s.btnStop, busy && s.btnBusy]}>
        <Text style={s.btnText}>
          {busy ? "Working…" : recording ? "Finish hike" : "Start hike"}
        </Text>
      </Pressable>

      {banner && <View style={s.banner}><Text style={s.bannerText}>{banner}</Text></View>}

      {err && (
        <View style={s.errBox}>
          <Text style={s.errTitle}>Something went wrong</Text>
          <Text style={s.errText}>{err}</Text>
        </View>
      )}

      {!recording && character.hikes > 0 && (
        <Text style={s.note}>
          {openCount > 0
            ? `${openCount} open account${openCount > 1 ? "s" : ""} waiting. Something up there remembers you.`
            : "Nothing has beaten you yet."}
        </Text>
      )}
    </ScrollView>
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
  wrap:{ padding:22, paddingBottom:40 },
  eyebrow:{ fontSize:10, letterSpacing:2, textTransform:"uppercase", color:C.contour },
  h1:{ fontSize:32, fontWeight:"700", color:C.ink, marginTop:2 },
  statRow:{ flexDirection:"row", marginTop:16, borderWidth:1, borderColor:"#C4A882" },
  stat:{ flex:1, padding:10, backgroundColor:C.paperDeep },
  statLabel:{ fontSize:8.5, letterSpacing:1.2, textTransform:"uppercase", color:C.inkSoft },
  statValue:{ fontSize:16, fontWeight:"700", color:C.ink, marginTop:2, fontVariant:["tabular-nums"] },
  timer:{ fontSize:44, fontVariant:["tabular-nums"], color:C.ink, marginTop:18 },
  hint:{ fontSize:14, color:C.inkSoft, marginTop:8, lineHeight:20 },
  btn:{ marginTop:24, backgroundColor:C.ink, paddingVertical:17, alignItems:"center" },
  btnStop:{ backgroundColor:C.danger },
  btnBusy:{ opacity:0.5 },
  btnText:{ color:C.paper, fontSize:15, letterSpacing:2, textTransform:"uppercase", fontWeight:"600" },
  banner:{ marginTop:18, borderWidth:1, borderColor:C.contour, backgroundColor:"#FFF8E8", padding:13 },
  bannerText:{ fontSize:14, color:C.ink, lineHeight:20 },
  errBox:{ marginTop:18, borderWidth:1, borderColor:C.danger, backgroundColor:"#FBEDEA", padding:13 },
  errTitle:{ fontSize:11, letterSpacing:1.4, textTransform:"uppercase", color:C.danger },
  errText:{ fontSize:14, color:C.ink, marginTop:5, lineHeight:20 },
  note:{ marginTop:20, fontSize:13, color:C.inkSoft, fontStyle:"italic", lineHeight:19 },
  objBox:{ marginTop:16, borderWidth:1, borderColor:C.contour,
           backgroundColor:"#FFF8E8", padding:13 },
  objLabel:{ fontSize:9.5, letterSpacing:1.3, textTransform:"uppercase", color:C.contour },
  objValue:{ fontSize:15, fontWeight:"700", color:C.ink, marginTop:4,
             fontVariant:["tabular-nums"] },
});
