/* ------------------------------------------------------------
   src/screens/TabBar.js

   A hand-rolled bottom tab bar. No new dependency, and it will
   carry a dozen screens before anything more is warranted.
   expo-router is the right answer eventually, but not while the
   app is still changing shape every week.

   Icons are procedural SVG for the same reason the badges are:
   they scale, they cost nothing, and they never need an artist.
   ------------------------------------------------------------ */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Path, Circle, Rect } from "react-native-svg";

const C = {
  paper:"#EDEFE3", paperDeep:"#E2E5D6",
  contour:"#9C6B3F", contourFaint:"#C4A882",
  ink:"#1E3A2F", inkSoft:"#4A6355", danger:"#A63D2E",
};

function Icon({ name, active, size = 22 }) {
  const col = active ? C.ink : C.inkSoft;
  const w = active ? 1.9 : 1.5;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "hike" && <>
        <Path d="M3 19 L10 7 L14 14 L17 10 L21 19 Z" fill="none" stroke={col}
          strokeWidth={w} strokeLinejoin="round" />
        <Circle cx="10" cy="7" r="0.9" fill={col} />
      </>}
      {name === "accounts" && <>
        <Path d="M4 20 L12 6 L20 20" fill="none" stroke={col} strokeWidth={w}
          strokeLinejoin="round" />
        <Circle cx="12" cy="11" r="2.2" fill="none" stroke={col} strokeWidth={w} />
      </>}
      {name === "badges" && <>
        <Circle cx="12" cy="10" r="6" fill="none" stroke={col} strokeWidth={w} />
        <Path d="M9 15 L8 22 L12 19.5 L16 22 L15 15" fill="none" stroke={col}
          strokeWidth={w} strokeLinejoin="round" />
      </>}
      {name === "story" && <>
        <Path d="M5 5 H12 V19 H5 Z" fill="none" stroke={col} strokeWidth={w} />
        <Path d="M12 5 H19 V19 H12" fill="none" stroke={col} strokeWidth={w} />
        <Path d="M8 9 H9.5 M8 12 H9.5 M14.5 9 H16 M14.5 12 H16" stroke={col} strokeWidth={w * 0.8} />
      </>}
      {name === "dev" && <>
        <Rect x="4" y="4" width="16" height="16" fill="none" stroke={col} strokeWidth={w} />
        <Path d="M8 10 L11 12.5 L8 15" fill="none" stroke={col} strokeWidth={w}
          strokeLinejoin="round" />
        <Path d="M13 15 H16" stroke={col} strokeWidth={w} />
      </>}
    </Svg>
  );
}

export default function TabBar({ tabs, active, onChange, badges = {} }) {
  return (
    <View style={s.bar}>
      {tabs.map(t => {
        const on = active === t.key;
        const count = badges[t.key];
        return (
          <Pressable key={t.key} onPress={() => onChange(t.key)}
            style={[s.tab, on && s.tabOn]} accessibilityRole="button"
            accessibilityLabel={t.label} accessibilityState={{ selected: on }}>
            <View style={s.iconWrap}>
              <Icon name={t.icon} active={on} />
              {count > 0 && (
                <View style={s.dot}>
                  <Text style={s.dotText}>{count > 9 ? "9+" : count}</Text>
                </View>
              )}
            </View>
            <Text style={[s.label, on && s.labelOn]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar:{ flexDirection:"row", borderTopWidth:1, borderTopColor:C.contourFaint,
        backgroundColor:C.paperDeep },
  tab:{ flex:1, alignItems:"center", paddingTop:9, paddingBottom:7 },
  tabOn:{ borderTopWidth:2, borderTopColor:C.contour, marginTop:-1 },
  iconWrap:{ position:"relative" },
  label:{ fontSize:9, letterSpacing:1, textTransform:"uppercase",
          color:C.inkSoft, marginTop:3 },
  labelOn:{ color:C.ink, fontWeight:"600" },
  dot:{ position:"absolute", top:-3, right:-7, minWidth:15, height:15,
        borderRadius:8, backgroundColor:C.danger, alignItems:"center",
        justifyContent:"center", paddingHorizontal:3 },
  dotText:{ fontSize:9, color:C.paper, fontWeight:"700" },
});
