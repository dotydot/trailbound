/* ============================================================================
   src/game/rules.js
   TRAILBOUND — the single source of truth.

   Everything decided so far, in one place: world data, absolute scaling,
   encounter resolution, nemesis, loot, campaign chapters, the three-ladder
   requirement resolver, the planning table, party bonuses, and the balance
   mitigations.

   Pure JavaScript. No React, no SQLite, no platform APIs. Runs identically
   in the app, in a node test script, and in a browser harness — which is
   the point: prototypes must not reimplement the rules, they must import
   them, or they drift.

   Sections:
     1  TUNING          every constant, in one block
     2  WORLD           regions, biomes, creatures
     3  SCALING         energy miles, ratings, tiers, levels
     4  GEAR            slots, rarity, capacity, salvage, reforge
     5  NEMESIS         escalation, insight, naming, bestiary
     6  CAMPAIGN        chapters, branches, three-ladder requirements
     7  PLANNING        intention, study, party
     8  RESOLVE         the encounter engine
     9  COMMIT          applying a resolved hike
    10  NARRATIVE       criteria-matched lines and log assembly
   ============================================================================ */

/* ============================================================================
   1. TUNING — every number worth arguing about
   ========================================================================= */

export const TUNING = {
  /* effort */
  gainPerEnergyMile: 500,
  encountersPerEnergyMile: 1 / 1.4,
  maxEncounters: 12,

  /* rewards */
  xpPerEnergyMile: 70,
  xpPerEncounterRating: 2.4,
  eliteXpMult: 1.6,
  turnbackXpFraction: 0.4,
  summitXpPer1000ft: 55,
  levelCurveBase: 420,
  levelCurveExp: 1.55,

  /* difficulty */
  ratingBase: 7,
  ratingSlopePer1000ft: 9.5,
  eliteRatingMult: 1.75,
  clearMargin: 1.25,
  varianceLow: 0.88,
  varianceHigh: 1.12,

  /* the 40% cap — you cannot be turned back nine times in one day */
  maxTurnbackFraction: 0.4,

  /* condition */
  conditionPerEnergyMile: 3,
  conditionPerCostly: 5,
  conditionRecoveryPerDay: 20,
  conditionFloorFactor: 0.55,   // effective power at 0 condition

  /* loot */
  dropChanceBase: 0.34,
  dropChancePerTier: 0.05,
  eliteDropBonus: 0.4,
  costlyDropFactor: 0.5,
  lootPowerBase: 6,
  lootPowerPerTier: 5,
  baseCapacity: 22,

  /* nemesis */
  nemesisEscalation: 0.12,      // it gains this per turnback
  nemesisInsightGain: 0.20,     // you gain this per meeting — deliberately larger
  nemesisAppearChance: 0.75,
  preparedBonus: 0.30,
  settleBonusPerTurnback: 0.60,

  /* planning table */
  intentionTolerance: 0.20,
  intentionBonus: 0.25,
  intentionExpiryDays: 10,
  studyChargePerDay: 1,
  studyChargeCap: 3,
  studyInsightRequired: 2,
  reforgeBase: 12,
  reforgeStep: 1.7,
  reforgeGain: 5,

  /* party */
  guideBonusPerMember: 0.08,
  guideBonusPerLevel: 0.015,
  guideBonusCap: 0.45,

  /* requirements */
  personalStretch: 1.10,
  cumulativeHikes: 3,

  /* caps */
  dailyXpCap: 6000,
};

/* Balance mitigations for the gear-outruns-terrain problem.
   All three OFF by default — turn them on in the harness, decide, then
   change the default here. The app and the harness read the same flags. */
export const MITIGATIONS = {
  diminishingGear: false,
  gearSoftCap: 180,             // power at which returns halve

  campaignTiers: false,         // player-chosen difficulty
  levelTerm: false,             // small capped rating scaling
  levelTermPer10: 0.10,
  levelTermCap: 0.60,
};

export const CAMPAIGN_TIERS = [
  { key:"wayfarer",  name:"Wayfarer",  rating:1.0, reward:1.00, note:"As written. First time through." },
  { key:"ranger",    name:"Ranger",    rating:1.6, reward:1.35, note:"A second run, or a strong character." },
  { key:"sovereign", name:"Sovereign", rating:2.5, reward:1.80, note:"Built to hurt. Turnbacks expected." },
];

/* ============================================================================
   2. WORLD — biome decides WHAT you meet; elevation decides how hard it is
   ========================================================================= */

