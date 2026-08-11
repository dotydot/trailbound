/* ------------------------------------------------------------
   src/game/narrative.js
   Criteria-matched narrative lines. Campaign packs are DATA —
   a new campaign is a JSON file, no engine change, and it can
   ship over the air without an App Store review.

   Selection: gather every line for the moment whose criteria all
   match, keep only the most specific, drop anything used in the
   last few lines, then weighted-random. A no-criteria floor in
   the core pack guarantees there are never holes.
   ------------------------------------------------------------ */

import { mulberry32, hashString } from "./rules";

/* ---------- the core pack: the generic floor ---------- */
export const CORE_PACK = {
  id: "core",
  name: "Core lines",
  lines: [
    /* open */
    { m:"open", when:{}, w:1, t:"You signed in at the trailhead. The register was damp and half the names had run." },
    { m:"open", when:{}, w:1, t:"The lot was empty. You took that as a good sign and started walking." },
    { m:"open", when:{}, w:1, t:"You started up from the road. Cold in the shade, already warm in the sun." },
    { m:"open", when:{ conditionBelow:45 }, w:3, t:"You started up stiff. The legs hadn't come back and you knew it in the first hundred yards." },
    { m:"open", when:{ party:true }, w:2, t:"Two sets of boots on the register line. You started up together." },
    { m:"open", when:{ intentionSet:true }, w:2, t:"You'd said what you meant to walk before you left. Now there was only the walking." },

    /* ambient — biome flavoured */
    { m:"ambient", when:{}, w:1, t:"The trail went quiet in the way that means something noticed you." },
    { m:"ambient", when:{ biome:"marsh" }, w:2, t:"Phragmites over your head, and the path only obvious from inside it." },
    { m:"ambient", when:{ biome:"marsh" }, w:2, t:"The tide had been over the boardwalk and left it slick." },
    { m:"ambient", when:{ biome:"barrens" }, w:2, t:"Sand underfoot for a mile, which is worse than rock and nobody believes you." },
    { m:"ambient", when:{ biome:"barrens" }, w:2, t:"Pitch pine and scrub oak, burned over twice, coming back mean." },
    { m:"ambient", when:{ biome:"moraine" }, w:2, t:"The ridge is a pile a glacier left behind. It still climbs like something." },
    { m:"ambient", when:{ biome:"valley" }, w:2, t:"The brook ran loud enough to cover anything moving alongside it." },
    { m:"ambient", when:{ biome:"woodland" }, w:2, t:"The blazes went thin through the deadfall. You found them again by luck." },
    { m:"ambient", when:{ biome:"woodland" }, w:2, t:"Birch, then spruce, and the light went green and stayed that way." },
    { m:"ambient", when:{ biome:"northern" }, w:2, t:"Birch, then spruce, and the light went green and stayed that way." },
    { m:"ambient", when:{ biome:"hardwood" }, w:2, t:"Stone walls in the middle of the woods, older than the trees." },
    { m:"ambient", when:{ biome:"ledge" }, w:2, t:"Bare rock and blueberry scrub, and the whole valley underneath you." },
    { m:"ambient", when:{ biome:"montane" }, w:2, t:"The switchbacks stacked up and the trees started losing their nerve." },
    { m:"ambient", when:{ biome:"subalpine" }, w:2, t:"Krummholz closed in — knee-high spruce, four hundred years old, mean about it." },
    { m:"ambient", when:{ biome:"alpine" }, w:2, t:"Above the trees the wind stopped pretending to be wind." },
    { m:"ambient", when:{ biome:"alpine" }, w:2, t:"Nothing over you but rock and weather, and the weather was thinking about it." },

    /* encounter — cleared */
    { m:"encounter", when:{ outcome:"cleared" }, w:1, t:"{mob} came at you out of {cover}. Cleared without breaking stride." },
    { m:"encounter", when:{ outcome:"cleared" }, w:1, t:"A {mob} blocked the line. Handled, and you kept moving." },
    { m:"encounter", when:{ outcome:"cleared", insightAtLeast:2 }, w:3, t:"{mob} again — you knew the opening this time. It didn't last." },
    { m:"encounter", when:{ outcome:"cleared", elite:true }, w:3, t:"{mob} held the high ground and you took it off them. Clean." },

    /* encounter — costly */
    { m:"encounter", when:{ outcome:"costly" }, w:1, t:"{mob} caught you in the open. You took it, but it cost you." },
    { m:"encounter", when:{ outcome:"costly" }, w:1, t:"{mob} out of {cover} — closer than you'd like. You won ugly." },
    { m:"encounter", when:{ outcome:"costly", conditionBelow:40 }, w:3, t:"{mob} found you already spent. You got through on nothing but stubbornness." },

    /* encounter — turnback: where the menace lives */
    { m:"encounter", when:{ outcome:"turnback" }, w:1, t:"{mob} held the line and you did not. You went around and left it standing." },
    { m:"encounter", when:{ outcome:"turnback" }, w:1, t:"{mob} was more than you were carrying. You backed off. It watched you go." },
    { m:"encounter", when:{ outcome:"turnback", turnbacksAtLeast:1 }, w:4, t:"{mob} again. It remembered. This time it was ready and you weren't." },
    { m:"encounter", when:{ outcome:"turnback", elite:true }, w:3, t:"You got within sight of the top and {mob} turned you around. The summit stayed unsigned." },

    /* naming and settling — the nemesis beats */
    { m:"named", when:{}, w:1, t:"It let you go a second time, and on the walk out you gave it a name. {name}." },
    { m:"named", when:{}, w:1, t:"Twice now. You stopped calling it a {mob} on the way down. {name}, then." },
    { m:"settled", when:{}, w:1, t:"{name} did not move, and this time neither did you. It's finished." },
    { m:"settled", when:{}, w:1, t:"You came back for {name} and you took the ground. {turnbacks} times it turned you around. Not today." },

    /* drop */
    { m:"drop", when:{}, w:1, t:"It left {item} behind." },
    { m:"drop", when:{ rarity:"Rare" }, w:3, t:"{item} — worth the walk on its own." },
    { m:"drop", when:{ rarity:"Epic" }, w:4, t:"{item}. You stood there a moment holding it." },
    { m:"drop", when:{ rarity:"Legendary" }, w:5, t:"{item}. You will be telling people about this one." },

    /* close */
    { m:"close", when:{}, w:1, t:"Back at the car. {stats}." },
    { m:"close", when:{}, w:1, t:"You signed out and drove home stiff. {stats}." },
    { m:"close", when:{ turnbacksThisHike:1 }, w:3, t:"You came down with something unfinished behind you. {stats}." },
    { m:"close", when:{ conditionBelow:25 }, w:3, t:"You made the car on fumes. {stats}. Take a couple of days." },
    { m:"close", when:{ intentionMet:true }, w:3, t:"It went the way you said it would, which almost never happens. {stats}." },
  ],
};

