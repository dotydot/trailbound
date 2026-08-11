/* ------------------------------------------------------------
   src/screens/Campaign.js

   The reason to hike a particular hike.

   Shows the active chapter with its requirement resolved into
   real numbers for THIS hiker — via whichever of the three
   ladders is easiest, because a chapter requirement must be
   attainable by everyone who paid for it.

   Also handles branch choice when a chapter completes, the
   region picker, and the chapter journal.
   ------------------------------------------------------------ */

import React, { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from "react-native";

import {
  CAMPAIGNS, REGIONS, REGION_KEYS, SEASONS,
  resolveRequirement, requirementLabel, chapterSatisfied,
} from "../game/rules";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6", sheet:"#F5F6EC",
  contour:"#9C6B3F", contourFaint:"#C4A882",
  ink:"#1E3A2F", inkSoft:"#4A6355",
  danger:"#A63D2E", ok:"#3F7A52", water:"#4A7C94", gold:"#B0682A",
};

const LADDER_COLOR = {
  region:C.contour, personal:C.water, cumulative:C.gold, alt:C.ok, rest:C.water,
};

export default function Campaign({ character, onStart, onChoose, onSetRegion, onSetSeason }) {
  const [showPaths, setShowPaths] = useState(false);
  const [picking, setPicking] = useState(false);

  const campaign = CAMPAIGNS[character.activeCampaign] || null;
  const chapter = campaign?.chapters?.[character.activeChapter] || null;
  const region = REGIONS[character.regionId];
  const season = character.season || "summer";

  const resolved = useMemo(
    () => chapter ? resolveRequirement(chapter, character, { season }) : null,
    [chapter, character, season]
  );

  /* a chapter is complete when the flag is set at commit time */
  const awaitingChoice = !!character.chapterComplete;

  /* ---------- region picker ---------- */
  if (picking) {
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.eyebrow}>Where you hike</Text>
        <Text style={s.h1}>Pick your region</Text>
        <Text style={s.blurb}>
          This sets what you meet and how far the story asks you to go. Change it
          any time — plenty of people drive somewhere bigger on a weekend.
        </Text>
        {REGION_KEYS.map(key => {
          const r = REGIONS[key];
          const on = character.regionId === key;
          return (
            <Pressable key={key} onPress={() => { onSetRegion(key); setPicking(false); }}
              style={[s.regionCard, on && s.regionOn]}>
              <View style={s.regionHead}>
                <Text style={s.regionName}>{r.name}</Text>
                {on && <Text style={s.onTag}>current</Text>}
              </View>
              <Text style={s.regionWhere}>{r.where}</Text>
              <Text style={s.regionMeta}>
                tops out near {r.ceiling.toLocaleString()} ft · {r.biomes.length} biomes
              </Text>
              <Text style={s.regionBiomes}>
                {r.biomes.map(b => b.name).join(" · ")}
              </Text>
            </Pressable>
          );
        })}
        <Text style={s.section}>Season</Text>
        <Text style={s.blurb}>
          High ground closes in winter. Requirements ease rather than parking the
          story for five months.
        </Text>
        <View style={s.segRow}>
          {SEASONS.map(sn => (
            <Pressable key={sn.key} onPress={() => onSetSeason(sn.key)}
              style={[s.seg, season === sn.key && s.segOn]}>
              <Text style={[s.segText, season === sn.key && s.segTextOn]}>{sn.name}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.hint}>{SEASONS.find(x => x.key === season)?.note}</Text>
        <Pressable onPress={() => setPicking(false)} style={s.ghostBtn}>
          <Text style={s.ghostText}>Done</Text>
        </Pressable>
      </ScrollView>
    );
  }

  /* ---------- no campaign started ---------- */
  if (!campaign) {
    const first = CAMPAIGNS.stones;
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.eyebrow}>{region?.name}</Text>
        <Text style={s.h1}>Campaign</Text>

        <View style={s.offerCard}>
          <Text style={s.offerTag}>{first.free ? "included" : "locked"}</Text>
          <Text style={s.offerName}>{first.name}</Text>
          <Text style={s.offerBody}>
            Four chapters. Something is stacking stones on trails that never
            needed marking, and it's working uphill. The requirements are scaled
            to where you hike and what you've already proven, so it finishes
            wherever you live.
          </Text>
          <Pressable onPress={() => onStart(first.id)} style={s.btn}>
            <Text style={s.btnText}>Begin</Text>
          </Pressable>
        </View>

        <Text style={s.section}>Random encounters</Text>
        <Text style={s.blurb}>
          You don't need a campaign. Every hike still pays, still levels you, and
          still collects grudges. The campaign only adds a reason to pick a
          particular mountain.
        </Text>

        <Pressable onPress={() => setPicking(true)} style={s.ghostBtn}>
          <Text style={s.ghostText}>Region · {region?.name}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  /* ---------- branch choice ---------- */
  if (awaitingChoice) {
    const branches = (chapter?.branches || []).map(id => campaign.chapters[id]).filter(Boolean);
    return (
      <ScrollView contentContainerStyle={s.wrap}>
        <Text style={s.eyebrow}>Chapter {chapter?.ch} complete</Text>
        <Text style={s.h1}>Where next</Text>
        <Text style={s.blurb}>
          Each choice sets the ground you'll need to cover. Pick the one you
          actually want to go walk.
        </Text>

        {branches.map(b => {
          const r = resolveRequirement(b, character, { season });
          const isRest = !!b.isRest;
          return (
            <Pressable key={b.id} onPress={() => onChoose(b.id)}
              style={[s.branchCard, isRest && s.branchRest]}>
              <Text style={[s.branchTag, { color: isRest ? C.water : C.contour }]}>
                {isRest ? "recover" : `Chapter ${b.ch}`}
              </Text>
              <Text style={s.branchTitle}>{b.title}</Text>
              <Text style={s.branchBody}>{b.prompt}</Text>
              <Text style={[s.branchReq, { color: isRest ? C.water : C.contour }]}>
                {requirementLabel(r.easiest)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  /* ---------- active chapter ---------- */
  const path = resolved?.easiest;
  const journal = character.chapterHistory || [];

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.eyebrow}>{campaign.name} · {region?.name}</Text>
      <Text style={s.h1}>Chapter {chapter.ch}</Text>

      <View style={s.chapterCard}>
        <Text style={s.chapterTitle}>{chapter.title}</Text>
        <Text style={s.chapterPrompt}>{chapter.prompt}</Text>

        <View style={s.reqBox}>
          <Text style={s.reqLabel}>To advance</Text>
          <Text style={s.reqValue}>{requirementLabel(path)}</Text>
          {path?.kind === "personal" && (
            <Text style={s.reqNote}>
              Scaled to what you've already done — a step past your best, not a
              fixed number.
            </Text>
          )}
          {path?.kind === "cumulative" && (
            <Text style={s.reqNote}>
              Across up to {path.hikes} hikes. No need to do it in one day.
            </Text>
          )}
          {path?.kind === "rest" && (
            <Text style={s.reqNote}>
              Rest advances the story. The cairns keep getting built while you
              recover, which is its own kind of problem.
            </Text>
          )}
        </View>

        <Pressable onPress={() => setShowPaths(v => !v)} style={s.disclose}>
          <Text style={s.discloseText}>
            {showPaths ? "Hide other ways in" : "Other ways in"}
          </Text>
        </Pressable>

        {showPaths && (
          <View style={s.pathList}>
            {resolved.paths.map(p => (
              <View key={p.kind} style={[s.pathRow, !p.ok && s.pathClosed]}>
                <Text style={[s.pathKind, { color: LADDER_COLOR[p.kind] || C.inkSoft }]}>
                  {p.label}
                </Text>
                <Text style={s.pathReq}>{requirementLabel(p)}</Text>
                <Text style={[s.pathState, { color: p.ok ? C.ok : C.inkSoft }]}>
                  {p.ok ? "open" : "out of reach"}
                </Text>
              </View>
            ))}
            <Text style={s.hint}>
              You satisfy whichever is easiest. Badges are allowed to be out of
              reach forever; a chapter you paid for is not.
            </Text>
          </View>
        )}
      </View>

      {journal.length > 0 && (
        <>
          <Text style={s.section}>Journal</Text>
          <View style={s.journal}>
            {journal.slice().reverse().map((j, i) => (
              <View key={i} style={[s.journalRow, i > 0 && s.journalDivider]}>
                <Text style={s.journalCh}>{j.ch}</Text>
                <View style={{ flex:1 }}>
                  <Text style={s.journalTitle}>{j.title}</Text>
                  <Text style={s.journalMeta}>
                    {j.distance} mi · {(j.gain || 0).toLocaleString()} ft ·
                    {" "}{new Date(j.at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      <Pressable onPress={() => setPicking(true)} style={s.ghostBtn}>
        <Text style={s.ghostText}>Region · {region?.name} · {season}</Text>
      </Pressable>

      <Pressable
        onPress={() => Alert.alert("Abandon campaign?",
          "Your character, gear and accounts are kept. Only the story resets.",
          [{ text:"Cancel", style:"cancel" },
           { text:"Abandon", style:"destructive", onPress:() => onStart(null) }])}
        style={s.abandonBtn}>
        <Text style={s.abandonText}>Abandon campaign</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap:{ padding:20, paddingBottom:40, backgroundColor:C.paper },
  eyebrow:{ fontSize:10, letterSpacing:2, textTransform:"uppercase", color:C.contour },
  h1:{ fontSize:28, fontWeight:"700", color:C.ink, marginTop:2 },
  blurb:{ fontSize:13, color:C.inkSoft, lineHeight:19, marginTop:12 },
  section:{ fontSize:10.5, letterSpacing:1.8, textTransform:"uppercase",
            color:C.contour, marginTop:26, marginBottom:8 },
  hint:{ marginTop:11, fontSize:12, color:C.inkSoft, fontStyle:"italic", lineHeight:18 },

  chapterCard:{ borderWidth:2, borderColor:C.ink, marginTop:16, backgroundColor:C.sheet },
  chapterTitle:{ fontSize:20, fontWeight:"700", color:C.ink, padding:14, paddingBottom:0 },
  chapterPrompt:{ fontSize:14.5, color:C.ink, lineHeight:22, padding:14, paddingTop:8 },
  reqBox:{ borderTopWidth:1, borderTopColor:C.contourFaint,
           backgroundColor:C.paperDeep, padding:14 },
  reqLabel:{ fontSize:9.5, letterSpacing:1.4, textTransform:"uppercase", color:C.contour },
  reqValue:{ fontSize:17, fontWeight:"700", color:C.ink, marginTop:4,
             fontVariant:["tabular-nums"] },
  reqNote:{ fontSize:12.5, color:C.inkSoft, fontStyle:"italic", marginTop:6, lineHeight:18 },
  disclose:{ padding:12, borderTopWidth:1, borderTopColor:C.contourFaint },
  discloseText:{ fontSize:11.5, color:C.water, letterSpacing:0.8 },
  pathList:{ padding:12, paddingTop:0 },
  pathRow:{ flexDirection:"row", alignItems:"center", gap:9, paddingVertical:7,
            borderBottomWidth:1, borderBottomColor:C.paperDeep },
  pathClosed:{ opacity:0.45 },
  pathKind:{ fontSize:9, letterSpacing:1.1, textTransform:"uppercase", width:74 },
  pathReq:{ flex:1, fontSize:11.5, color:C.ink, fontVariant:["tabular-nums"] },
  pathState:{ fontSize:9, letterSpacing:1, textTransform:"uppercase" },

  offerCard:{ borderWidth:2, borderColor:C.contour, backgroundColor:"#FFF8E8",
              padding:16, marginTop:16 },
  offerTag:{ fontSize:9, letterSpacing:1.4, textTransform:"uppercase", color:C.contour },
  offerName:{ fontSize:21, fontWeight:"700", color:C.ink, marginTop:4 },
  offerBody:{ fontSize:14, color:C.inkSoft, lineHeight:21, marginTop:9 },

  branchCard:{ borderWidth:2, borderColor:C.ink, padding:15, marginTop:13,
               backgroundColor:C.paper },
  branchRest:{ borderColor:C.water },
  branchTag:{ fontSize:9, letterSpacing:1.4, textTransform:"uppercase" },
  branchTitle:{ fontSize:18, fontWeight:"700", color:C.ink, marginTop:3 },
  branchBody:{ fontSize:13.5, color:C.inkSoft, lineHeight:20, marginTop:7 },
  branchReq:{ fontSize:12.5, marginTop:10, fontVariant:["tabular-nums"] },

  regionCard:{ borderWidth:1, borderColor:C.contourFaint, padding:14, marginTop:11 },
  regionOn:{ borderWidth:2, borderColor:C.contour, backgroundColor:"#FFF8E8" },
  regionHead:{ flexDirection:"row", justifyContent:"space-between", alignItems:"baseline" },
  regionName:{ fontSize:17, fontWeight:"700", color:C.ink },
  onTag:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase", color:C.contour },
  regionWhere:{ fontSize:12.5, fontStyle:"italic", color:C.inkSoft, marginTop:3 },
  regionMeta:{ fontSize:11.5, color:C.contour, marginTop:6, fontVariant:["tabular-nums"] },
  regionBiomes:{ fontSize:11.5, color:C.inkSoft, marginTop:5, lineHeight:17 },

  segRow:{ flexDirection:"row", borderWidth:1, borderColor:C.contourFaint, marginTop:8 },
  seg:{ flex:1, paddingVertical:9, alignItems:"center" },
  segOn:{ backgroundColor:C.ink },
  segText:{ fontSize:10, letterSpacing:1, textTransform:"uppercase", color:C.ink },
  segTextOn:{ color:C.paper },

  journal:{ borderWidth:1, borderColor:C.contourFaint, backgroundColor:C.sheet },
  journalRow:{ flexDirection:"row", gap:11, padding:11, alignItems:"center" },
  journalDivider:{ borderTopWidth:1, borderTopColor:C.paperDeep },
  journalCh:{ fontSize:13, fontWeight:"700", color:C.contour, width:26 },
  journalTitle:{ fontSize:13.5, color:C.ink, fontWeight:"600" },
  journalMeta:{ fontSize:11, color:C.inkSoft, marginTop:2, fontVariant:["tabular-nums"] },

  btn:{ marginTop:16, backgroundColor:C.ink, paddingVertical:15, alignItems:"center" },
  btnText:{ color:C.paper, fontSize:13, letterSpacing:1.8,
            textTransform:"uppercase", fontWeight:"600" },
  ghostBtn:{ marginTop:24, borderWidth:1, borderColor:C.contour,
             paddingVertical:12, alignItems:"center" },
  ghostText:{ fontSize:11.5, color:C.contour, letterSpacing:1.2, textTransform:"uppercase" },
  abandonBtn:{ marginTop:11, paddingVertical:10, alignItems:"center" },
  abandonText:{ fontSize:11.5, color:C.inkSoft, textDecorationLine:"underline" },
});