export const REGIONS = {
  coastal: {
    id:"coastal", name:"Coastal Plain", where:"Long Island, Cape Cod, Jersey Shore",
    ceiling:400, bigGain:500, longDist:8,
    biomes:[
      { key:"marsh", name:"Salt Marsh", min:0, max:60, tint:"#5E8C7F",
        apex:"The Tide-Keeper",
        mobs:["Reedwhisper","Brackish Crawler","Fiddler Swarm","Netted Drifter"],
        cover:["the reeds","a culvert","the mud"],
        names:["Saltwrack","Bittern","Reedmourn","Chandler"] },
      { key:"barrens", name:"Pine Barrens", min:60, max:180, tint:"#7E8B4A",
        apex:"The Ashen Warden",
        mobs:["Pitch-Pine Husk","Scrub Oak Stalker","Sand Road Wraith","Cicada Choir"],
        cover:["the scrub","a sand road","the pitch pine"],
        names:["Ninebark","Cinderjack","Sandhollow","Ashwold"] },
      { key:"moraine", name:"Terminal Moraine", min:180, max:Infinity, tint:"#B08A4E",
        apex:"The Glacier's Debt",
        mobs:["Kettle-Hole Shade","Erratic Golem","Bluff-Edge Harrier","Drumlin Wyrm"],
        cover:["the erratics","a kettle hole","the bluff"],
        names:["Kettlestone","Drumlin","Coldwater","Marlpit"] },
    ],
  },
  highlands: {
    id:"highlands", name:"Hudson Highlands", where:"Hudson Valley, Poconos, Blue Ridge foothills",
    ceiling:1500, bigGain:1800, longDist:9,
    biomes:[
      { key:"bottom", name:"River Bottom", min:0, max:300, tint:"#5E8C7F",
        apex:"The Ferryman's Toll",
        mobs:["Silt Lurker","Sycamore Shade","Floodplain Serpent","Oxbow Drifter"],
        cover:["the silt","the sycamores","a backwater"],
        names:["Silthollow","Ferryman","Oxbow"] },
      { key:"hardwood", name:"Hardwood Slope", min:300, max:800, tint:"#8FA84E",
        apex:"The Oak Sovereign",
        mobs:["Talus Hound","Chestnut Revenant","Laurel Snare","Slope-Fog Walker"],
        cover:["the laurel","a stone wall","the leaf litter"],
        names:["Hornbeam","Blackbriar","Thornwake"] },
      { key:"ledge", name:"Open Ledge", min:800, max:Infinity, tint:"#C9973F",
        apex:"The Ledge Tyrant",
        mobs:["Scrub-Ledge Drake","Cairn Shade","Updraft Elemental","Bare-Rock Warden"],
        cover:["the blueberry scrub","bare rock","the updraft"],
        names:["Updraught","Stonecrop","Ledgewake"] },
    ],
  },
  greens: {
    id:"greens", name:"Green Mountains", where:"Vermont, Berkshires, southern Maine",
    ceiling:4000, bigGain:3000, longDist:11,
    biomes:[
      { key:"valley", name:"Valley Floor", min:0, max:1000, tint:"#7A9A5B",
        apex:"The Millpond Warden",
        mobs:["Mud Lurker","Culvert Serpent","Fallen-Log Troll","Beaver-Flow Shade"],
        cover:["the reeds","a culvert","the mud"],
        names:["Alderwick","Millrace","Culvertine"] },
      { key:"northern", name:"Northern Hardwood", min:1000, max:2500, tint:"#8FA84E",
        apex:"The Birch Sovereign",
        mobs:["Bramble Stalker","Blowdown Ent","Root-Snare Wraith","Hollow Cairn Shade"],
        cover:["the deadfall","the brambles","a blowdown"],
        names:["Birchmourn","Deadfall","Hollowcairn"] },
      { key:"montane", name:"Montane Spruce", min:2500, max:Infinity, tint:"#C9A34E",
        apex:"The Spruce Sovereign",
        mobs:["Switchback Wyrm","Scree Hound Pack","Mossback Ogre","Fog-Walker"],
        cover:["the fog","a talus field","the scrub"],
        names:["Fogmantle","Switchback","Screehowl","Greywether"] },
    ],
  },
  whites: {
    id:"whites", name:"White Mountains", where:"New Hampshire, western Maine, Adirondacks",
    ceiling:6300, bigGain:4200, longDist:13,
    biomes:[
      { key:"valley", name:"Valley Floor", min:0, max:1000, tint:"#7A9A5B",
        apex:"The Notch Gatekeeper",
        mobs:["Mud Lurker","Culvert Serpent","Fallen-Log Troll","Beaver-Flow Shade"],
        cover:["the reeds","a culvert","the mud"],
        names:["Alderwick","Millrace","Culvertine"] },
      { key:"woodland", name:"Woodland", min:1000, max:2500, tint:"#8FA84E",
        apex:"The Blowdown King",
        mobs:["Bramble Stalker","Blowdown Ent","Root-Snare Wraith","Hollow Cairn Shade"],
        cover:["the deadfall","the brambles","a blowdown"],
        names:["Deadfall","Hornbeam","Blackbriar","Thornwake"] },
      { key:"montane", name:"Montane", min:2500, max:4000, tint:"#C9A34E",
        apex:"The Fog Sovereign",
        mobs:["Switchback Wyrm","Scree Hound Pack","Mossback Ogre","Fog-Walker"],
        cover:["the fog","a talus field","the scrub"],
        names:["Fogmantle","Switchback","Screehowl","Greywether"] },
      { key:"subalpine", name:"Subalpine", min:4000, max:5500, tint:"#D4813C",
        apex:"The Krummholz Tyrant",
        mobs:["Krummholz Warden","Talus Golem","Whiteout Revenant","Ridge Harrier"],
        cover:["the krummholz","the scree","a whiteout"],
        names:["Rimewood","Windshear","Brackenfell","Coldspar"] },
      { key:"alpine", name:"Above Treeline", min:5500, max:Infinity, tint:"#B9502F",
        apex:"The Sovereign of the Height",
        mobs:["Summit Cairn Keeper","Gale Elemental","Rimefang Drake","Notch Devourer"],
        cover:["the wind","bare rock","a cairn"],
        names:["Hoarfrost","Galewrack","Rimefang","Stonecrown"] },
    ],
  },
};

export const REGION_KEYS = Object.keys(REGIONS);
export const DEFAULT_REGION = "greens";

