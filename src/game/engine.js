/* ------------------------------------------------------------
   src/game/engine.js
   Turns a validated track summary into encounters, loot and XP.

   Pure functions. Deterministic given the same seed, so a hike
   can be re-resolved after a balance patch without re-hiking.
   ------------------------------------------------------------ */

import {
  REGIONS, biomeFor, energyMiles, lootTier, ratingFor, clampClass,
  SLOTS, SLOT_KEYS, BASE_CAPACITY, RARITY, RARITY_KEYS, ITEM_PREFIX,
  NEMESIS, levelFromXp,
} from "./world";

/* ---------- deterministic rng ---------- */
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

/* ---------- elevation profile from the real track ----------
   If we have the point list, use it. Otherwise synthesise a
   plausible out-and-back so the engine stays testable. */
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
    out.push({ mi: +(t * distance).toFixed(2), ft: Math.max(0, Math.round(ft)) });
  }
  return out;
}

/* ---------- nemesis helpers ---------- */
export const nemesisKey = (biomeKey, mob) => `${biomeKey}:${mob}`;

export function stageOf(turnbacks) {
  if (turnbacks >= 3) return "titled";
  if (turnbacks >= 2) return "named";
  if (turnbacks >= 1) return "marked";
  return "anonymous";
}

export function displayName(nem, mob) {
  if (!nem) return mob;
  const stage = stageOf(nem.turnbacks || 0);
  if (stage === "titled" && nem.name) return `${nem.name}, ${nem.title}`;
  if (stage === "named" && nem.name) return nem.name;
  return mob;
}

/* ---------- capacity ---------- */
export const capacityOf = gear =>
  BASE_CAPACITY + (gear?.Pack?.capacityGranted || 0);

export const gearPowerOf = gear =>
  Object.values(gear || {}).reduce((s, i) => s + (i?.power || 0), 0);

/* ============================================================
   THE RESOLVER

   @param summary   output of summarizeTrack()
   @param character { xp, gear, condition, regionId, nemeses }
   @param opts      { seed, trackPoints, intention, campaign }
   ============================================================ */
