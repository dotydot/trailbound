/* ------------------------------------------------------------
   src/game/world.js
   Regions, biomes, and the absolute scaling that never varies.

   Pure data and pure functions. No React, no platform APIs —
   this file is identical between the app and any test harness.
   ------------------------------------------------------------ */

/* Biome decides WHAT you meet and how the log reads.
   Absolute elevation decides HOW HARD it is and what it pays.
   Those two axes stay separate on purpose. */

export const REGIONS = {
  coastal: {
    id: "coastal",
    name: "Coastal Plain",
    where: "Long Island, Cape Cod, Jersey Shore",
    ceiling: 400, bigGain: 500, longDist: 8,
    biomes: [
      { key:"marsh", name:"Salt Marsh", min:0, max:60, tint:"#5E8C7F",
        apex:"The Tide-Keeper",
        mobs:["Reedwhisper","Brackish Crawler","Fiddler Swarm","Netted Drifter"],
        cover:["the reeds","a culvert","the mud"] },
      { key:"barrens", name:"Pine Barrens", min:60, max:180, tint:"#7E8B4A",
        apex:"The Ashen Warden",
        mobs:["Pitch-Pine Husk","Scrub Oak Stalker","Sand Road Wraith","Cicada Choir"],
        cover:["the scrub","a sand road","the pitch pine"] },
      { key:"moraine", name:"Terminal Moraine", min:180, max:Infinity, tint:"#B08A4E",
        apex:"The Glacier's Debt",
        mobs:["Kettle-Hole Shade","Erratic Golem","Bluff-Edge Harrier","Drumlin Wyrm"],
        cover:["the erratics","a kettle hole","the bluff"] },
    ],
  },
  highlands: {
    id: "highlands",
    name: "Hudson Highlands",
    where: "Hudson Valley, Poconos, Blue Ridge foothills",
    ceiling: 1500, bigGain: 1800, longDist: 9,
    biomes: [
      { key:"bottom", name:"River Bottom", min:0, max:300, tint:"#5E8C7F",
        apex:"The Ferryman's Toll",
        mobs:["Silt Lurker","Sycamore Shade","Floodplain Serpent"],
        cover:["the silt","the sycamores"] },
      { key:"hardwood", name:"Hardwood Slope", min:300, max:800, tint:"#8FA84E",
        apex:"The Oak Sovereign",
        mobs:["Talus Hound","Chestnut Revenant","Laurel Snare","Slope-Fog Walker"],
        cover:["the laurel","a stone wall","the leaf litter"] },
      { key:"ledge", name:"Open Ledge", min:800, max:Infinity, tint:"#C9973F",
        apex:"The Ledge Tyrant",
        mobs:["Scrub-Ledge Drake","Cairn Shade","Updraft Elemental","Bare-Rock Warden"],
        cover:["the blueberry scrub","bare rock","the updraft"] },
    ],
  },
  greens: {
    id: "greens",
    name: "Green Mountains",
    where: "Vermont, Berkshires, southern Maine",
    ceiling: 4000, bigGain: 3000, longDist: 11,
    biomes: [
      { key:"valley", name:"Valley Floor", min:0, max:1000, tint:"#7A9A5B",
        apex:"The Millpond Warden",
        mobs:["Mud Lurker","Culvert Serpent","Fallen-Log Troll"],
        cover:["the reeds","a culvert","the mud"] },
      { key:"northern", name:"Northern Hardwood", min:1000, max:2500, tint:"#8FA84E",
        apex:"The Birch Sovereign",
        mobs:["Bramble Stalker","Blowdown Ent","Root-Snare Wraith","Hollow Cairn Shade"],
        cover:["the deadfall","the brambles","a blowdown"] },
      { key:"montane", name:"Montane Spruce", min:2500, max:Infinity, tint:"#C9A34E",
        apex:"The Spruce Sovereign",
        mobs:["Switchback Wyrm","Scree Hound Pack","Mossback Ogre","Fog-Walker"],
        cover:["the fog","a talus field","the scrub"] },
    ],
  },
  whites: {
    id: "whites",
    name: "White Mountains",
    where: "New Hampshire, western Maine, Adirondacks",
    ceiling: 6300, bigGain: 4200, longDist: 13,
    biomes: [
      { key:"valley", name:"Valley Floor", min:0, max:1000, tint:"#7A9A5B",
        apex:"The Notch Gatekeeper",
        mobs:["Mud Lurker","Culvert Serpent","Fallen-Log Troll"],
        cover:["the reeds","a culvert","the mud"] },
      { key:"woodland", name:"Woodland", min:1000, max:2500, tint:"#8FA84E",
        apex:"The Blowdown King",
        mobs:["Bramble Stalker","Blowdown Ent","Root-Snare Wraith"],
        cover:["the deadfall","the brambles","a blowdown"] },
      { key:"montane", name:"Montane", min:2500, max:4000, tint:"#C9A34E",
        apex:"The Fog Sovereign",
        mobs:["Switchback Wyrm","Scree Hound Pack","Mossback Ogre"],
        cover:["the fog","a talus field","the scrub"] },
      { key:"subalpine", name:"Subalpine", min:4000, max:5500, tint:"#D4813C",
        apex:"The Krummholz Tyrant",
        mobs:["Krummholz Warden","Talus Golem","Whiteout Revenant"],
        cover:["the krummholz","the scree","a whiteout"] },
      { key:"alpine", name:"Above Treeline", min:5500, max:Infinity, tint:"#B9502F",
        apex:"The Sovereign of the Height",
        mobs:["Summit Cairn Keeper","Gale Elemental","Rimefang Drake"],
        cover:["the wind","bare rock","a cairn"] },
    ],
  },
};