export function biomeFor(regionId, ft) {
  const r = REGIONS[regionId] || REGIONS[DEFAULT_REGION];
  return r.biomes.find(b => ft >= b.min && ft < b.max) || r.biomes[r.biomes.length - 1];
}
export const biomesOf = regionId => (REGIONS[regionId] || REGIONS[DEFAULT_REGION]).biomes;

export const SEASONS = [
  { key:"summer",   name:"Summer",      grace:1.00, note:"Everything open." },
  { key:"shoulder", name:"Shoulder",    grace:0.85, note:"Ice above treeline. Thresholds ease 15%." },
  { key:"winter",   name:"Deep winter", grace:0.65, note:"High ground closed. Thresholds ease 35%." },
];
export const seasonGrace = key => (SEASONS.find(s => s.key === key) || SEASONS[0]).grace;

/* ============================================================================
   3. SCALING — identical in every region. This keeps progression honest.
   ========================================================================= */

export const CLASS_MULT = [1, 1.15, 1.35, 1.6];
export const clampClass = c => Math.min(4, Math.max(1, Math.round(c || 1)));

export const energyMiles = (distance, gain, trailClass = 1) =>
  (distance + gain / TUNING.gainPerEnergyMile) * CLASS_MULT[clampClass(trailClass) - 1];

export const lootTier = ft =>
  ft >= 5500 ? 5 : ft >= 4000 ? 4 : ft >= 2500 ? 3 : ft >= 1000 ? 2 : 1;

export function ratingFor(ft, trailClass = 1, elite = false, playerLevel = 1) {
  let r = (TUNING.ratingBase + (ft / 1000) * TUNING.ratingSlopePer1000ft)
        * CLASS_MULT[clampClass(trailClass) - 1]
        * (elite ? TUNING.eliteRatingMult : 1);
  if (MITIGATIONS.levelTerm) {
    r *= 1 + Math.min(MITIGATIONS.levelTermCap,
      (playerLevel / 10) * MITIGATIONS.levelTermPer10);
  }
  return r;
}

export const xpForLevel = n =>
  Math.round(TUNING.levelCurveBase * Math.pow(n, TUNING.levelCurveExp));

export function levelFromXp(xp) {
  let level = 1, need = xpForLevel(1), spent = 0;
  while (xp - spent >= need && level < 99) { spent += need; level++; need = xpForLevel(level); }
  return { level, into: xp - spent, need };
}

/* ============================================================================
   4. GEAR
   ========================================================================= */

export const SLOTS = {
  Boots:{ weight:3 }, Shell:{ weight:4 }, Hands:{ weight:1 }, Head:{ weight:2 },
  Trinket:{ weight:1 }, Staff:{ weight:6 }, Pack:{ weight:5, grantsCapacity:true },
};
export const SLOT_KEYS = Object.keys(SLOTS);

export const RARITY = {
  Common:   { weight:55, mult:1.0, salvage:1,  color:"#6E7A6A" },
  Uncommon: { weight:26, mult:1.4, salvage:3,  color:"#3F7A52" },
  Rare:     { weight:13, mult:1.9, salvage:8,  color:"#3E6E90" },
  Epic:     { weight:5,  mult:2.6, salvage:18, color:"#7A4A8C" },
  Legendary:{ weight:1,  mult:3.6, salvage:40, color:"#B0682A" },
};
export const RARITY_KEYS = Object.keys(RARITY);

export const ITEM_PREFIX = {
  marsh:["Tidewrack","Brackish","Reed-Bound"], barrens:["Ashen","Sandworn","Pitch-Dark"],
  moraine:["Kettlestone","Erratic","Glacier-Cut"], bottom:["Siltbound","Floodworn"],
  hardwood:["Blazefinder's","Deadfall","Fern-Wrought"], ledge:["Updraft","Bare-Rock","Ledgewarden's"],
  valley:["Trodden","Creekside","Mud-Caked"], northern:["Birchbound","Blowdown","Hollow-Cairn"],
  woodland:["Blazefinder's","Deadfall","Fern-Wrought"], montane:["Switchback","Stormseeker's","Cairnwarden's"],
  subalpine:["Timberline","Windshorn","Frostbitten"], alpine:["Summitborn","Rimeforged","Skyward"],
};

export const capacityOf = gear =>
  TUNING.baseCapacity + (gear?.Pack?.capacityGranted || 0);

export const rawGearPower = gear =>
  Object.values(gear || {}).reduce((s, i) => s + (i?.power || 0), 0);

/** MITIGATION 1: effective power saturates toward an asymptote instead of
    climbing forever. This is the only fix that works in random-encounter
    mode, where there is no campaign tier to choose. */
export function effectiveGearPower(gear) {
  const raw = rawGearPower(gear);
  if (!MITIGATIONS.diminishingGear) return raw;
  const s = MITIGATIONS.gearSoftCap;
  return (2 * s * raw) / (s + raw);
}

export const reforgeCost = n => Math.round(TUNING.reforgeBase * Math.pow(TUNING.reforgeStep, n));
export const salvageValue = item => RARITY[item?.rarity]?.salvage ?? 1;

/* ============================================================================
   5. NEMESIS
   ========================================================================= */

export const NEMESIS_TITLES = [
  "the Unpassed","who holds the line","the Turning-Back",
  "Warden of the Height","who remembers you",
];

