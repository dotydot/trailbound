/* ------------------------------------------------------------
   src/screens/Badges.js

   The badge case, plus lifetime totals and the gear locker.

   Locked badges are shown deliberately. The gaps are what make
   someone want to go break treeline — an empty slot is an
   invitation, not a rebuke. And nothing in the game gates on a
   badge, so it is safe for some of them to be forever out of
   reach for some hikers.

   Emblems are procedural SVG: they scale to any size, cost
   nothing to ship, and never need an artist.
   ------------------------------------------------------------ */

import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import {
  BADGES, RARITY, SLOT_KEYS, REGIONS, levelFromXp,
  rawGearPower, capacityOf, biomeBreadth, reforgeCost,
} from "../game/rules";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6", sheet:"#F5F6EC",
  contour:"#9C6B3F", contourFaint:"#C4A882",
  ink:"#1E3A2F", inkSoft:"#4A6355",
  danger:"#A63D2E", ok:"#3F7A52", water:"#4A7C94", gold:"#B0682A",
};

/* which glyph each badge draws, and its tier colour */
const GLYPH = {
  first:   { g:"blaze", tier:1 },
  g1k:     { g:"peak",  tier:1 },
  g2k:     { g:"peak2", tier:2 },
  g4k:     { g:"peak3", tier:3 },
  treeline:{ g:"tree",  tier:4 },
  mi10:    { g:"boot",  tier:2 },
  mi50:    { g:"path",  tier:2 },
  scramble:{ g:"scree", tier:3 },
  vert5:   { g:"arrow", tier:3 },
  regular: { g:"cairn", tier:1 },
  guide:   { g:"party", tier:2 },
  settle:  { g:"scree", tier:3 },
  biomes:  { g:"path",  tier:3 },
};
const TIER_COLOR = { 1:"#6E7A6A", 2:"#3F7A52", 3:"#3E6E90", 4:"#B0682A" };