/* ---------- criteria matching ---------- */
const NUMERIC = {
  conditionBelow:      (v, ctx) => ctx.condition < v,
  minElev:             (v, ctx) => ctx.elevation >= v,
  insightAtLeast:      (v, ctx) => (ctx.insight || 0) >= v,
  turnbacksAtLeast:    (v, ctx) => (ctx.turnbacks || 0) >= v,
  turnbacksThisHike:   (v, ctx) => (ctx.turnbacksThisHike || 0) >= v,
};

export function matches(when, ctx) {
  for (const [k, v] of Object.entries(when)) {
    const num = NUMERIC[k];
    if (num) { if (!num(v, ctx)) return false; continue; }
    if (ctx[k] !== v) return false;
  }
  return true;
}
export const specificity = when => Object.keys(when).length;

/**
 * Pick the best line for a moment.
 * @param recent array of recently used line ids (mutated by caller)
 */
export function selectLine(moment, ctx, packs, recent, rng) {
  const pool = [];
  packs.forEach(pack => {
    pack.lines.forEach((line, i) => {
      if (line.m !== moment) return;
      if (!matches(line.when, ctx)) return;
      pool.push({ ...line, id: `${pack.id}:${moment}:${i}`, spec: specificity(line.when) });
    });
  });
  if (!pool.length) return null;

  const top = Math.max(...pool.map(l => l.spec));
  const tier = pool.filter(l => l.spec === top);
  const fresh = tier.filter(l => !recent.includes(l.id));
  const usable = fresh.length ? fresh : tier;

  const total = usable.reduce((s, l) => s + (l.w || 1), 0);
  let roll = rng() * total;
  let chosen = usable[0];
  for (const l of usable) { roll -= (l.w || 1); if (roll <= 0) { chosen = l; break; } }
  return { ...chosen, candidates: pool.length, tier: top };
}

function fill(text, ctx) {
  return text
    .replace(/\{mob\}/g, ctx.mob || "something")
    .replace(/\{cover\}/g, ctx.cover || "the trees")
    .replace(/\{name\}/g, ctx.name || ctx.mob || "it")
    .replace(/\{item\}/g, ctx.item || "nothing worth carrying")
    .replace(/\{stats\}/g, ctx.stats || "")
    .replace(/\{turnbacks\}/g, String(ctx.turnbacks ?? 0));
}