export const BESTIARY_TIERS = [
  { at:1, label:"Sighted",  text:"You've seen it and lived. That counts for something." },
  { at:2, label:"Habits",   text:"You know where it waits and how it opens." },
  { at:3, label:"Weakness", text:"You know what it protects. Aim there." },
  { at:5, label:"Mastered", text:"Nothing about it surprises you any more." },
];
export const knowledgeOf = insight =>
  [...BESTIARY_TIERS].reverse().find(t => insight >= t.at) || null;

export const nemesisKey = (biomeKey, mob) => `${biomeKey}:${mob}`;

export function stageOf(turnbacks) {
  if (turnbacks >= 3) return "titled";
  if (turnbacks >= 2) return "named";
  if (turnbacks >= 1) return "marked";
  return "anonymous";
}

export function nemesisLabel(nem, fallbackMob) {
  if (!nem) return fallbackMob;
  const stage = stageOf(nem.turnbacks || 0);
  if (stage === "titled" && nem.name) return `${nem.name}, ${nem.title}`;
  if (stage === "named" && nem.name) return nem.name;
  return nem.mob || fallbackMob;
}

/** Is this account winnable yet? Insight outpaces escalation by design,
    so the answer eventually becomes yes no matter how badly it's going. */
export function reckoning(nem) {
  const theirs = 1 + TUNING.nemesisEscalation * (nem.turnbacks || 0);
  const yours  = 1 + TUNING.nemesisInsightGain * (nem.insight || 0);
  return { theirs, yours, ready: yours >= theirs * TUNING.clearMargin };
}

/* ============================================================================
   6. CAMPAIGN — chapters, branches, and the three-ladder resolver
   ========================================================================= */

/* Requirements are written RELATIVE, never in feet. The spine of a campaign
   must read the same at 400 ft and 6,300 ft. */
export const CAMPAIGNS = {
  stones: {
    id:"stones",
    name:"What Stacks the Stones",
    free:true,
    chapters:{
      c1:{ id:"c1", ch:"I", title:"Stones That Weren't There",
        prompt:"Three hikers this month reported the same thing: a cairn on a stretch of trail that has never needed one. Go up and look at it.",
        req:{ relElev:0.35, relGain:0.25 }, alt:{ relDist:0.35 },
        branches:["c2a","c2b","rest"] },
      c2a:{ id:"c2a", ch:"II", title:"Follow Them Up",
        prompt:"There's another one above the first, and another above that. Whatever is stacking them is working uphill and it isn't in a hurry.",
        req:{ relElev:0.60, relGain:0.45 }, alt:{ relDist:0.55 },
        branches:["c3a","c3b","rest"] },
      c2b:{ id:"c2b", ch:"II", title:"Find the First One",
        prompt:"Cairns point somewhere, which means they started somewhere. Walk the line back down and out until you find the one at the bottom.",
        req:{ relDist:0.55 }, alt:{ relGain:0.40 },
        branches:["c3a","c3b","rest"] },
      c3a:{ id:"c3a", ch:"III", title:"The Last Cover",
        prompt:"The cairns keep going past where the trail stops being generous. Everything above here is open ground, and so are you.",
        req:{ relElev:0.85, relGain:0.60 }, alt:{ relDist:0.75, minClass:3 },
        branches:["c4","rest"] },
      c3b:{ id:"c3b", ch:"III", title:"The Direct Line",
        prompt:"There's a straight way up alongside the cairns. It involves hands. The people who call it a shortcut are lying to you.",
        req:{ minClass:3, relGain:0.65 }, alt:{ relElev:0.85 },
        branches:["c4","rest"] },
      c4:{ id:"c4", ch:"IV", title:"The Builder",
        prompt:"The last cairn is on the highest ground your region has, and it is finished. Something is standing next to it, waiting to see who comes up.",
        req:{ relElev:0.97, relGain:0.80, relDist:0.85 }, alt:null,
        branches:[] },
      rest:{ id:"rest", ch:"—", title:"Sit Down and Count",
        prompt:"Your legs are gone and you know it. Take the days. The cairns aren't going anywhere, which is its own kind of problem.",
        req:{ restDays:2 }, alt:null, isRest:true,
        branches:["c1","c2a","c3a"] },
    },
    start:"c1",
  },
};

const round25 = n => Math.round(n / 25) * 25;

/**
 * Resolve one chapter into concrete numbers for one hiker.
 *
 * THE HARD RULE: badges may be forever out of reach; chapter requirements
 * may not. A 4,000-footer is an achievement, never a gate. So we compute
 * several ladders and the player satisfies the easiest.
 */