export function resolveHike(summary, character, opts = {}) {
  const {
    distance = 0, gain = 0, maxElev = 0, trailClass = 1,
  } = summary || {};

  const regionId = character.regionId || "greens";
  const region = REGIONS[regionId];
  const seedStr = opts.seed
    ?? `${distance}|${gain}|${maxElev}|${trailClass}|${character.hikes || 0}`;
  const rng = mulberry32(hashString(String(seedStr)));

  const cls = clampClass(trailClass);
  const effort = energyMiles(distance, gain, cls);

  const profile = profileFromTrack(opts.trackPoints, distance)
    ?? synthProfile(distance, gain, maxElev, rng);

  const summitIdx = profile.reduce((b, p, i) => (p.ft > profile[b].ft ? i : b), 0);
  const count = Math.min(12, Math.max(1, Math.round(effort / 1.4)));

  /* place encounters along the track */
  const slots = [];
  for (let i = 0; i < count; i++) {
    let idx = Math.round(((i + 0.5) / count) * (profile.length - 1) + (rng() - 0.5) * 4);
    slots.push(Math.min(profile.length - 1, Math.max(0, idx)));
  }
  if (count > 1) slots[Math.floor(count / 2)] = summitIdx;

  const condition = character.condition ?? 100;
  const gearPower = gearPowerOf(character.gear);
  const nemeses = { ...(character.nemeses || {}) };

  /* ---------- pass 1: outcomes ----------
     Resolved first so the turnback cap can be applied before any
     rewards or nemesis state are computed. */
  const seenThisHike = new Set();
  const draft = [];

  slots.forEach((idx, i) => {
    const point = profile[idx];
    const biome = biomeFor(regionId, point.ft);
    const elite = idx === summitIdx && count > 1;
    const atApex = elite && maxElev >= region.ceiling * 0.9;

    /* An open grudge in this biome is likely to show up — but a given
       nemesis appears AT MOST ONCE per hike. Without this, one creature
       can be met five times in an afternoon and escalate absurdly. */
    const open = Object.entries(nemeses).filter(([k, v]) =>
      v.biome === biome.key && !v.defeated && v.turnbacks > 0 && !seenThisHike.has(k));
    const useNemesis = open.length > 0 && rng() < 0.75;

    let mob, key, nem;
    if (useNemesis) {
      [key, nem] = open[Math.floor(rng() * open.length)];
      mob = nem.mob;
    } else {
      mob = atApex ? biome.apex : pick(rng, biome.mobs);
      key = nemesisKey(biome.key, mob);
      /* a fresh creature of a type already met this hike is a different
         individual — give it its own key so state doesn't collide */
      if (seenThisHike.has(key)) key = `${key}#${i}`;
      nem = nemeses[key] ?? null;
    }
    seenThisHike.add(key);

    const turnbacks = nem?.turnbacks ?? 0;
    const insight = nem?.insight ?? 0;
    const prepared = !!nem?.prepared;

    const baseRating = ratingFor(point.ft, cls, elite);
    const rating = baseRating * (1 + NEMESIS.escalation * turnbacks);

    const conditionFactor = 0.55 + 0.45 * (condition / 100);
    const insightFactor = 1 + NEMESIS.insightGain * insight;
    const preparedFactor = prepared ? 1 + NEMESIS.preparedBonus : 1;
    const effPower = gearPower * conditionFactor * insightFactor * preparedFactor;

    const margin = (effPower / Math.max(1, rating)) * (0.88 + rng() * 0.24);
    const outcome = margin >= 1.25 ? "cleared" : margin >= 1.0 ? "costly" : "turnback";

    draft.push({
      index: i, point, biome, elite, atApex, mob, key, nem,
      turnbacks, insight, prepared,
      baseRating, rating, effPower, margin, outcome,
    });
  });

  /* ---------- the turnback cap ----------
     You cannot be turned back nine times in one day — you would have
     gone home. At most 40% of a hike's encounters can be turnbacks;
     the easiest of the excess become costly wins instead. This also
     stops a first-time player collecting a dozen grudges at once. */
  const maxTurnbacks = Math.max(1, Math.ceil(draft.length * 0.4));
  const turnbackDraft = draft.filter(d => d.outcome === "turnback")
    .sort((a, b) => b.margin - a.margin);           // best margin first
  turnbackDraft.slice(maxTurnbacks).forEach(d => { d.outcome = "costly"; d.softened = true; });

  /* ---------- pass 2: rewards and state ---------- */
  const encounters = [];
  const drops = [];
  const nemesisUpdates = {};
  let encounterXp = 0;

  draft.forEach(d => {
    const { point, biome, elite, atApex, mob, key, nem,
            turnbacks, insight, prepared, baseRating, rating, effPower, outcome } = d;
    const i = d.index;

    const becomesNamed = outcome === "turnback" && turnbacks === 1;
    const settles = outcome !== "turnback" && turnbacks >= 2;

    let name = nem?.name ?? null;
    let title = nem?.title ?? null;
    let assignedName = null;
    if (becomesNamed && !name) {
      const pool = NEMESIS.names[biome.key] || NEMESIS.names.montane;
      name = pick(rng, pool);
      title = pick(rng, NEMESIS.titles);
      assignedName = name;
    }

    const settleMult = settles ? 1 + turnbacks * NEMESIS.settleBonusPerTurnback : 1;
    const xp = Math.round(rating * 2.4 * (outcome === "turnback" ? 0.4 : 1) * settleMult);
    encounterXp += xp;

    nemesisUpdates[key] = {
      biome: biome.key,
      mob,
      turnbacks: turnbacks + (outcome === "turnback" ? 1 : 0),
      insight: insight + 1,
      name, title,
      prepared: false,
      defeated: settles ? true : (nem?.defeated ?? false),
      settledTurnbacks: settles ? turnbacks : (nem?.settledTurnbacks ?? null),
      lastFt: point.ft,
      lastSeen: Date.now(),
    };

    const tier = lootTier(point.ft);
    const dropChance = (0.34 + tier * 0.05 + (elite ? 0.4 : 0))
      * (outcome === "turnback" ? 0 : outcome === "costly" ? 0.5 : 1);

    let drop = null;
    if (rng() < dropChance) {
      const table = RARITY_KEYS.map(k => ({
        k, w: RARITY[k].weight * (RARITY[k].mult > 1.5 ? 1 + tier * 0.55 + (elite ? 1.6 : 0) : 1),
      }));
      const rarKey = weighted(rng, table).k;
      const rar = RARITY[rarKey];
      const slot = pick(rng, SLOT_KEYS);
      const prefixes = ITEM_PREFIX[biome.key] || ITEM_PREFIX.montane;

      drop = {
        id: `${seedStr}-${i}-${slot}`,
        slot,
        name: `${pick(rng, prefixes)} ${slot}`,
        rarity: rarKey,
        power: Math.round((6 + tier * 5) * rar.mult),
        weight: Math.max(1, Math.round(SLOTS[slot].weight * (0.8 + rar.mult * 0.35))),
        capacityGranted: SLOTS[slot].grantsCapacity
          ? Math.round(6 + rar.mult * 7 + tier * 1.5) : 0,
        fromEncounter: i,
      };
      drops.push(drop);
    }

    encounters.push({
      index: i,
      mile: point.mi,
      elevation: point.ft,
      biomeKey: biome.key,
      biomeName: biome.name,
      tint: biome.tint,
      cover: pick(rng, biome.cover),
      mob,
      display: displayName({ turnbacks, name, title }, mob),
      assignedName,
      nemesisName: name,
      nemesisTitle: title,
      elite, atApex,
      outcome,
      softened: !!d.softened,
      rating: Math.round(rating),
      baseRating: Math.round(baseRating),
      effPower: Math.round(effPower),
      turnbacks, insight, prepared,
      becomesNamed, settles,
      xp, drop,
    });
  });

  /* ---------- xp totals ---------- */
  const terrainXp = Math.round(effort * 70);
  const summitXp = Math.round((maxElev / 1000) * 55 * lootTier(maxElev));

  /* declared-route bonus: the only planning-table reward that
     reaches the trail. A promise, never a debt. */
  let intentionBonus = 0;
  let intentionMet = false;
  const intent = opts.intention;
  if (intent) {
    const within = (actual, target) =>
      target == null || Math.abs(actual - target) <= target * 0.20;
    intentionMet = within(distance, intent.dist)
      && within(gain, intent.gain)
      && within(maxElev, intent.peak);
    if (intentionMet) intentionBonus = Math.round((encounterXp + terrainXp + summitXp) * 0.25);
  }

  const totalXp = encounterXp + terrainXp + summitXp + intentionBonus;

  /* ---------- condition cost ---------- */
  const costly = encounters.filter(e => e.outcome === "costly").length;
  const conditionSpent = Math.min(100, Math.round(effort * 3 + costly * 5));

  const beforeLevel = levelFromXp(character.xp || 0).level;
  const afterLevel = levelFromXp((character.xp || 0) + totalXp).level;

  return {
    regionId,
    profile,
    summitIdx,
    effort: +effort.toFixed(1),
    challengeRating: Math.max(1,
      Math.round(effort * 0.55 + lootTier(maxElev) * 1.6)),
    encounters,
    drops,
    nemesisUpdates,
    tally: {
      cleared: encounters.filter(e => e.outcome === "cleared").length,
      costly,
      turnback: encounters.filter(e => e.outcome === "turnback").length,
      named: encounters.filter(e => e.becomesNamed).length,
      settled: encounters.filter(e => e.settles).length,
    },
    xp: { encounterXp, terrainXp, summitXp, intentionBonus, total: totalXp },
    intentionMet,
    conditionSpent,
    levelUp: afterLevel > beforeLevel ? afterLevel : null,
    capacity: capacityOf(character.gear),
  };
}