/* ============================================================
   BUILD THE LOG from a resolved hike.

   @param result   output of resolveHike()
   @param summary  output of summarizeTrack()
   @param character
   @param packs    [CORE_PACK, ...campaignPacks]
   ============================================================ */
export function buildLog(result, summary, character, packs = [CORE_PACK], opts = {}) {
  const rng = mulberry32(hashString(String(opts.seed ?? result.encounters.length + summary.distance)));
  const recent = [];
  const entries = [];

  const base = {
    region: result.regionId,
    campaign: character.activeCampaign || undefined,
    chapter: character.activeChapter || undefined,
    condition: character.condition ?? 100,
    party: (character.party?.some(p => p.active)) || undefined,
    intentionSet: !!character.intention || undefined,
    intentionMet: result.intentionMet || undefined,
    turnbacksThisHike: 0,
  };

  const push = (moment, ctx, meta = {}) => {
    const sel = selectLine(moment, ctx, packs, recent, rng);
    if (sel) {
      recent.push(sel.id);
      if (recent.length > 8) recent.shift();
    }
    entries.push({
      moment,
      text: sel ? fill(sel.t, ctx) : null,
      lineId: sel?.id ?? null,
      ...meta,
    });
  };

  const first = result.profile[0];
  push("open", { ...base, elevation: first.ft }, { mile: 0, elevation: first.ft });

  let turnbacksThisHike = 0;

  result.encounters.forEach((e, i) => {
    const ctx = {
      ...base,
      biome: e.biomeKey,
      elevation: e.elevation,
      mob: e.display,
      cover: e.cover,
      outcome: e.outcome,
      elite: e.elite || undefined,
      apex: e.atApex || undefined,
      insight: e.insight,
      turnbacks: e.turnbacks,
      turnbacksThisHike,
      name: e.nemesisName || e.display,
    };

    /* an ambient beat roughly every other encounter */
    if (i % 2 === 0) {
      push("ambient", ctx, {
        mile: e.mile, elevation: e.elevation, biomeKey: e.biomeKey, tint: e.tint,
      });
    }

    push("encounter", ctx, {
      mile: e.mile, elevation: e.elevation, biomeKey: e.biomeKey, tint: e.tint,
      outcome: e.outcome, elite: e.elite, apex: e.atApex,
      encounterIndex: e.index, xp: e.xp,
    });

    if (e.becomesNamed) {
      push("named", { ...ctx, name: e.assignedName || e.nemesisName || e.mob }, {
        mile: e.mile, elevation: e.elevation, tint: e.tint, kind: "named",
      });
    }
    if (e.settles) {
      push("settled", { ...ctx, name: e.nemesisName || e.mob }, {
        mile: e.mile, elevation: e.elevation, tint: e.tint, kind: "settled",
      });
    }
    if (e.outcome === "turnback") turnbacksThisHike++;

    if (e.drop) {
      push("drop", { ...ctx, rarity: e.drop.rarity, item: e.drop.name }, {
        mile: e.mile, elevation: e.elevation, tint: e.tint,
        sub: true, drop: e.drop,
      });
    }
  });

  const hours = summary.durationHr || 0;
  const stats = `${summary.distance} miles, ${summary.gain.toLocaleString()} feet`
    + (hours ? `, ${hours < 1 ? `${Math.round(hours*60)} minutes` : `${hours.toFixed(1)} hours`}` : "");

  push("close", { ...base, elevation: first.ft, turnbacksThisHike, stats },
    { mile: summary.distance, elevation: first.ft });

  return entries;
}

/* ---------- coverage, for the authoring tool ---------- */
export function coverage(packs, biomeKeys) {
  return biomeKeys.map(biome => {
    const row = { biome, cells: {} };
    ["cleared", "costly", "turnback"].forEach(outcome => {
      const ctx = { biome, outcome, condition: 70, elevation: 2000, insight: 0, turnbacks: 0 };
      row.cells[outcome] = packs.reduce((s, p) =>
        s + p.lines.filter(l => l.m === "encounter" && matches(l.when, ctx)).length, 0);
    });
    const actx = { biome, condition: 70, elevation: 2000, insight: 0, turnbacks: 0 };
    row.cells.ambient = packs.reduce((s, p) =>
      s + p.lines.filter(l => l.m === "ambient" && matches(l.when, actx)).length, 0);
    return row;
  });
}