export function resolveRequirement(chapter, character, opts = {}) {
  const season = opts.season || "summer";
  const g = seasonGrace(season);
  const region = REGIONS[character.regionId] || REGIONS[DEFAULT_REGION];
  const req = chapter.req || {};

  if (req.restDays) {
    return {
      paths:[{ kind:"rest", label:"Rest", restDays:req.restDays, ok:true }],
      easiest:{ kind:"rest", label:"Rest", restDays:req.restDays, ok:true },
      attainable:true, season,
    };
  }

  /* LADDER 1 — region-relative. Solves geography. */
  const regionPath = {
    kind:"region", label:"Region",
    minElev: req.relElev ? round25(region.ceiling * req.relElev * g) : null,
    minGain: req.relGain ? round25(region.bigGain * req.relGain * g) : null,
    minDistance: req.relDist ? +(region.longDist * req.relDist * g).toFixed(1) : null,
    minClass: req.minClass ?? null,
  };

  /* LADDER 2 — personal best plus a modest stretch. This is the ladder that
     makes the campaign universally attainable, and it is more motivating than
     a fixed number because it always sits just past reach.
     Capped at the region figure so nobody shrinks the campaign by logging
     deliberately tiny hikes. */
  const s = TUNING.personalStretch;
  const personalPath = {
    kind:"personal", label:"Personal",
    minElev: req.relElev
      ? Math.min(round25((character.bestElev || 0) * s * g) || Infinity, regionPath.minElev) : null,
    minGain: req.relGain
      ? Math.min(round25((character.bestGain || 0) * s * g) || Infinity, regionPath.minGain) : null,
    minDistance: req.relDist
      ? Math.min(+((character.bestDist || 0) * s * g).toFixed(1) || Infinity, regionPath.minDistance) : null,
    minClass: req.minClass ?? null,
  };

  /* LADDER 3 — the same total gain across several hikes. Identical story,
     earned over a month. How most people with jobs accumulate vertical. */
  const cumulativePath = {
    kind:"cumulative", label:"Cumulative",
    minGain: regionPath.minGain,
    minElev: personalPath.minElev,
    hikes: TUNING.cumulativeHikes,
    minClass: req.minClass ?? null,
  };

  /* ALTERNATIVE — elevation OR distance OR trail class. */
  const altPath = chapter.alt ? {
    kind:"alt", label:"Alternative",
    minDistance: chapter.alt.relDist ? +(region.longDist * chapter.alt.relDist * g).toFixed(1) : null,
    minGain: chapter.alt.relGain ? round25(region.bigGain * chapter.alt.relGain * g) : null,
    minElev: chapter.alt.relElev ? round25(region.ceiling * chapter.alt.relElev * g) : null,
    minClass: chapter.alt.minClass ?? null,
  } : null;

  const within = (best, need, slack = 1.05) => need == null || (best || 0) * slack >= need;
  const canDo = p => p && within(character.bestElev, p.minElev)
    && within(character.bestGain, p.minGain)
    && within(character.bestDist, p.minDistance, 1.1)
    && (p.minClass == null || (character.bestClass || 0) >= p.minClass);

  const paths = [
    { ...regionPath,     ok: canDo(regionPath) },
    { ...personalPath,   ok: true },                 // attainable by construction
    { ...cumulativePath, ok: within(character.bestElev, cumulativePath.minElev) },
    ...(altPath ? [{ ...altPath, ok: canDo(altPath) }] : []),
  ];

  const score = p => (p.minGain ?? 0) + (p.minElev ?? 0) * 0.4 + (p.minDistance ?? 0) * 120;
  const viable = paths.filter(p => p.ok).sort((a, b) => score(a) - score(b));

  return { paths, viable, easiest: viable[0] || null, attainable: viable.length > 0, season };
}

/** Does this hike satisfy the chapter? Checks the easiest open path. */
export function chapterSatisfied(chapter, character, summary, opts = {}) {
  const res = resolveRequirement(chapter, character, opts);
  const p = res.easiest;
  if (!p) return { ok:false, shortfall:["no attainable path"], path:null };

  if (p.kind === "rest") {
    const days = opts.restDays ?? 0;
    return days >= p.restDays
      ? { ok:true, path:p, shortfall:[] }
      : { ok:false, path:p, shortfall:[`${p.restDays - days} more rest day(s)`] };
  }

  const gain = p.kind === "cumulative"
    ? (opts.cumulativeGain ?? summary.gain) : summary.gain;

  const shortfall = [];
  if (p.minDistance && summary.distance < p.minDistance)
    shortfall.push(`${(p.minDistance - summary.distance).toFixed(1)} mi short`);
  if (p.minGain && gain < p.minGain)
    shortfall.push(`${(p.minGain - gain).toLocaleString()} ft short on gain`);
  if (p.minElev && summary.maxElev < p.minElev)
    shortfall.push(`${(p.minElev - summary.maxElev).toLocaleString()} ft below the mark`);
  if (p.minClass && clampClass(summary.trailClass) < p.minClass)
    shortfall.push(`needs Class ${p.minClass} terrain`);

  return { ok: shortfall.length === 0, path:p, shortfall };
}

export const requirementLabel = p => {
  if (!p) return "—";
  if (p.kind === "rest") return `${p.restDays} rest days`;
  const bits = [];
  if (p.minDistance) bits.push(`${p.minDistance} mi`);
  if (p.minGain) bits.push(`${p.minGain.toLocaleString()} ft gain${p.hikes ? ` over ${p.hikes} hikes` : ""}`);
  if (p.minElev) bits.push(`reach ${p.minElev.toLocaleString()} ft`);
  if (p.minClass) bits.push(`Class ${p.minClass}+`);
  return bits.join(" · ") || "—";
};

/* ============================================================================
   7. PLANNING TABLE — intention, study, party
   ========================================================================= */

export function intentionMatches(intention, summary) {
  if (!intention) return false;
  const tol = TUNING.intentionTolerance;
  const near = (actual, target) =>
    target == null || Math.abs(actual - target) <= target * tol;
  return near(summary.distance, intention.dist)
      && near(summary.gain, intention.gain)
      && near(summary.maxElev, intention.peak);
}

/** Bringing lower-level hikers pays the higher-level one. This is the
    mechanic that makes taking your kid up a mountain the best move. */