/* ============================================================
   COMMIT — apply a resolved hike plus the player's haul choice.
   Kept separate from resolveHike so the haul-out screen can sit
   between them, and so a resolve can be discarded harmlessly.
   ============================================================ */
export function commitHike(character, result, summary, hauledIds = []) {
  const gear = { ...(character.gear || {}) };
  const stash = [...(character.stash || [])];

  result.drops
    .filter(d => hauledIds.includes(d.id))
    .forEach(item => {
      const current = gear[item.slot];
      if (!current || item.power > current.power) {
        if (current) stash.push(current);
        gear[item.slot] = item;
      } else {
        stash.push(item);
      }
    });

  const nemeses = { ...(character.nemeses || {}) };
  Object.entries(result.nemesisUpdates).forEach(([k, v]) => { nemeses[k] = v; });

  const trophies = [...(character.trophies || [])];
  result.encounters.filter(e => e.settles).forEach(e => {
    trophies.push({
      key: nemesisKey(e.biomeKey, e.mob),
      name: e.display,
      biome: e.biomeKey,
      turnbacks: e.turnbacks,
      elevation: e.elevation,
      at: Date.now(),
    });
  });

  const next = {
    ...character,
    xp: (character.xp || 0) + result.xp.total,
    hikes: (character.hikes || 0) + 1,
    totalMiles: +(((character.totalMiles || 0) + summary.distance).toFixed(1)),
    totalGain: (character.totalGain || 0) + summary.gain,
    bestGain: Math.max(character.bestGain || 0, summary.gain),
    bestElev: Math.max(character.bestElev || 0, summary.maxElev),
    bestDist: Math.max(character.bestDist || 0, summary.distance),
    bestClass: Math.max(character.bestClass || 0, clampClass(summary.trailClass)),
    condition: Math.max(0, (character.condition ?? 100) - result.conditionSpent),
    gear,
    stash: stash.slice(-60),
    nemeses,
    trophies,
    intention: null,             // consumed either way
    lastHikeAt: Date.now(),
  };

  return next;
}
