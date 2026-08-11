/* ------------------------------------------------------------
   src/screens/Accounts.js

   Open accounts, the bestiary, and the trophy case — all three
   read the same nemesis data the engine has been quietly
   collecting since the first hike.

   The two bars on each account card are the point: insight grows
   +20% per meeting while the creature only escalates +12% per
   turnback, so the blue bar overtakes the red one. A player who
   can SEE they are closing the gap doesn't experience a turnback
   as punishment.
   ------------------------------------------------------------ */

import React, { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";

import {
  REGIONS, biomesOf, knowledgeOf, reckoning, nemesisLabel,
  stageOf, TUNING,
} from "../game/rules";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6", sheet:"#F5F6EC",
  contour:"#9C6B3F", contourFaint:"#C4A882",
  ink:"#1E3A2F", inkSoft:"#4A6355",
  danger:"#A63D2E", ok:"#3F7A52", water:"#4A7C94", gold:"#B0682A",
};

const STAGE_LABEL = {
  anonymous:"unknown", marked:"marked", named:"named", titled:"titled",
};

export default function Accounts({ character }) {
  const [view, setView] = useState("open");

  const region = REGIONS[character.regionId];
  const biomeTint = key =>
    biomesOf(character.regionId).find(b => b.key === key)?.tint || C.contourFaint;
  const biomeName = key =>
    biomesOf(character.regionId).find(b => b.key === key)?.name || key;

  const all = useMemo(
    () => Object.entries(character.nemeses || {}).map(([key, n]) => ({ key, ...n })),
    [character.nemeses]
  );
  const open = useMemo(
    () => all.filter(n => !n.defeated && n.turnbacks > 0)
             .sort((a, b) => b.turnbacks - a.turnbacks),
    [all]
  );
  const known = useMemo(
    () => [...all].sort((a, b) => (b.insight || 0) - (a.insight || 0)),
    [all]
  );
  const trophies = [...(character.trophies || [])].reverse();

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.eyebrow}>{region?.name}</Text>
      <Text style={s.h1}>Accounts</Text>

      <View style={s.segRow}>
        {[["open", `Open · ${open.length}`],
          ["bestiary", `Bestiary · ${known.length}`],
          ["trophies", `Settled · ${trophies.length}`]].map(([k, label]) => (
          <Pressable key={k} onPress={() => setView(k)}
            style={[s.seg, view === k && s.segOn]}>
            <Text style={[s.segText, view === k && s.segTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ---------------- OPEN ---------------- */}
      {view === "open" && (
        open.length === 0 ? (
          <Empty
            title="Nothing unsettled"
            body="Hike something well above your gear and you'll start collecting accounts. Getting turned back is how this list fills — and every meeting teaches you something, win or lose." />
        ) : (
          <>
            <Text style={s.blurb}>
              Each of these turned you back. The bars show what it costs you
              against what you've learned. When yours is longer, go settle it.
            </Text>
            {open.map(n => {
              const r = reckoning(n);
              const know = knowledgeOf(n.insight || 0);
              const stage = stageOf(n.turnbacks || 0);
              const label = nemesisLabel(n, n.mob);
              return (
                <View key={n.key} style={[s.card, r.ready ? s.cardReady : s.cardOpen]}>
                  <View style={s.cardHead}>
                    <View style={[s.stripe, { backgroundColor: biomeTint(n.biome) }]} />
                    <View style={{ flex:1 }}>
                      <Text style={s.cardMeta}>
                        {STAGE_LABEL[stage]} · {biomeName(n.biome)} · last seen{" "}
                        {(n.lastFt || 0).toLocaleString()} ft
                      </Text>
                      <Text style={s.cardTitle}>{label}</Text>
                      {stage === "marked" && (
                        <Text style={s.cardSub}>still nameless — beat you once</Text>
                      )}
                    </View>
                    {r.ready && <Text style={s.readyTag}>ready</Text>}
                  </View>

                  <View style={s.cardBody}>
                    <Bar
                      label={`Its strength — ${n.turnbacks} turnback${n.turnbacks > 1 ? "s" : ""}`}
                      value={r.theirs} max={2.2} tint={C.danger}
                      note={`+${Math.round(TUNING.nemesisEscalation * n.turnbacks * 100)}%`} />
                    <View style={{ height:9 }} />
                    <Bar
                      label={`Your insight — ${n.insight} meeting${n.insight > 1 ? "s" : ""}`}
                      value={r.yours} max={2.2} tint={C.water}
                      note={`+${Math.round(TUNING.nemesisInsightGain * n.insight * 100)}%`} />

                    {know && (
                      <View style={s.knowBox}>
                        <Text style={s.knowLabel}>{know.label}</Text>
                        <Text style={s.knowText}>{know.text}</Text>
                      </View>
                    )}

                    {n.prepared && (
                      <Text style={s.prepared}>
                        Plan prepared. +{Math.round(TUNING.preparedBonus * 100)}% next time you meet it.
                      </Text>
                    )}

                    <Text style={[s.verdict, { color: r.ready ? C.ok : C.inkSoft }]}>
                      {r.ready
                        ? `Settling this pays +${Math.round(n.turnbacks * TUNING.settleBonusPerTurnback * 100)}% for the wait.`
                        : "Not yet. One more meeting and you're likely even."}
                    </Text>
                  </View>
                </View>
              );
            })}
          </>
        )
      )}

      {/* ---------------- BESTIARY ---------------- */}
      {view === "bestiary" && (
        known.length === 0 ? (
          <Empty
            title="Nothing recorded"
            body="The bestiary fills in whether you win or lose. Losing is the cheapest way to learn about something — you were going to meet it anyway." />
        ) : (
          <>
            <Text style={s.blurb}>
              Every meeting adds a point of insight, and insight is permanent.
              This is the only collection in the game that failure advances.
            </Text>
            <View style={s.list}>
              {known.map((n, i) => {
                const know = knowledgeOf(n.insight || 0);
                return (
                  <View key={n.key} style={[s.listRow, i > 0 && s.listDivider]}>
                    <View style={[s.stripeThin, { backgroundColor: biomeTint(n.biome) }]} />
                    <View style={{ flex:1 }}>
                      <Text style={s.listName}>
                        {n.mob}
                        {n.name ? <Text style={s.listAlias}> — {n.name}</Text> : null}
                      </Text>
                      <Text style={s.listMeta}>{biomeName(n.biome)}</Text>
                    </View>
                    <View style={{ alignItems:"flex-end" }}>
                      <Text style={[s.listTier, { color: know ? C.water : C.inkSoft }]}>
                        {know ? know.label : "unrecorded"}
                      </Text>
                      <Text style={s.listNums}>
                        insight {n.insight}
                        {n.turnbacks > 0 ? ` · ${n.turnbacks} tb` : ""}
                        {n.defeated ? " · settled" : ""}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )
      )}

      {/* ---------------- TROPHIES ---------------- */}
      {view === "trophies" && (
        trophies.length === 0 ? (
          <Empty
            title="No accounts settled"
            body="Get turned back twice by the same thing, come back stronger, and beat it. That's the best story this app can produce, and it writes itself." />
        ) : (
          <>
            <Text style={s.blurb}>
              Each of these turned you back and then didn't. Nobody wrote these
              — your own hikes did.
            </Text>
            {trophies.map((t, i) => (
              <View key={i} style={s.trophy}>
                <Text style={s.trophyTag}>account settled</Text>
                <Text style={s.trophyName}>{t.name}</Text>
                <Text style={s.trophyBody}>
                  Turned you back {t.turnbacks} time{t.turnbacks > 1 ? "s" : ""} before
                  you took the ground at {(t.elevation || 0).toLocaleString()} ft.
                </Text>
                <Text style={[s.trophyBiome, { color: biomeTint(t.biome) }]}>
                  {biomeName(t.biome)} · {new Date(t.at).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </>
        )
      )}
    </ScrollView>
  );
}

/* ---------- parts ---------- */
function Bar({ label, value, max, tint, note }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <View>
      <View style={s.barHead}>
        <Text style={s.barLabel}>{label}</Text>
        <Text style={[s.barNote, { color: tint }]}>{note}</Text>
      </View>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width:`${pct}%`, backgroundColor: tint }]} />
      </View>
    </View>
  );
}

const Empty = ({ title, body }) => (
  <View style={s.empty}>
    <Text style={s.emptyTitle}>{title}</Text>
    <Text style={s.emptyBody}>{body}</Text>
  </View>
);

const s = StyleSheet.create({
  wrap:{ padding:20, paddingBottom:40, backgroundColor:C.paper },
  eyebrow:{ fontSize:10, letterSpacing:2, textTransform:"uppercase", color:C.contour },
  h1:{ fontSize:28, fontWeight:"700", color:C.ink, marginTop:2 },

  segRow:{ flexDirection:"row", marginTop:16, borderWidth:1, borderColor:C.contourFaint },
  seg:{ flex:1, paddingVertical:9, alignItems:"center", backgroundColor:"transparent" },
  segOn:{ backgroundColor:C.ink },
  segText:{ fontSize:10, letterSpacing:1, textTransform:"uppercase", color:C.ink },
  segTextOn:{ color:C.paper },

  blurb:{ fontSize:13, color:C.inkSoft, lineHeight:19, marginTop:16, marginBottom:4 },

  card:{ borderWidth:2, marginTop:13, backgroundColor:C.paper },
  cardOpen:{ borderColor:C.danger },
  cardReady:{ borderColor:C.ok, backgroundColor:"#EDF3EC" },
  cardHead:{ flexDirection:"row", gap:9, padding:12,
             borderBottomWidth:1, borderBottomColor:C.contourFaint },
  stripe:{ width:4, alignSelf:"stretch" },
  stripeThin:{ width:3, alignSelf:"stretch" },
  cardMeta:{ fontSize:9, letterSpacing:1, textTransform:"uppercase", color:C.inkSoft },
  cardTitle:{ fontSize:17, fontWeight:"700", color:C.ink, marginTop:2 },
  cardSub:{ fontSize:12, fontStyle:"italic", color:C.inkSoft, marginTop:2 },
  readyTag:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase", color:C.ok },
  cardBody:{ padding:12 },

  barHead:{ flexDirection:"row", justifyContent:"space-between",
            alignItems:"baseline", marginBottom:4 },
  barLabel:{ fontSize:9, letterSpacing:1, textTransform:"uppercase", color:C.inkSoft, flex:1 },
  barNote:{ fontSize:11, fontWeight:"700", fontVariant:["tabular-nums"] },
  barTrack:{ height:7, backgroundColor:C.paperDeep, borderWidth:1, borderColor:C.contourFaint },
  barFill:{ height:"100%" },

  knowBox:{ marginTop:11, paddingTop:10, borderTopWidth:1, borderTopColor:C.paperDeep },
  knowLabel:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase", color:C.water },
  knowText:{ fontSize:12.5, fontStyle:"italic", color:C.inkSoft, marginTop:2, lineHeight:18 },
  prepared:{ fontSize:12.5, color:C.water, marginTop:9, lineHeight:18 },
  verdict:{ fontSize:12.5, marginTop:10, lineHeight:18 },

  list:{ borderWidth:1, borderColor:C.contourFaint, marginTop:12, backgroundColor:C.sheet },
  listRow:{ flexDirection:"row", alignItems:"center", gap:10, padding:11 },
  listDivider:{ borderTopWidth:1, borderTopColor:C.paperDeep },
  listName:{ fontSize:14, fontWeight:"600", color:C.ink },
  listAlias:{ fontWeight:"400", color:C.contour },
  listMeta:{ fontSize:10, letterSpacing:0.8, textTransform:"uppercase", color:C.inkSoft, marginTop:2 },
  listTier:{ fontSize:10, letterSpacing:1, textTransform:"uppercase" },
  listNums:{ fontSize:10, color:C.inkSoft, marginTop:2, fontVariant:["tabular-nums"] },

  trophy:{ borderWidth:2, borderColor:C.gold, backgroundColor:"#FFF8E8",
           padding:14, marginTop:13 },
  trophyTag:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase", color:C.gold },
  trophyName:{ fontSize:18, fontWeight:"700", color:C.ink, marginTop:3 },
  trophyBody:{ fontSize:13, color:C.inkSoft, marginTop:6, lineHeight:19, fontStyle:"italic" },
  trophyBiome:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase", marginTop:8 },

  empty:{ marginTop:22, borderWidth:1, borderStyle:"dashed",
          borderColor:C.contourFaint, padding:18 },
  emptyTitle:{ fontSize:13, letterSpacing:1.4, textTransform:"uppercase", color:C.inkSoft },
  emptyBody:{ fontSize:13.5, color:C.inkSoft, marginTop:7, lineHeight:20 },
});