export function guideBonus(party) {
  const active = (party || []).filter(p => p.active);
  if (!active.length) return { pct:0, members:0, note:"Solo — no guide bonus" };
  const levelSum = active.reduce((s, p) => s + levelFromXp(p.xp || 0).level, 0);
  const pct = Math.min(TUNING.guideBonusCap,
    TUNING.guideBonusPerMember * active.length + TUNING.guideBonusPerLevel * levelSum);
  return { pct, members:active.length,
    note:`${active.length} in party · +${Math.round(pct * 100)}% guide bonus` };
}

export function canStudy(character, nem) {
  return (character.studyCharges || 0) >= 1
    && !nem?.prepared
    && (nem?.insight || 0) >= TUNING.studyInsightRequired;
}

/* ============================================================================
   8. RESOLVE — the encounter engine
   ========================================================================= */

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function weighted(rng, entries) {
  const total = entries.reduce((s, e) => s + e.w, 0);
  let roll = rng() * total;
  for (const e of entries) { roll -= e.w; if (roll <= 0) return e; }
  return entries[entries.length - 1];
}

export function profileFromTrack(points, distance) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const withAlt = points.filter(p => p.alt != null);
  if (withAlt.length < 2) return null;
  const t0 = withAlt[0].t;
  const span = withAlt[withAlt.length - 1].t - t0 || 1;
  return withAlt.map(p => ({
    mi: +(((p.t - t0) / span) * distance).toFixed(2),
    ft: Math.round(p.alt * 3.28084),
  }));
}

export function synthProfile(distance, gain, maxElev, rng) {
  const N = 64, base = Math.max(0, maxElev - gain), out = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const u = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
    let ft = base + (maxElev - base) * Math.pow(u, 0.85);
    ft += (rng() - 0.5) * (maxElev - base) * 0.03;
    out.push({ mi:+(t * distance).toFixed(2), ft:Math.max(0, Math.round(ft)) });
  }
  return out;
}

/**
 * @param summary    output of summarizeTrack()
 * @param character  { regionId, xp, gear, condition, nemeses, intention, party }
 * @param opts       { seed, trackPoints, season, campaignTier }
 */
