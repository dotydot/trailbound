# Trailbound — System Status Audit

Every system we designed, where it currently lives, and whether the app has it.

---

## Legend
- **LIVE** — in the app, running
- **PROTO** — works in a web prototype only, not ported
- **DRIFT** — exists in both, with different numbers
- **GONE** — decided but never built anywhere

---

## Core pipeline

| System | Status | Notes |
|---|---|---|
| GPS recording, background + foreground fallback | LIVE | `locationTask.js` |
| Stale pre-start point rejection | LIVE | Fixed from your Maine track |
| Barometric calibration against GPS | LIVE | +44 ft error → 2 ft |
| Hysteresis elevation filter | LIVE | Verified: 0 ft on a flat walk |
| Validation gates (pace, steps, mock, distance) | LIVE | |
| Baro downsampling | LIVE | `downsample()`, 5s |
| Energy miles, absolute rating, loot tier | LIVE | `world.js` |
| Encounter resolution | LIVE | `engine.js` |
| Nemesis dedup + 40% turnback cap | LIVE | Found by testing |
| Loot, haul-out, capacity | LIVE | |
| Narrative log, criteria-matched | LIVE | Core pack only |
| Character persistence, SQLite | LIVE | `character.js` |
| Passive condition + study accrual | LIVE | `applyElapsed()` |
| Daily XP cap | LIVE | |
| Badges | LIVE | |

## Designed, not in the app

| System | Status | Where it lives | What's missing |
|---|---|---|---|
| Regions + biomes | LIVE (data) | `world.js` | No region picker — hardcoded to `greens` |
| Campaign chapters + branches | PROTO | chapter-engine | Chapter tree, branch choice, objective tracking |
| Three-ladder requirements | PROTO | requirement-resolver | Region / personal / cumulative / alternative / season |
| Nemesis escalation | DRIFT | nemesis-system vs `engine.js` | Prototype has bestiary tiers, prepared plans, trophies UI |
| Planning table | PROTO | planning-table | Intention setting, salvage, reforge, study charges |
| Declared route bonus | HALF | `engine.js` reads it | Nothing sets `character.intention` |
| Party + guide bonus | GONE | engine v2 only | Dropped during the port |
| Leaderboard / register | PROTO | summit-register | No sync, no backend |
| Balance mitigations | PROTO | harness v2 | Diminishing gear, campaign tiers, level term |
| Trail companion / narration | PROTO | trail-companion | Needs incremental resolution during the hike |
| Content authoring | PROTO | workbench | Exports JSON the app can't yet load |
| Campaign 1 script | WRITTEN | markdown | ~83 lines, not entered anywhere |

## Known drift

These have different values in different places right now:

| Constant | App engine | Prototype | Decision |
|---|---|---|---|
| Nemesis escalation | 0.12 | 0.12 | agreed |
| Insight gain | 0.20 | 0.20 | agreed |
| Turnback cap | 40% | none | app is right |
| Nemesis per hike | once | unlimited | app is right |
| Gear growth | linear | linear + soft cap option | soft cap not yet chosen |
| Prepared bonus | 0.30, never set | 0.30, settable | planning table missing |

## Balance problems, still open

Verified by simulation, deliberately unfixed pending harness work:

1. **Levelling far too fast** — level 4 after one 8-mile hike
2. **Condition drains too hard** — −94 of 100 in one outing
3. **Repeated species names** — same mob four times in one log
4. **Gear outruns terrain** — predicted around hike 20–40, mitigations undecided

## What consolidation should fix

- One set of constants, imported everywhere, so prototypes can't drift
- Campaign, requirements, planning and party logic promoted from prototype to canonical
- Balance mitigations present but switchable, so the harness tunes the same code the app runs
- Everything pure — no React, no SQLite, no platform APIs — so it runs identically in the app, in a test script, and in a browser harness
