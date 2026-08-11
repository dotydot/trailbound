/* ------------------------------------------------------------
   src/screens/AfterAction.js
   The only interactive surface in the app.

   Order matters: validation, then the log, then the profile with
   encounter pins, then haul-out, then rewards. The log comes
   before the numbers because the log is the point.
   ------------------------------------------------------------ */

import React, { useState, useMemo } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import Svg, { Path, Circle, Line, Rect } from "react-native-svg";

import { RARITY } from "../game/world";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6", sheet:"#F5F6EC",
  contour:"#9C6B3F", contourFaint:"#C4A882",
  ink:"#1E3A2F", inkSoft:"#4A6355",
  danger:"#A63D2E", ok:"#3F7A52", water:"#4A7C94", gold:"#B0682A",
};

export default function AfterAction({
  summary, validation, result, log, character, onCommit, onDiscard,
}) {
  const [hauled, setHauled] = useState(() => result.drops.map(d => d.id));

  const haulWeight = useMemo(
    () => result.drops.filter(d => hauled.includes(d.id)).reduce((s, d) => s + d.weight, 0),
    [hauled, result.drops]
  );
  const over = haulWeight > result.capacity;

  const toggle = id =>
    setHauled(h => (h.includes(id) ? h.filter(x => x !== id) : [...h, id]));

  if (!validation.ok) {
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.eyebrow}>Trailbound</Text>
        <Text style={s.h1}>Track rejected</Text>
        <View style={s.rejectBox}>
          {validation.flags.map((f, i) => (
            <View key={i} style={s.flag}>
              <Text style={[s.flagLevel, { color: levelColor(f.level) }]}>{f.level}</Text>
              <Text style={s.flagText}>{f.t} — {f.d}</Text>
            </View>
          ))}
        </View>
        <Text style={s.note}>
          Nothing was recorded against your character. The raw track is kept either way.
        </Text>
        <Pressable onPress={onDiscard} style={s.btn}>
          <Text style={s.btnText}>Back</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.eyebrow}>Trailbound</Text>
      <Text style={s.h1}>
        {summary.distance} mi · {summary.gain.toLocaleString()} ft
      </Text>
      <Text style={s.sub}>
        peak {summary.maxElev.toLocaleString()} ft · challenge {result.challengeRating} ·
        {" "}{result.effort} energy miles
      </Text>

      {/* validation strip, quiet */}
      <View style={s.strip}>
        {validation.flags.slice(0, 3).map((f, i) => (
          <Text key={i} style={s.stripText}>
            <Text style={{ color: levelColor(f.level) }}>{f.t}</Text> — {f.d}
          </Text>
        ))}
      </View>

      {/* THE LOG */}
      <Text style={s.section}>The walk</Text>
      <View style={s.logBox}>
        {log.filter(e => e.text).map((e, i) => (
          <View key={i} style={[
            s.entry,
            i > 0 && s.entryDivider,
            e.sub && s.entrySub,
            e.apex && s.entryApex,
            e.kind === "named" && s.entryNamed,
            e.kind === "settled" && s.entrySettled,
          ]}>
            <View style={s.entryMeta}>
              {e.mile != null && <Text style={s.metaText}>mi {Number(e.mile).toFixed(1)}</Text>}
              {e.elevation != null && (
                <Text style={s.metaText}>{e.elevation.toLocaleString()} ft</Text>
              )}
              {e.outcome && (
                <Text style={[s.metaTag, { color: outcomeColor(e.outcome) }]}>{e.outcome}</Text>
              )}
              {e.kind === "named" && <Text style={[s.metaTag, { color: C.danger }]}>named</Text>}
              {e.kind === "settled" && <Text style={[s.metaTag, { color: C.gold }]}>settled</Text>}
            </View>
            <Text style={[
              s.entryText,
              e.moment === "ambient" && s.entryAmbient,
              (e.kind === "named" || e.kind === "settled") && s.entryStrong,
            ]}>
              {e.text}
            </Text>
          </View>
        ))}
      </View>

      {/* profile with encounter pins */}
      <Text style={s.section}>Where it happened</Text>
      <ProfileChart result={result} />

      {/* haul out */}
      <Text style={s.section}>Haul out</Text>
      <View style={[s.haulBox, over && s.haulOver]}>
        <View style={s.haulHead}>
          <Text style={s.haulLabel}>What fits in the pack</Text>
          <Text style={[s.haulWeight, { color: over ? C.danger : C.ok }]}>
            {haulWeight} / {result.capacity} lb{over ? " · over" : ""}
          </Text>
        </View>

        {result.drops.length === 0 ? (
          <Text style={s.haulEmpty}>Nothing dropped. The mountain owes you nothing.</Text>
        ) : (
          <>
            <Text style={s.haulHint}>
              Anything you leave is gone. Tap to drop it.
            </Text>
            <View style={s.dropGrid}>
              {result.drops.map(d => {
                const on = hauled.includes(d.id);
                const col = RARITY[d.rarity].color;
                return (
                  <Pressable key={d.id} onPress={() => toggle(d.id)}
                    style={[s.drop, { borderColor: on ? col : C.contourFaint },
                            !on && s.dropOff]}>
                    <View style={s.dropTop}>
                      <Text style={[s.dropRarity, { color: col }]}>{d.rarity}</Text>
                      <Text style={s.dropPower}>{d.power} pwr</Text>
                    </View>
                    <Text style={s.dropName}>{d.name}</Text>
                    <Text style={s.dropMeta}>
                      {d.slot} · {d.weight} lb
                      {d.capacityGranted ? ` · +${d.capacityGranted} cap` : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </View>

      {/* rewards */}
      <Text style={s.section}>Earned</Text>
      <View style={s.rewards}>
        <Row k="Encounters" v={`${result.tally.cleared} cleared · ${result.tally.costly} costly · ${result.tally.turnback} turned back`} />
        <Row k="Encounter XP" v={result.xp.encounterXp.toLocaleString()} />
        <Row k="Terrain XP" v={result.xp.terrainXp.toLocaleString()} />
        <Row k="Summit XP" v={result.xp.summitXp.toLocaleString()} />
        {result.xp.intentionBonus > 0 && (
          <Row k="Declared route" v={`+${result.xp.intentionBonus.toLocaleString()}`} highlight />
        )}
        <Row k="Total XP" v={result.xp.total.toLocaleString()} strong />
        <Row k="Condition spent" v={`−${result.conditionSpent}`} />
        {result.levelUp && <Row k="Level reached" v={result.levelUp} highlight strong />}
        {result.tally.named > 0 && (
          <Row k="New open accounts" v={result.tally.named} highlight />
        )}
        {result.tally.settled > 0 && (
          <Row k="Accounts settled" v={result.tally.settled} highlight strong />
        )}
      </View>

      <Pressable onPress={() => !over && onCommit(hauled)} disabled={over}
        style={[s.btn, over && s.btnDisabled]}>
        <Text style={s.btnText}>{over ? "Pack is over capacity" : "Sign out"}</Text>
      </Pressable>

      <Pressable onPress={onDiscard} style={s.linkBtn}>
        <Text style={s.linkText}>Discard this resolve</Text>
      </Pressable>
    </ScrollView>
  );
}

/* ---------- profile chart ---------- */
function ProfileChart({ result }) {
  const W = 340, H = 130, padL = 34, padB = 18, padT = 16, padR = 6;
  const pts = result.profile;
  if (!pts?.length) return null;

  const maxFt = Math.max(...pts.map(p => p.ft)) * 1.12 + 20;
  const minFt = Math.min(...pts.map(p => p.ft)) * 0.92;
  const span = Math.max(1, maxFt - minFt);
  const maxMi = pts[pts.length - 1].mi || 1;

  const x = mi => padL + (mi / maxMi) * (W - padL - padR);
  const y = ft => H - padB - ((ft - minFt) / span) * (H - padB - padT);

  const line = pts.map((p, i) =>
    `${i ? "L" : "M"}${x(p.mi).toFixed(1)},${y(p.ft).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxMi).toFixed(1)},${H - padB} L${padL},${H - padB} Z`;

  return (
    <View style={s.chartBox}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={padL} y={padT} width={W - padL - padR} height={H - padB - padT}
          fill="none" stroke={C.contourFaint} strokeWidth="0.5" />
        <Path d={area} fill={C.contour} opacity={0.13} />
        <Path d={line} fill="none" stroke={C.ink} strokeWidth="1.6" />
        {result.encounters.map(e => {
          const cx = x(e.mile), cy = y(e.elevation);
          const pinTop = cy - (e.elite ? 16 : 10);
          const col = e.outcome === "turnback" ? C.danger : e.tint;
          return (
            <React.Fragment key={e.index}>
              <Line x1={cx} y1={cy} x2={cx} y2={pinTop}
                stroke={col} strokeWidth={e.elite ? 1.6 : 1} />
              <Circle cx={cx} cy={pinTop} r={e.elite ? 4 : 2.6}
                fill={col} stroke={C.sheet} strokeWidth="1" />
            </React.Fragment>
          );
        })}
      </Svg>
      <Text style={s.chartCaption}>
        {Math.round(minFt).toLocaleString()}–{Math.round(maxFt).toLocaleString()} ft ·
        {" "}pins mark contact, red marks a turnback
      </Text>
    </View>
  );
}

const levelColor = l => l === "reject" ? C.danger : l === "warn" ? C.contour : C.inkSoft;
const outcomeColor = o => o === "turnback" ? C.danger : o === "costly" ? C.contour : C.ok;

const Row = ({ k, v, strong, highlight }) => (
  <View style={s.row}>
    <Text style={s.rowK}>{k}</Text>
    <Text style={[s.rowV, strong && s.rowStrong, highlight && { color: C.gold }]}>
      {String(v)}
    </Text>
  </View>
);

const s = StyleSheet.create({
  wrap:{ padding:20, paddingBottom:70, backgroundColor:C.paper },
  eyebrow:{ fontSize:10, letterSpacing:2, textTransform:"uppercase", color:C.contour },
  h1:{ fontSize:28, fontWeight:"700", color:C.ink, marginTop:2 },
  sub:{ fontSize:13, color:C.inkSoft, marginTop:3 },

  strip:{ marginTop:14, paddingVertical:9, paddingHorizontal:11,
          backgroundColor:C.paperDeep, borderWidth:1, borderColor:C.contourFaint },
  stripText:{ fontSize:12, color:C.inkSoft, lineHeight:17, marginBottom:2 },

  section:{ fontSize:11, letterSpacing:1.8, textTransform:"uppercase",
            color:C.contour, marginTop:26, marginBottom:8 },

  logBox:{ borderWidth:1, borderColor:C.contourFaint, backgroundColor:C.sheet },
  entry:{ paddingVertical:11, paddingHorizontal:13 },
  entryDivider:{ borderTopWidth:1, borderTopColor:C.paperDeep },
  entrySub:{ paddingLeft:28 },
  entryApex:{ backgroundColor:"#FFF8E8" },
  entryNamed:{ backgroundColor:"#FBEDEA" },
  entrySettled:{ backgroundColor:"#FFF4DC" },
  entryMeta:{ flexDirection:"row", flexWrap:"wrap", alignItems:"center", gap:9 },
  metaText:{ fontSize:10, color:C.inkSoft, fontVariant:["tabular-nums"] },
  metaTag:{ fontSize:9, letterSpacing:1.1, textTransform:"uppercase" },
  entryText:{ fontSize:15, lineHeight:22, color:C.ink, marginTop:3 },
  entryAmbient:{ fontStyle:"italic", color:C.inkSoft },
  entryStrong:{ fontWeight:"600" },

  chartBox:{ borderWidth:1, borderColor:C.contourFaint, backgroundColor:C.sheet, padding:6 },
  chartCaption:{ fontSize:9.5, color:C.inkSoft, letterSpacing:0.6, marginTop:3, paddingLeft:2 },

  haulBox:{ borderWidth:2, borderColor:C.contour, padding:13 },
  haulOver:{ borderColor:C.danger },
  haulHead:{ flexDirection:"row", justifyContent:"space-between",
             alignItems:"baseline", flexWrap:"wrap", gap:6 },
  haulLabel:{ fontSize:10, letterSpacing:1.6, textTransform:"uppercase", color:C.contour },
  haulWeight:{ fontSize:14, fontWeight:"700", fontVariant:["tabular-nums"] },
  haulHint:{ fontSize:12.5, color:C.inkSoft, fontStyle:"italic", marginTop:6 },
  haulEmpty:{ fontSize:13, color:C.inkSoft, fontStyle:"italic", marginTop:8 },
  dropGrid:{ marginTop:11, gap:9 },
  drop:{ borderWidth:1, padding:11, backgroundColor:C.paper },
  dropOff:{ opacity:0.45 },
  dropTop:{ flexDirection:"row", justifyContent:"space-between", alignItems:"baseline" },
  dropRarity:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase" },
  dropPower:{ fontSize:11, fontWeight:"700", color:C.ink, fontVariant:["tabular-nums"] },
  dropName:{ fontSize:14, fontWeight:"600", color:C.ink, marginTop:3 },
  dropMeta:{ fontSize:10, color:C.inkSoft, marginTop:2 },

  rewards:{ borderWidth:1, borderColor:C.contourFaint, backgroundColor:C.paperDeep,
            paddingHorizontal:13, paddingVertical:5 },
  row:{ flexDirection:"row", justifyContent:"space-between", paddingVertical:7,
        borderBottomWidth:1, borderBottomColor:"rgba(0,0,0,0.06)" },
  rowK:{ fontSize:13, color:C.inkSoft, flex:1 },
  rowV:{ fontSize:13, color:C.ink, fontWeight:"600",
         fontVariant:["tabular-nums"], textAlign:"right" },
  rowStrong:{ fontSize:16 },

  rejectBox:{ marginTop:16, borderWidth:1, borderColor:C.danger,
              backgroundColor:"#FBEDEA", padding:13 },
  flag:{ flexDirection:"row", gap:9, marginBottom:7 },
  flagLevel:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase", width:48 },
  flagText:{ flex:1, fontSize:13, color:C.inkSoft, lineHeight:19 },
  note:{ marginTop:14, fontSize:12.5, fontStyle:"italic", color:C.inkSoft, lineHeight:18 },

  btn:{ marginTop:22, backgroundColor:C.ink, paddingVertical:16, alignItems:"center" },
  btnDisabled:{ backgroundColor:C.inkSoft },
  btnText:{ color:C.paper, fontSize:14, letterSpacing:2,
            textTransform:"uppercase", fontWeight:"600" },
  linkBtn:{ marginTop:12, alignItems:"center", paddingVertical:8 },
  linkText:{ fontSize:12, color:C.inkSoft, textDecorationLine:"underline" },
});
