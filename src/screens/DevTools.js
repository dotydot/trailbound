/* ------------------------------------------------------------
   src/screens/DevTools.js

   The tuning loop. Every hike stays on the device as raw points
   plus raw pressure, so any of them can be RE-RESOLVED against
   the current constants. Change a number in rules.js, come back
   here, and see what that number would have done to every hike
   you've ever taken.

   Also exports: summary text, full JSON, and character state.
   ------------------------------------------------------------ */

import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Share, Alert } from "react-native";

import {
  listTracks, loadFullTrack, deleteTrack, dbStats,
} from "../tracking/locationTask";
import { summarizeTrack, validate, downsample } from "../tracking/trackMath";
import { resolveHike, TUNING, MITIGATIONS, levelFromXp } from "../game/rules";
import { buildLog, CORE_PACK } from "../game/narrative";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6", sheet:"#F5F6EC",
  contour:"#9C6B3F", contourFaint:"#C4A882",
  ink:"#1E3A2F", inkSoft:"#4A6355",
  danger:"#A63D2E", ok:"#3F7A52", water:"#4A7C94", gold:"#B0682A",
};

export default function DevTools({ character, onClose, onWipe }) {
  const [tracks, setTracks] = useState([]);
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(null);      // re-resolved track detail
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      setTracks(await listTracks(40));
      setStats(await dbStats());
    } catch (e) { setMsg(`Load failed: ${e.message}`); }
  }

  /* ---------- re-resolve a stored hike against current constants ---------- */
  async function reResolve(id) {
    setBusy(true); setMsg(null);
    try {
      const full = await loadFullTrack(id);
      const summary = summarizeTrack(full.points, {
        startedAt: full.started_at,
        baroSamples: downsample(full.baro, 5000),
        stepCount: full.step_count ?? null,
      });
      const v = validate(summary, { xpToday: 0 });
      const result = summary.ok
        ? resolveHike(summary, character, { trackPoints: full.points, seed: `${id}-${full.started_at}` })
        : null;
      const log = result ? buildLog(result, summary, character, [CORE_PACK], { seed: id }) : [];
      setOpen({ id, full, summary, validation: v, result, log });
    } catch (e) {
      setMsg(`Re-resolve failed: ${e.message}`);
    }
    setBusy(false);
  }

  /* ---------- exports ---------- */
  async function shareSummary() {
    if (!open) return;
    const { summary: s, validation: v, result: r } = open;
    const lines = [
      `TRAILBOUND TRACK ${open.id}`,
      `recorded ${new Date(open.full.started_at).toISOString()}`,
      ``,
      `distance      ${s.distance} mi`,
      `gain          ${s.gain} ft   (${s.gainSource})`,
      `loss          ${s.loss} ft`,
      `peak / low    ${s.maxElev} / ${s.minElev} ft   (${s.elevSource})`,
      `moving time   ${s.durationHr} hr   pace ${s.mph} mph`,
      `raw gain      ${s.rawGain} ft   filtered ${s.noiseShed} ft`,
      `baro offset   ${s.baroOffsetFt ?? "n/a"} ft   implied SLP ${s.impliedSeaLevelHPa ?? "n/a"} hPa`,
      `points        ${s.pointCount} kept, ${s.droppedPoints} dropped`,
      `rejected      stale ${s.rejected.stale} · accuracy ${s.rejected.accuracy} · teleport ${s.rejected.teleport}`,
      `steps         ${s.stepCount ?? "n/a"}`,
      `baro samples  ${open.full.baro.length}`,
      ``,
      `verdict       ${v.ok ? "ACCEPTED" : "REJECTED"}`,
      ...v.flags.map(f => `  [${f.level}] ${f.t} — ${f.d}`),
      ``,
      ...(r ? [
        `ENGINE (current constants)`,
        `energy miles  ${r.effort}`,
        `challenge     ${r.challengeRating}`,
        `encounters    ${r.encounters.length}  (${r.tally.cleared}C / ${r.tally.costly}X / ${r.tally.turnback}T)`,
        `named/settled ${r.tally.named} / ${r.tally.settled}`,
        `xp            ${r.xp.total}  (enc ${r.xp.encounterXp} + terrain ${r.xp.terrainXp} + summit ${r.xp.summitXp})`,
        `level after   ${levelFromXp((character.xp||0) + r.xp.total).level}  (from ${levelFromXp(character.xp||0).level})`,
        `condition     -${r.conditionSpent}`,
        `drops         ${r.drops.length}`,
        ``,
        `TUNING SNAPSHOT`,
        `xpPerEnergyMile ${TUNING.xpPerEnergyMile} · conditionPerEnergyMile ${TUNING.conditionPerEnergyMile}`,
        `ratingBase ${TUNING.ratingBase} · ratingSlope ${TUNING.ratingSlopePer1000ft}`,
        `maxTurnbackFraction ${TUNING.maxTurnbackFraction} · clearMargin ${TUNING.clearMargin}`,
        `mitigations: gear ${MITIGATIONS.diminishingGear} · tiers ${MITIGATIONS.campaignTiers} · level ${MITIGATIONS.levelTerm}`,
      ] : ["ENGINE — not resolved (track rejected)"]),
    ].join("\n");
    try { await Share.share({ title:`Track ${open.id}`, message: lines }); }
    catch (e) { Alert.alert("Share failed", e.message); }
  }

  async function shareFullJson() {
    if (!open) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      trackId: open.id,
      startedAt: open.full.started_at,
      endedAt: open.full.ended_at,
      stepCount: open.full.step_count,
      summary: open.summary,
      validation: open.validation,
      engine: open.result ? {
        effort: open.result.effort,
        challengeRating: open.result.challengeRating,
        tally: open.result.tally,
        xp: open.result.xp,
        conditionSpent: open.result.conditionSpent,
        encounters: open.result.encounters.map(e => ({
          mile:e.mile, elevation:e.elevation, biome:e.biomeKey, mob:e.mob,
          outcome:e.outcome, rating:e.rating, effPower:e.effPower, xp:e.xp,
          elite:e.elite, softened:e.softened,
        })),
      } : null,
      log: open.log.filter(e => e.text).map(e => ({
        moment:e.moment, mile:e.mile, elevation:e.elevation, text:e.text,
      })),
      tuning: TUNING,
      mitigations: MITIGATIONS,
      points: open.full.points,
      baro: open.full.baro,
    };
    const json = JSON.stringify(payload);
    console.log("=== TRAILBOUND EXPORT ===");
    console.log(json);
    console.log("=== END ===");
    try { await Share.share({ title:`Track ${open.id} JSON`, message: json }); }
    catch (e) { Alert.alert("Share failed — copy it from the Metro terminal instead", e.message); }
  }

  async function shareCharacter() {
    const json = JSON.stringify(character, null, 1);
    console.log("=== TRAILBOUND CHARACTER ===");
    console.log(json);
    try { await Share.share({ title:"Character", message: json }); }
    catch (e) { Alert.alert("Share failed", e.message); }
  }

  function confirmDelete(id) {
    Alert.alert("Delete track?", `Track ${id} and all its points and pressure samples.`, [
      { text:"Cancel", style:"cancel" },
      { text:"Delete", style:"destructive", onPress: async () => {
          await deleteTrack(id);
          if (open?.id === id) setOpen(null);
          refresh();
        } },
    ]);
  }

  /* ---------- detail view ---------- */
  if (open) {
    const { summary: s, validation: v, result: r } = open;
    return (
      <ScrollView contentContainerStyle={st.wrap}>
        <Pressable onPress={() => setOpen(null)} style={st.back}>
          <Text style={st.backText}>← All tracks</Text>
        </Pressable>

        <Text style={st.eyebrow}>Track {open.id}</Text>
        <Text style={st.h1}>{s.ok ? `${s.distance} mi · ${s.gain} ft` : "Unusable"}</Text>
        <Text style={st.sub}>{new Date(open.full.started_at).toLocaleString()}</Text>

        <Text style={st.section}>Measurement</Text>
        <View style={st.box}>
          <Row k="Distance" v={`${s.distance} mi`} />
          <Row k="Gain / loss" v={`${s.gain} / ${s.loss} ft`} />
          <Row k="Gain source" v={s.gainSource} />
          <Row k="Peak / low" v={`${s.maxElev} / ${s.minElev} ft`} />
          <Row k="Elevation source" v={s.elevSource} />
          <Row k="Baro offset" v={s.baroOffsetFt != null ? `${s.baroOffsetFt} ft` : "n/a"}
            note={s.impliedSeaLevelHPa ? `implies ${s.impliedSeaLevelHPa} hPa` : null} />
          <Row k="Raw gain / filtered" v={`${s.rawGain} / ${s.noiseShed} ft`} />
          <Row k="Moving time / pace" v={`${s.durationHr} hr · ${s.mph} mph`} />
          <Row k="Points kept" v={`${s.pointCount} (${s.droppedPoints} dropped)`} />
          <Row k="Stale / teleport" v={`${s.rejected.stale} / ${s.rejected.teleport}`} />
          <Row k="Steps" v={s.stepCount ?? "n/a"} />
          <Row k="Baro samples" v={open.full.baro.length} />
        </View>

        <Text style={st.section}>Gates</Text>
        <View style={[st.box, !v.ok && st.boxBad]}>
          {v.flags.map((f, i) => (
            <View key={i} style={st.flag}>
              <Text style={[st.flagLevel, { color: f.level === "reject" ? C.danger
                : f.level === "warn" ? C.contour : C.inkSoft }]}>{f.level}</Text>
              <Text style={st.flagText}>{f.t} — {f.d}</Text>
            </View>
          ))}
        </View>

        {r && (
          <>
            <Text style={st.section}>Engine, current constants</Text>
            <View style={st.box}>
              <Row k="Energy miles" v={r.effort} />
              <Row k="Challenge rating" v={r.challengeRating} />
              <Row k="Encounters" v={`${r.encounters.length}`} />
              <Row k="Outcomes" v={`${r.tally.cleared}C / ${r.tally.costly}X / ${r.tally.turnback}T`} />
              <Row k="Turnback share"
                v={`${Math.round(r.tally.turnback / r.encounters.length * 100)}%`}
                note={`cap ${Math.round(TUNING.maxTurnbackFraction * 100)}%`} />
              <Row k="XP" v={r.xp.total} note={`${r.xp.encounterXp}+${r.xp.terrainXp}+${r.xp.summitXp}`} />
              <Row k="Level after" v={levelFromXp((character.xp||0)+r.xp.total).level}
                note={`from ${levelFromXp(character.xp||0).level}`} />
              <Row k="Condition cost" v={`−${r.conditionSpent}`} />
              <Row k="Drops" v={r.drops.length} />
              <Row k="Named / settled" v={`${r.tally.named} / ${r.tally.settled}`} />
            </View>

            <Text style={st.section}>Encounters</Text>
            <View style={st.box}>
              {r.encounters.map(e => (
                <View key={e.index} style={st.encRow}>
                  <Text style={st.encMeta}>{e.elevation} ft</Text>
                  <Text style={st.encName}>{e.mob}{e.elite ? " ★" : ""}</Text>
                  <Text style={[st.encOut, { color: e.outcome === "turnback" ? C.danger
                    : e.outcome === "costly" ? C.contour : C.ok }]}>
                    {e.outcome}{e.softened ? "*" : ""}
                  </Text>
                  <Text style={st.encNum}>{e.effPower}/{e.rating}</Text>
                </View>
              ))}
              <Text style={st.hint}>* softened by the turnback cap · power/rating</Text>
            </View>
          </>
        )}

        <View style={st.btnRow}>
          <Pressable onPress={shareSummary} style={st.btn}>
            <Text style={st.btnText}>Share summary</Text>
          </Pressable>
          <Pressable onPress={shareFullJson} style={st.btn}>
            <Text style={st.btnText}>Share JSON</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => reResolve(open.id)} style={st.btnGhost}>
          <Text style={st.btnGhostText}>Re-resolve with current constants</Text>
        </Pressable>
      </ScrollView>
    );
  }

  /* ---------- list view ---------- */
  return (
    <ScrollView contentContainerStyle={st.wrap}>
      <Text style={st.eyebrow}>Trailbound · dev tools</Text>
      <Text style={st.h1}>Tracks</Text>
      {stats && (
        <Text style={st.sub}>
          {stats.tracks} tracks · {stats.points.toLocaleString()} points ·
          {" "}{stats.baro.toLocaleString()} pressure samples
        </Text>
      )}

      {msg && <View style={st.msgBox}><Text style={st.msgText}>{msg}</Text></View>}

      <Text style={st.section}>Character</Text>
      <View style={st.box}>
        <Row k="Level" v={levelFromXp(character.xp || 0).level} note={`${character.xp||0} xp`} />
        <Row k="Hikes" v={character.hikes || 0} />
        <Row k="Condition" v={character.condition ?? 100} />
        <Row k="Gear power" v={Object.values(character.gear||{}).reduce((a,b)=>a+(b.power||0),0)} />
        <Row k="Open accounts"
          v={Object.values(character.nemeses||{}).filter(n=>!n.defeated&&n.turnbacks>0).length} />
        <Row k="Stash" v={(character.stash||[]).length} />
      </View>
      <Pressable onPress={shareCharacter} style={st.btnGhost}>
        <Text style={st.btnGhostText}>Share character JSON</Text>
      </Pressable>

      <Text style={st.section}>Recorded hikes</Text>
      {tracks.length === 0 ? (
        <Text style={st.hint}>Nothing recorded yet.</Text>
      ) : tracks.map(t => (
        <View key={t.id} style={st.trackRow}>
          <View style={{ flex:1 }}>
            <Text style={st.trackTitle}>
              #{t.id} · {new Date(t.started_at).toLocaleDateString()}{" "}
              {new Date(t.started_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}
            </Text>
            <Text style={st.trackMeta}>
              {t.point_count} points · {t.baro_count} baro · {t.status}
              {t.baro_count === 0 ? " · no pressure data" : ""}
            </Text>
          </View>
          <Pressable onPress={() => reResolve(t.id)} style={st.smallBtn} disabled={busy}>
            <Text style={st.smallBtnText}>{busy ? "…" : "Open"}</Text>
          </Pressable>
          <Pressable onPress={() => confirmDelete(t.id)} style={st.smallBtnGhost}>
            <Text style={st.smallBtnGhostText}>✕</Text>
          </Pressable>
        </View>
      ))}

      <Text style={st.hint}>
        Every hike keeps its raw points and pressure samples, so changing a
        constant in rules.js and reopening a track shows what that change would
        have done. Nothing here alters your character.
      </Text>

      {onWipe && (
        <Pressable onPress={onWipe} style={st.wipeBtn}>
          <Text style={st.wipeText}>Reset character</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const Row = ({ k, v, note }) => (
  <View style={st.row}>
    <Text style={st.rowK}>{k}</Text>
    <View style={{ alignItems:"flex-end" }}>
      <Text style={st.rowV}>{String(v)}</Text>
      {note ? <Text style={st.rowNote}>{note}</Text> : null}
    </View>
  </View>
);

const st = StyleSheet.create({
  wrap:{ padding:20, paddingBottom:70, backgroundColor:C.paper },
  back:{ paddingVertical:6, marginBottom:6 },
  backText:{ fontSize:13, color:C.water },
  eyebrow:{ fontSize:10, letterSpacing:2, textTransform:"uppercase", color:C.contour },
  h1:{ fontSize:26, fontWeight:"700", color:C.ink, marginTop:2 },
  sub:{ fontSize:12.5, color:C.inkSoft, marginTop:3 },
  section:{ fontSize:10.5, letterSpacing:1.8, textTransform:"uppercase",
            color:C.contour, marginTop:22, marginBottom:7 },
  box:{ borderWidth:1, borderColor:C.contourFaint, backgroundColor:C.paperDeep,
        paddingHorizontal:12, paddingVertical:4 },
  boxBad:{ borderColor:C.danger, backgroundColor:"#FBEDEA" },
  row:{ flexDirection:"row", justifyContent:"space-between", alignItems:"flex-start",
        paddingVertical:6, borderBottomWidth:1, borderBottomColor:"rgba(0,0,0,0.06)" },
  rowK:{ fontSize:12.5, color:C.inkSoft, flex:1 },
  rowV:{ fontSize:12.5, color:C.ink, fontWeight:"600", fontVariant:["tabular-nums"] },
  rowNote:{ fontSize:10, color:C.inkSoft, fontStyle:"italic" },
  flag:{ flexDirection:"row", gap:8, paddingVertical:6 },
  flagLevel:{ fontSize:8.5, letterSpacing:1.1, textTransform:"uppercase", width:44 },
  flagText:{ flex:1, fontSize:12, color:C.inkSoft, lineHeight:17 },
  encRow:{ flexDirection:"row", alignItems:"center", gap:8, paddingVertical:5,
           borderBottomWidth:1, borderBottomColor:"rgba(0,0,0,0.06)" },
  encMeta:{ fontSize:11, color:C.inkSoft, width:58, fontVariant:["tabular-nums"] },
  encName:{ fontSize:12.5, color:C.ink, flex:1 },
  encOut:{ fontSize:10, letterSpacing:0.8, textTransform:"uppercase", width:62 },
  encNum:{ fontSize:10.5, color:C.inkSoft, fontVariant:["tabular-nums"] },
  trackRow:{ flexDirection:"row", alignItems:"center", gap:9, paddingVertical:10,
             borderBottomWidth:1, borderBottomColor:C.contourFaint },
  trackTitle:{ fontSize:13.5, color:C.ink, fontWeight:"600" },
  trackMeta:{ fontSize:11, color:C.inkSoft, marginTop:2 },
  smallBtn:{ borderWidth:1, borderColor:C.ink, paddingHorizontal:12, paddingVertical:7 },
  smallBtnText:{ fontSize:11, color:C.ink, letterSpacing:1, textTransform:"uppercase" },
  smallBtnGhost:{ paddingHorizontal:8, paddingVertical:7 },
  smallBtnGhostText:{ fontSize:14, color:C.danger },
  btnRow:{ flexDirection:"row", gap:10, marginTop:22 },
  btn:{ flex:1, backgroundColor:C.ink, paddingVertical:14, alignItems:"center" },
  btnText:{ color:C.paper, fontSize:12, letterSpacing:1.6,
            textTransform:"uppercase", fontWeight:"600" },
  btnGhost:{ marginTop:11, borderWidth:1, borderColor:C.contour,
             paddingVertical:12, alignItems:"center" },
  btnGhostText:{ color:C.contour, fontSize:11.5, letterSpacing:1.4, textTransform:"uppercase" },
  msgBox:{ marginTop:12, borderWidth:1, borderColor:C.danger,
           backgroundColor:"#FBEDEA", padding:11 },
  msgText:{ fontSize:12.5, color:C.ink },
  hint:{ marginTop:16, fontSize:12, color:C.inkSoft, fontStyle:"italic", lineHeight:18 },
  wipeBtn:{ marginTop:22, borderWidth:1, borderColor:C.danger,
            paddingVertical:12, alignItems:"center" },
  wipeText:{ fontSize:11.5, color:C.danger, letterSpacing:1.4, textTransform:"uppercase" },
});