export function resolveHike(summary, character, opts = {}) {
  const { distance = 0, gain = 0, maxElev = 0, trailClass = 1 } = summary || {};
  const regionId = character.regionId || DEFAULT_REGION;
  const region = REGIONS[regionId];

  const seedStr = String(opts.seed ?? `${distance}|${gain}|${maxElev}|${character.hikes || 0}`);
  const rng = mulberry32(hashString(seedStr));

  const cls = clampClass(trailClass);
  const effort = energyMiles(distance, gain, cls);
  const playerLevel = levelFromXp(character.xp || 0).level;

  const profile = profileFromTrack(opts.trackPoints, distance)
    ?? synthProfile(distance, gain, maxElev, rng);

  const summitIdx = profile.reduce((b, p, i) => (p.ft > profile[b].ft ? i : b), 0);
  const count = Math.min(TUNING.maxEncounters,
    Math.max(1, Math.round(effort * TUNING.encountersPerEnergyMile)));

  const slots = [];
  for (let i = 0; i < count; i++) {
    let idx = Math.round(((i + 0.5) / count) * (profile.length - 1) + (rng() - 0.5) * 4);
    slots.push(Math.min(profile.length - 1, Math.max(0, idx)));
  }
  if (count > 1) slots[Math.floor(count / 2)] = summitIdx;

  const condition = character.condition ?? 100;
  const gearPower = effectiveGearPower(character.gear);
  const nemeses = character.nemeses || {};
  const tier = MITIGATIONS.campaignTiers
    ? (CAMPAIGN_TIERS.find(t => t.key === opts.campaignTier) || CAMPAIGN_TIERS[0])
    : { rating:1, reward:1 };

  /* ---- pass 1: outcomes ---- */
  const seenThisHike = new Set();
  const draft = [];

  slots.forEach((idx, i) => {
    const point = profile[idx];
    const biome = biomeFor(regionId, point.ft);
    const elite = idx === summitIdx && count > 1;
    const atApex = elite && maxElev >= region.ceiling * 0.9;

    /* A given nemesis appears AT MOST ONCE per hike. Without this, one
       creature can be met five times in an afternoon and escalate absurdly. */
    const open = Object.entries(nemeses).filter(([k, v]) =>
      v.biome === biome.key && !v.defeated && v.turnbacks > 0 && !seenThisHike.has(k));
    const useNemesis = open.length > 0 && rng() < TUNING.nemesisAppearChance;

    let mob, key, nem;
    if (useNemesis) {
      [key, nem] = open[Math.floor(rng() * open.length)];
      mob = nem.mob;
    } else {
      mob = atApex ? biome.apex : pick(rng, biome.mobs);
      key = nemesisKey(biome.key, mob);
      if (seenThisHike.has(key)) key = `${key}#${i}`;   // a different individual
      nem = nemeses[key] ?? null;
    }
    seenThisHike.add(key);

    const turnbacks = nem?.turnbacks ?? 0;
    const insight = nem?.insight ?? 0;
    const prepared = !!nem?.prepared;

    const baseRating = ratingFor(point.ft, cls, elite, playerLevel);
    const rating = baseRating * (1 + TUNING.nemesisEscalation * turnbacks) * tier.rating;

    const conditionFactor = TUNING.conditionFloorFactor
      + (1 - TUNING.conditionFloorFactor) * (condition / 100);
    const effPower = gearPower * conditionFactor
      * (1 + TUNING.nemesisInsightGain * insight)
      * (prepared ? 1 + TUNING.preparedBonus : 1);

    const variance = TUNING.varianceLow + rng() * (TUNING.varianceHigh - TUNING.varianceLow);
    const margin = (effPower / Math.max(1, rating)) * variance;
    const outcome = margin >= TUNING.clearMargin ? "cleared" : margin >= 1 ? "costly" : "turnback";

    draft.push({ index:i, point, biome, elite, atApex, mob, key, nem,
      turnbacks, insight, prepared, baseRating, rating, effPower, margin, outcome });
  });

  /* ---- the turnback cap ----
     You cannot be turned back nine times in one day; you would have gone
     home. Also stops a first-time player collecting a dozen grudges at once. */
  const maxTurnbacks = Math.max(1, Math.ceil(draft.length * TUNING.maxTurnbackFraction));
  draft.filter(d => d.outcome === "turnback")
    .sort((a, b) => b.margin - a.margin)
    .slice(maxTurnbacks)
    .forEach(d => { d.outcome = "costly"; d.softened = true; });

  /* ---- pass 2: rewards and state ---- */
  const encounters = [], drops = [], nemesisUpdates = {};
  let encounterXp = 0;

  draft.forEach(d => {
    const { point, biome, elite, atApex, mob, key, nem,
            turnbacks, insight, prepared, baseRating, rating, effPower, outcome } = d;
    const i = d.index;

    const becomesNamed = outcome === "turnback" && turnbacks === 1;
    const settles = outcome !== "turnback" && turnbacks >= 2;

    let name = nem?.name ?? null, title = nem?.title ?? null, assignedName = null;
    if (becomesNamed && !name) {
      name = pick(rng, biome.names);
      title = pick(rng, NEMESIS_TITLES);
      assignedName = name;
    }

    const settleMult = settles ? 1 + turnbacks * TUNING.settleBonusPerTurnback : 1;
    const xp = Math.round(rating * TUNING.xpPerEncounterRating
      * (elite ? TUNING.eliteXpMult : 1)
      * (outcome === "turnback" ? TUNING.turnbackXpFraction : 1)
      * settleMult * tier.reward);
    encounterXp += xp;

    nemesisUpdates[key] = {
      biome:biome.key, mob,
      turnbacks: turnbacks + (outcome === "turnback" ? 1 : 0),
      insight: insight + 1,
      name, title,
      prepared:false,                        // a prepared plan is consumed on use
      defeated: settles ? true : (nem?.defeated ?? false),
      settledTurnbacks: settles ? turnbacks : (nem?.settledTurnbacks ?? null),
      lastFt:point.ft, lastSeen:Date.now(),
    };

    const lt = lootTier(point.ft);
    const dropChance = (TUNING.dropChanceBase + lt * TUNING.dropChancePerTier
      + (elite ? TUNING.eliteDropBonus : 0))
      * (outcome === "turnback" ? 0 : outcome === "costly" ? TUNING.costlyDropFactor : 1);

    let drop = null;
    if (rng() < dropChance) {
      const table = RARITY_KEYS.map(k => ({
        k, w: RARITY[k].weight * (RARITY[k].mult > 1.5 ? 1 + lt * 0.55 + (elite ? 1.6 : 0) : 1),
      }));
      const rarKey = weighted(rng, table).k;
      const rar = RARITY[rarKey];
      const slot = pick(rng, SLOT_KEYS);
      drop = {
        id:`${seedStr}-${i}-${slot}`, slot,
        name:`${pick(rng, ITEM_PREFIX[biome.key] || ITEM_PREFIX.montane)} ${slot}`,
        rarity:rarKey,
        power:Math.round((TUNING.lootPowerBase + lt * TUNING.lootPowerPerTier) * rar.mult),
        weight:Math.max(1, Math.round(SLOTS[slot].weight * (0.8 + rar.mult * 0.35))),
        capacityGranted: SLOTS[slot].grantsCapacity
          ? Math.round(6 + rar.mult * 7 + lt * 1.5) : 0,
        fromEncounter:i,
      };
      drops.push(drop);
    }

    encounters.push({
      index:i, mile:point.mi, elevation:point.ft,
      biomeKey:biome.key, biomeName:biome.name, tint:biome.tint,
      cover:pick(rng, biome.cover),
      mob, display:nemesisLabel({ turnbacks, name, title, mob }, mob),
      assignedName, nemesisName:name, nemesisTitle:title,
      elite, atApex, outcome, softened:!!d.softened,
      rating:Math.round(rating), baseRating:Math.round(baseRating),
      effPower:Math.round(effPower),
      turnbacks, insight, prepared, becomesNamed, settles,
      xp, drop,
    });
  });

  /* ---- totals ---- */
  const terrainXp = Math.round(effort * TUNING.xpPerEnergyMile * tier.reward);
  const summitXp = Math.round((maxElev / 1000) * TUNING.summitXpPer1000ft * lootTier(maxElev));

  const guide = guideBonus(character.party);
  const subtotal = encounterXp + terrainXp + summitXp;
  const guideXp = Math.round(subtotal * guide.pct);

  const intentionMet = intentionMatches(character.intention, summary);
  const intentionBonus = intentionMet ? Math.round(subtotal * TUNING.intentionBonus) : 0;

  const totalXp = subtotal + guideXp + intentionBonus;

  const costly = encounters.filter(e => e.outcome === "costly").length;
  const conditionSpent = Math.min(100,
    Math.round(effort * TUNING.conditionPerEnergyMile + costly * TUNING.conditionPerCostly));

  const before = levelFromXp(character.xp || 0).level;
  const after = levelFromXp((character.xp || 0) + totalXp).level;

  return {
    regionId, profile, summitIdx,
    effort:+effort.toFixed(1),
    challengeRating:Math.max(1, Math.round(effort * 0.55 + lootTier(maxElev) * 1.6)),
    encounters, drops, nemesisUpdates,
    tally:{
      cleared:encounters.filter(e => e.outcome === "cleared").length,
      costly,
      turnback:encounters.filter(e => e.outcome === "turnback").length,
      named:encounters.filter(e => e.becomesNamed).length,
      settled:encounters.filter(e => e.settles).length,
    },
    xp:{ encounterXp, terrainXp, summitXp, guideXp, intentionBonus, total:totalXp },
    guide, intentionMet, conditionSpent,
    levelUp: after > before ? after : null,
    capacity:capacityOf(character.gear),
  };
}