export const REGION_KEYS = Object.keys(REGIONS);
export const DEFAULT_REGION = "greens";

export function biomeFor(regionId, ft) {
  const r = REGIONS[regionId] || REGIONS[DEFAULT_REGION];
  return r.biomes.find(b => ft >= b.min && ft < b.max) || r.biomes[r.biomes.length - 1];
}

/* ---------- absolute scaling: identical in every region ----------
   This is what keeps progression honest. A coastal hiker levels
   more slowly than an alpine one, and that's the truth. */

export const CLASS_MULT = [1, 1.15, 1.35, 1.6];
export const clampClass = c => Math.min(4, Math.max(1, Math.round(c || 1)));

/** Energy miles: ~1 mile of effort per 500 ft of gain, scaled by terrain. */
export const energyMiles = (distance, gain, trailClass = 1) =>
  (distance + gain / 500) * CLASS_MULT[clampClass(trailClass) - 1];

/** Loot tier from ABSOLUTE elevation. Same thresholds worldwide. */
export const lootTier = ft =>
  ft >= 5500 ? 5 : ft >= 4000 ? 4 : ft >= 2500 ? 3 : ft >= 1000 ? 2 : 1;

/** Encounter rating from ABSOLUTE elevation, never from biome.
    A Salt Marsh creature and a Valley Floor creature at the same
    altitude hit equally hard — they just aren't the same thing. */
export const ratingFor = (ft, trailClass = 1, elite = false) =>
  (7 + (ft / 1000) * 9.5) * CLASS_MULT[clampClass(trailClass) - 1] * (elite ? 1.75 : 1);

/* ---------- progression ---------- */
export const xpForLevel = n => Math.round(420 * Math.pow(n, 1.55));

export function levelFromXp(xp) {
  let level = 1, need = xpForLevel(1), spent = 0;
  while (xp - spent >= need && level < 99) {
    spent += need; level++; need = xpForLevel(level);
  }
  return { level, into: xp - spent, need };
}

/* ---------- gear ---------- */
export const SLOTS = {
  Boots:   { weight:3 }, Shell: { weight:4 }, Hands: { weight:1 },
  Head:    { weight:2 }, Trinket: { weight:1 }, Staff: { weight:6 },
  Pack:    { weight:5, grantsCapacity:true },
};
export const SLOT_KEYS = Object.keys(SLOTS);
export const BASE_CAPACITY = 22;

export const RARITY = {
  Common:    { weight:55, mult:1.0, salvage:1,  color:"#6E7A6A" },
  Uncommon:  { weight:26, mult:1.4, salvage:3,  color:"#3F7A52" },
  Rare:      { weight:13, mult:1.9, salvage:8,  color:"#3E6E90" },
  Epic:      { weight:5,  mult:2.6, salvage:18, color:"#7A4A8C" },
  Legendary: { weight:1,  mult:3.6, salvage:40, color:"#B0682A" },
};
export const RARITY_KEYS = Object.keys(RARITY);