function Emblem({ id, size = 46, locked }) {
  const meta = GLYPH[id] || { g:"cairn", tier:1 };
  const col = locked ? C.contourFaint : TIER_COLOR[meta.tier];
  const o = locked ? 0.45 : 1;
  const g = meta.g;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Circle cx="20" cy="20" r="18.2" fill="none" stroke={col} strokeWidth="1" opacity={o} />
      <Circle cx="20" cy="20" r="15.4" fill="none" stroke={col} strokeWidth="0.5"
        strokeDasharray="2 2.4" opacity={o * 0.7} />
      {g === "blaze" && <Rect x="16.5" y="12" width="7" height="16" fill={col} opacity={o} />}
      {g === "peak" && <Path d="M11 26 L20 14 L29 26" fill="none" stroke={col}
        strokeWidth="1.6" strokeLinejoin="round" opacity={o} />}
      {g === "peak2" && <>
        <Path d="M9 26 L16 16 L22 26" fill="none" stroke={col} strokeWidth="1.5" opacity={o} />
        <Path d="M19 26 L26 13 L32 26" fill="none" stroke={col} strokeWidth="1.5" opacity={o} />
      </>}
      {g === "peak3" && <>
        <Path d="M8 27 L14 18 L19 27" fill="none" stroke={col} strokeWidth="1.4" opacity={o} />
        <Path d="M16 27 L22 12 L28 27" fill="none" stroke={col} strokeWidth="1.4" opacity={o} />
        <Path d="M25 27 L30 19 L34 27" fill="none" stroke={col} strokeWidth="1.4" opacity={o} />
      </>}
      {g === "tree" && <>
        <Path d="M20 11 L14 21 L26 21 Z" fill="none" stroke={col} strokeWidth="1.5" opacity={o} />
        <Path d="M20 21 L20 28" stroke={col} strokeWidth="1.5" opacity={o} />
        <Path d="M9 25.5 L31 25.5" stroke={col} strokeWidth="1" strokeDasharray="2 2" opacity={o} />
      </>}
      {g === "boot" && <Path d="M15 12 V22 L12 25 V28 H27 V24 L20 21 V12 Z"
        fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" opacity={o} />}
      {g === "path" && <Path d="M12 29 C18 25 13 20 19 17 C24 14.5 21 12 27 11"
        fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" opacity={o} />}
      {g === "scree" && <>
        <Path d="M11 27 L20 13 L29 27" fill="none" stroke={col} strokeWidth="1.5" opacity={o} />
        <Circle cx="16" cy="24" r="1.6" fill={col} opacity={o} />
        <Circle cx="23" cy="25" r="1.2" fill={col} opacity={o} />
      </>}
      {g === "arrow" && <>
        <Path d="M20 28 V12" stroke={col} strokeWidth="1.6" opacity={o} />
        <Path d="M15 17 L20 11.5 L25 17" fill="none" stroke={col} strokeWidth="1.6"
          strokeLinejoin="round" opacity={o} />
        <Path d="M14 28 H26" stroke={col} strokeWidth="1" opacity={o} />
      </>}
      {g === "cairn" && <>
        {[[15,25,28],[16,24,24.5],[17,23,21],[18,22,17.5],[19,21,14]].map(([x1,x2,y],i)=>(
          <Path key={i} d={`M${x1} ${y} H${x2}`} stroke={col} strokeWidth="1.5"
            strokeLinecap="round" opacity={o} />
        ))}
      </>}
      {g === "party" && <>
        <Circle cx="15" cy="17" r="3" fill="none" stroke={col} strokeWidth="1.4" opacity={o} />
        <Circle cx="25" cy="17" r="2.3" fill="none" stroke={col} strokeWidth="1.4" opacity={o} />
        <Path d="M10 28 C10 22 20 22 20 28" fill="none" stroke={col} strokeWidth="1.4" opacity={o} />
        <Path d="M22 28 C22 23.5 30 23.5 30 28" fill="none" stroke={col} strokeWidth="1.4" opacity={o} />
      </>}
    </Svg>
  );
}

export default function Badges({ character }) {
  const prog = levelFromXp(character.xp || 0);
  const region = REGIONS[character.regionId];
  const earned = character.badges || [];

  const progressText = useMemo(() => {
    const map = {
      first:    `${character.hikes || 0} / 1 hikes`,
      g1k:      `best ${(character.bestGain || 0).toLocaleString()} / 1,000 ft`,
      g2k:      `best ${(character.bestGain || 0).toLocaleString()} / 2,000 ft`,
      g4k:      `high ${(character.bestElev || 0).toLocaleString()} / 4,000 ft`,
      treeline: `high ${(character.bestElev || 0).toLocaleString()} / 5,500 ft`,
      mi10:     `best ${character.bestDist || 0} / 10 mi`,
      mi50:     `${character.totalMiles || 0} / 50 mi`,
      scramble: `best Class ${character.bestClass || 0} / 4`,
      vert5:    `${(character.totalGain || 0).toLocaleString()} / 5,280 ft`,
      regular:  `${character.hikes || 0} / 10 hikes`,
      guide:    `${character.guidedHikes || 0} / 5 led`,
      settle:   `${(character.trophies || []).length} / 3 settled`,
      biomes:   `${biomeBreadth(character)} / 5 biomes`,
    };
    return map;
  }, [character]);

  const gearPower = rawGearPower(character.gear);
  const capacity = capacityOf(character.gear);

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.eyebrow}>{region?.name}</Text>
      <Text style={s.h1}>Level {prog.level}</Text>

      <View style={s.xpBar}>
        <View style={[s.xpFill, { width:`${Math.min(100, (prog.into / prog.need) * 100)}%` }]} />
      </View>
      <Text style={s.xpText}>{prog.into.toLocaleString()} / {prog.need.toLocaleString()} xp</Text>

      <Text style={s.section}>Lifetime</Text>
      <View style={s.statGrid}>
        <Stat label="Hikes" v={character.hikes || 0} />
        <Stat label="Miles" v={character.totalMiles || 0} />
        <Stat label="Vertical" v={`${(character.totalGain || 0).toLocaleString()} ft`} />
        <Stat label="Highest" v={`${(character.bestElev || 0).toLocaleString()} ft`} />
        <Stat label="Biggest gain" v={`${(character.bestGain || 0).toLocaleString()} ft`} />
        <Stat label="Longest" v={`${character.bestDist || 0} mi`} />
      </View>

      <Text style={s.section}>
        Badge case · {earned.length} of {BADGES.length}
      </Text>
      <View style={s.badgeGrid}>
        {BADGES.map(b => {
          const got = earned.includes(b.id);
          return (
            <View key={b.id} style={[s.badge, got && s.badgeGot]}>
              <Emblem id={b.id} size={44} locked={!got} />
              <Text style={[s.badgeName, !got && s.badgeNameLocked]}>{b.name}</Text>
              <Text style={s.badgeDesc}>{b.desc}</Text>
              {!got && progressText[b.id] && (
                <Text style={s.badgeProgress}>{progressText[b.id]}</Text>
              )}
            </View>
          );
        })}
      </View>
      <Text style={s.hint}>
        Locked badges stay visible on purpose — the gaps are the invitation.
        Nothing in the game gates on a badge, so some may stay out of reach
        depending on where you hike, and that's fine.
      </Text>

      <Text style={s.section}>
        Gear · {gearPower} power · {capacity} lb capacity
      </Text>
      <View style={s.gearGrid}>
        {SLOT_KEYS.map(slot => {
          const item = character.gear?.[slot];
          if (!item) {
            return (
              <View key={slot} style={s.gearEmpty}>
                <Text style={s.gearSlot}>{slot}</Text>
                <Text style={s.gearNone}>empty</Text>
              </View>
            );
          }
          const col = RARITY[item.rarity]?.color || C.inkSoft;
          return (
            <View key={slot} style={[s.gearItem, { borderColor: col }]}>
              <View style={s.gearTop}>
                <Text style={[s.gearRarity, { color: col }]}>{item.rarity}</Text>
                <Text style={s.gearPower}>{item.power}</Text>
              </View>
              <Text style={s.gearName}>{item.name}</Text>
              <Text style={s.gearMeta}>
                {slot}
                {item.reforges ? ` · reforged ×${item.reforges}` : ""}
                {item.capacityGranted ? ` · +${item.capacityGranted} cap` : ""}
              </Text>
              {item.reforges != null && (
                <Text style={s.gearNext}>
                  next reforge {reforgeCost(item.reforges)} salvage
                </Text>
              )}
            </View>
          );
        })}
      </View>

      {(character.stash || []).length > 0 && (
        <>
          <Text style={s.section}>Stash · {(character.stash || []).length}</Text>
          <View style={s.stashList}>
            {(character.stash || []).slice(-14).reverse().map((it, i) => (
              <View key={i} style={s.stashRow}>
                <Text style={[s.stashRarity,
                  { color: RARITY[it.rarity]?.color || C.inkSoft }]}>
                  {it.rarity?.[0] || "?"}
                </Text>
                <Text style={s.stashName}>{it.name}</Text>
                <Text style={s.stashMeta}>{it.slot} · {it.power} pwr</Text>
              </View>
            ))}
          </View>
          <Text style={s.hint}>
            The bench turns these into salvage and salvage into reforges. Not
            built yet — for now they just accumulate.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const Stat = ({ label, v }) => (
  <View style={s.statCell}>
    <Text style={s.statLabel}>{label}</Text>
    <Text style={s.statValue}>{String(v)}</Text>
  </View>
);

const s = StyleSheet.create({
  wrap:{ padding:20, paddingBottom:40, backgroundColor:C.paper },
  eyebrow:{ fontSize:10, letterSpacing:2, textTransform:"uppercase", color:C.contour },
  h1:{ fontSize:28, fontWeight:"700", color:C.ink, marginTop:2 },
  xpBar:{ height:6, backgroundColor:C.paperDeep, borderWidth:1,
          borderColor:C.contourFaint, marginTop:10 },
  xpFill:{ height:"100%", backgroundColor:C.contour },
  xpText:{ fontSize:11, color:C.inkSoft, marginTop:4, fontVariant:["tabular-nums"] },

  section:{ fontSize:10.5, letterSpacing:1.8, textTransform:"uppercase",
            color:C.contour, marginTop:26, marginBottom:9 },

  statGrid:{ flexDirection:"row", flexWrap:"wrap", borderWidth:1, borderColor:C.contourFaint },
  statCell:{ width:"33.33%", padding:10, backgroundColor:C.paperDeep },
  statLabel:{ fontSize:8.5, letterSpacing:1.1, textTransform:"uppercase", color:C.inkSoft },
  statValue:{ fontSize:14, fontWeight:"700", color:C.ink, marginTop:2,
              fontVariant:["tabular-nums"] },

  badgeGrid:{ flexDirection:"row", flexWrap:"wrap", gap:10 },
  badge:{ width:"47%", borderWidth:1, borderColor:C.contourFaint, padding:12,
          alignItems:"center", opacity:0.55 },
  badgeGot:{ opacity:1, borderColor:C.contour, backgroundColor:"#FFF8E8" },
  badgeName:{ fontSize:11.5, letterSpacing:0.9, textTransform:"uppercase",
              color:C.ink, marginTop:7, textAlign:"center", fontWeight:"600" },
  badgeNameLocked:{ color:C.inkSoft, fontWeight:"400" },
  badgeDesc:{ fontSize:11.5, color:C.inkSoft, marginTop:4, textAlign:"center", lineHeight:16 },
  badgeProgress:{ fontSize:10, color:C.contour, marginTop:5,
                  fontVariant:["tabular-nums"] },

  gearGrid:{ gap:9 },
  gearItem:{ borderWidth:1, padding:11, backgroundColor:C.paper },
  gearEmpty:{ borderWidth:1, borderStyle:"dashed", borderColor:C.contourFaint, padding:11 },
  gearTop:{ flexDirection:"row", justifyContent:"space-between", alignItems:"baseline" },
  gearRarity:{ fontSize:9, letterSpacing:1.2, textTransform:"uppercase" },
  gearPower:{ fontSize:13, fontWeight:"700", color:C.ink, fontVariant:["tabular-nums"] },
  gearName:{ fontSize:14.5, fontWeight:"600", color:C.ink, marginTop:3 },
  gearMeta:{ fontSize:10.5, color:C.inkSoft, marginTop:2 },
  gearNext:{ fontSize:10, color:C.gold, marginTop:4 },
  gearSlot:{ fontSize:10, letterSpacing:1.2, textTransform:"uppercase", color:C.inkSoft },
  gearNone:{ fontSize:12.5, fontStyle:"italic", color:C.inkSoft, marginTop:3 },

  stashList:{ borderWidth:1, borderColor:C.contourFaint, backgroundColor:C.sheet },
  stashRow:{ flexDirection:"row", alignItems:"center", gap:9, padding:9,
             borderBottomWidth:1, borderBottomColor:C.paperDeep },
  stashRarity:{ fontSize:12, fontWeight:"700", width:14 },
  stashName:{ flex:1, fontSize:13, color:C.ink },
  stashMeta:{ fontSize:10.5, color:C.inkSoft, fontVariant:["tabular-nums"] },

  hint:{ marginTop:12, fontSize:12, color:C.inkSoft, fontStyle:"italic", lineHeight:18 },
});