/* ============================================================================
   9. COMMIT
   ========================================================================= */

export function commitHike(character, result, summary, hauledIds = []) {
  const gear = { ...(character.gear || {}) };
  const stash = [...(character.stash || [])];

  result.drops.filter(d => hauledIds.includes(d.id)).forEach(item => {
    const current = gear[item.slot];
    if (!current || item.power > current.power) {
      if (current) stash.push(current);
      gear[item.slot] = { ...item, reforges:0 };
    } else stash.push(item);
  });

  const nemeses = { ...(character.nemeses || {}) };
  Object.entries(result.nemesisUpdates).forEach(([k, v]) => { nemeses[k] = v; });

  const trophies = [...(character.trophies || [])];
  result.encounters.filter(e => e.settles).forEach(e => {
    trophies.push({
      key:nemesisKey(e.biomeKey, e.mob), name:e.display, biome:e.biomeKey,
      turnbacks:e.turnbacks, elevation:e.elevation, at:Date.now(),
    });
  });

  /* party members hiked the same track: terrain and encounter xp, no guide bonus */
  const memberXp = result.xp.encounterXp + result.xp.terrainXp + result.xp.summitXp;
  const party = (character.party || []).map(p =>
    p.active ? { ...p, xp:(p.xp || 0) + memberXp } : p);

  return {
    ...character,
    xp:(character.xp || 0) + result.xp.total,
    hikes:(character.hikes || 0) + 1,
    guidedHikes:(character.guidedHikes || 0) + (result.guide.pct > 0 ? 1 : 0),
    totalMiles:+(((character.totalMiles || 0) + summary.distance).toFixed(1)),
    totalGain:(character.totalGain || 0) + summary.gain,
    bestGain:Math.max(character.bestGain || 0, summary.gain),
    bestElev:Math.max(character.bestElev || 0, summary.maxElev),
    bestDist:Math.max(character.bestDist || 0, summary.distance),
    bestClass:Math.max(character.bestClass || 0, clampClass(summary.trailClass)),
    condition:Math.max(0, (character.condition ?? 100) - result.conditionSpent),
    gear, stash:stash.slice(-60), nemeses, trophies, party,
    intention:null,                       // consumed either way — a promise, not a debt
    lastHikeAt:Date.now(),
  };
}

/* ============================================================================
   10. BADGES
   ========================================================================= */

export const BADGES = [
  { id:"first",    name:"First Blaze",        test:t=>t.hikes>=1,        desc:"Log your first hike" },
  { id:"g1k",      name:"Thousand-Footer",    test:t=>t.bestGain>=1000,  desc:"1,000 ft gain in one hike" },
  { id:"g2k",      name:"Two-Thousand Club",  test:t=>t.bestGain>=2000,  desc:"2,000 ft gain in one hike" },
  { id:"g4k",      name:"Four-Thousand Club", test:t=>t.bestElev>=4000,  desc:"Stand above 4,000 ft" },
  { id:"treeline", name:"Above the Trees",    test:t=>t.bestElev>=5500,  desc:"Break treeline" },
  { id:"mi10",     name:"Ten-Mile Day",       test:t=>t.bestDist>=10,    desc:"10 miles in one hike" },
  { id:"mi50",     name:"Fifty Lifetime",     test:t=>t.totalMiles>=50,  desc:"50 miles logged" },
  { id:"scramble", name:"Hands and Feet",     test:t=>t.bestClass>=4,    desc:"Complete a Class 4 scramble" },
  { id:"vert5",    name:"Vertical Mile",      test:t=>t.totalGain>=5280, desc:"5,280 ft cumulative gain" },
  { id:"regular",  name:"Trail Regular",      test:t=>t.hikes>=10,       desc:"Log 10 hikes" },
  { id:"guide",    name:"Trail Guide",        test:t=>t.guidedHikes>=5,  desc:"Lead 5 hikes with a party" },
  { id:"settle",   name:"Old Scores",         test:t=>(t.trophies||[]).length>=3, desc:"Settle 3 open accounts" },
  { id:"biomes",   name:"Knows the Ground",   test:t=>biomeBreadth(t)>=5, desc:"Meet something in 5 different biomes" },
];

export const biomeBreadth = character =>
  new Set(Object.values(character.nemeses || {}).map(n => n.biome)).size;

/* Badges may be forever out of reach. Chapter requirements may not.
   Nothing in the game gates on a badge. */