export const ITEM_PREFIX = {
  marsh:["Tidewrack","Brackish","Reed-Bound"],
  barrens:["Ashen","Sandworn","Pitch-Dark"],
  moraine:["Kettlestone","Erratic","Glacier-Cut"],
  bottom:["Siltbound","Floodworn"],
  hardwood:["Blazefinder's","Deadfall","Fern-Wrought"],
  ledge:["Updraft","Bare-Rock","Ledgewarden's"],
  valley:["Trodden","Creekside","Mud-Caked"],
  northern:["Birchbound","Blowdown","Hollow-Cairn"],
  woodland:["Blazefinder's","Deadfall","Fern-Wrought"],
  montane:["Switchback","Stormseeker's","Cairnwarden's"],
  subalpine:["Timberline","Windshorn","Frostbitten"],
  alpine:["Summitborn","Rimeforged","Skyward"],
};

/* ---------- nemesis constants ---------- */
export const NEMESIS = {
  escalation: 0.12,     // creature gains this per turnback
  insightGain: 0.20,    // you gain this per point of insight — deliberately larger
  preparedBonus: 0.30,
  settleBonusPerTurnback: 0.60,
  names: {
    marsh:["Saltwrack","Bittern","Reedmourn","Chandler"],
    barrens:["Ninebark","Cinderjack","Sandhollow","Ashwold"],
    moraine:["Kettlestone","Drumlin","Coldwater","Marlpit"],
    bottom:["Silthollow","Ferryman"],
    hardwood:["Hornbeam","Blackbriar","Thornwake"],
    ledge:["Updraught","Stonecrop","Ledgewake"],
    valley:["Alderwick","Millrace","Culvertine"],
    northern:["Birchmourn","Deadfall","Hollowcairn"],
    woodland:["Deadfall","Hornbeam","Blackbriar","Thornwake"],
    montane:["Fogmantle","Switchback","Screehowl","Greywether"],
    subalpine:["Rimewood","Windshear","Brackenfell","Coldspar"],
    alpine:["Hoarfrost","Galewrack","Rimefang","Stonecrown"],
  },
  titles:["the Unpassed","who holds the line","the Turning-Back",
          "Warden of the Height","who remembers you"],
};

export const BESTIARY_TIERS = [
  { at:1, label:"Sighted",  text:"You've seen it and lived. That counts for something." },
  { at:2, label:"Habits",   text:"You know where it waits and how it opens." },
  { at:3, label:"Weakness", text:"You know what it protects. Aim there." },
  { at:5, label:"Mastered", text:"Nothing about it surprises you any more." },
];
export const knowledgeOf = insight =>
  [...BESTIARY_TIERS].reverse().find(t => insight >= t.at) || null;

/* ---------- badges ---------- */
export const BADGES = [
  { id:"first",    name:"First Blaze",        test:t=>t.hikes>=1,       desc:"Log your first hike" },
  { id:"g1k",      name:"Thousand-Footer",    test:t=>t.bestGain>=1000, desc:"1,000 ft gain in one hike" },
  { id:"g2k",      name:"Two-Thousand Club",  test:t=>t.bestGain>=2000, desc:"2,000 ft gain in one hike" },
  { id:"g4k",      name:"Four-Thousand Club", test:t=>t.bestElev>=4000, desc:"Stand above 4,000 ft" },
  { id:"treeline", name:"Above the Trees",    test:t=>t.bestElev>=5500, desc:"Break treeline" },
  { id:"mi10",     name:"Ten-Mile Day",       test:t=>t.bestDist>=10,   desc:"10 miles in one hike" },
  { id:"mi50",     name:"Fifty Lifetime",     test:t=>t.totalMiles>=50, desc:"50 miles logged" },
  { id:"scramble", name:"Hands and Feet",     test:t=>t.bestClass>=4,   desc:"Complete a Class 4 scramble" },
  { id:"vert5",    name:"Vertical Mile",      test:t=>t.totalGain>=5280,desc:"5,280 ft cumulative gain" },
  { id:"regular",  name:"Trail Regular",      test:t=>t.hikes>=10,      desc:"Log 10 hikes" },
  { id:"guide",    name:"Trail Guide",        test:t=>t.guidedHikes>=5, desc:"Lead 5 hikes with a party" },
];

/* NOTE: badges are allowed to be forever out of reach. Chapter
   requirements are not. Nothing in the game gates on a badge. */
