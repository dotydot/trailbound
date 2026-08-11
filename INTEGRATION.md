# Trailbound — Integration Instructions

Everything you need to get the vertical slice running: record a hike, prove the
numbers, resolve it into encounters, tell the story, take the loot.

---

## 1. Final file layout

```
C:\Users\kevin\trailbound\
├── App.js                          ← REPLACE
├── app.json                        ← already fixed (permissions merged)
├── package.json                    ← no change
└── src\
    ├── game\                       ← NEW FOLDER
    │   ├── world.js                ← NEW
    │   ├── engine.js               ← NEW
    │   ├── narrative.js            ← NEW
    │   └── character.js            ← NEW
    ├── screens\                    ← NEW FOLDER
    │   └── AfterAction.js          ← NEW
    └── tracking\
        ├── locationTask.js         ← REPLACE
        └── trackMath.js            ← REPLACE
```

## 2. Download and rename

The files download with prefixes so they don't collide. Rename as you place them:

| Downloaded file | Rename to | Put it in |
|---|---|---|
| `App.js` | `App.js` | project root |
| `game-world.js` | `world.js` | `src\game\` |
| `game-engine.js` | `engine.js` | `src\game\` |
| `game-narrative.js` | `narrative.js` | `src\game\` |
| `game-character.js` | `character.js` | `src\game\` |
| `AfterAction.js` | `AfterAction.js` | `src\screens\` |
| `trackMath.js` | `trackMath.js` | `src\tracking\` |
| `locationTask.js` | `locationTask.js` | `src\tracking\` |

Create the two new folders first. Check Windows hasn't appended `.txt` to
anything — View → Show → File name extensions.

## 3. No new packages needed

Everything imported is already installed: `expo-sqlite`, `expo-sensors`,
`expo-location`, `expo-task-manager`, `expo-keep-awake`,
`react-native-safe-area-context`, `react-native-svg`.

## 4. Run it

```powershell
cd C:\Users\kevin\trailbound
npx expo start --clear
```

`--clear` matters — the new module paths need a fresh Metro cache.

## 5. What changed and why

**`trackMath.js`** — two fixes found by testing your real Maine track:

- Rejects points timestamped before `started_at`. Yours had two cached iOS
  fixes from 18s and 10s before recording began. Harmless standing still; on a
  real hike a cached fix from your driveway gets stitched onto the front of the
  route.
- Calibrates the barometer against median GPS altitude over the first 60
  seconds. Your peak read 281 ft against GPS's 237 — a +44 ft error because the
  code assumed standard sea-level pressure and the day was 1011.5 hPa. After
  calibration it reads 235 ft. On a stormy day the uncalibrated error would be
  several hundred feet, which would put you in the wrong biome.
- Interface change: `summarizeTrack(points, { startedAt, baroSamples, stepCount })`
  now wants raw `{ t, hPa }` pressure samples rather than pre-converted feet,
  because calibration needs the pressure values.
- Also exports `downsample()`. iOS ignores `setUpdateInterval` and delivers
  ~1 sample/sec, so a three-hour hike banks ~10,000 readings. `App.js` trims to
  one per five seconds before use.

**`locationTask.js`** — unchanged from the version you're running. Three tiers:
background task, foreground watch fallback, and a guarded `expo-task-manager`
import so it loads in Expo Go.

**`src/game/*`** — the prototype logic, ported. Pure JavaScript, no platform
APIs, so it behaves identically in the app and in a test script.

**`character.js`** — SQLite persistence. Single row, JSON blob, because the
shape of character state is still moving. `applyElapsed()` runs on load and
grants condition and study charges for real days passed, whether or not the app
was opened.

## 6. Two bugs testing caught, now fixed

Worth knowing about, because they'd have been miserable to debug on a mountain.

**A nemesis could appear five times in one hike.** Escalation compounded within
a single afternoon — one creature reached 5 turnbacks and +60% rating on a
single walk. Now a given nemesis appears at most once per hike, and a fresh
creature of a species already met gets its own identity so state doesn't
collide.

**Every encounter was a turnback for a new character.** A level-1 hiker on an
8-mile, 3,100 ft, Class 3 route lost 12 out of 12 fights and collected a dozen
grudges at once. There's now a cap: at most 40% of a hike's encounters can be
turnbacks, and the easiest of the excess become costly wins instead. This is
both a fix and a design truth — you cannot be turned back nine times in one
day, you'd have gone home.

Also fixed: the `{name}` token resolved to the mob name on the naming beat, so
you got "You stopped calling it a Switchback Wyrm. Switchback Wyrm, then."

## 7. Known balance problems — for the harness, not bugs

Verified against a simulated Whites hike (8.4 mi, 3,100 ft, Class 3):

| Observation | Numbers | Likely fix |
|---|---|---|
| Levelling far too fast | level 4 after ONE hike | drop `xpPerEnergyMile` from 70, steepen `xpForLevel` |
| Condition drains too hard | −94 of 100 in one hike | lower `conditionPerEnergyMile` from 3, or raise recovery |
| Repeated species names | "Talus Golem" four times in one log | larger `mobs` arrays per biome, or individual epithets |

Tune these in the balance harness before writing more content. Every number
lives in `world.js` and `engine.js` as a named constant.

## 8. What to test on device

1. **Short walk.** Start, walk two minutes, finish. You should get a log, a
   profile with pins, a haul-out, and rewards.
2. **Check the calibration flag.** In the validation strip, look for "Barometer
   calibrated" with an implied sea-level pressure. Compare it to your local
   forecast — should be within a few hPa.
3. **Stale-fix rejection.** The validation strip should mention dropped cached
   locations on most starts.
4. **Reject path.** Start and immediately finish. Under 0.2 mi should reject
   cleanly and record nothing against your character.
5. **Persistence.** Commit a hike, force-close the app, reopen. Level, gear and
   condition should survive.

## 9. Order of work after this

1. Tune the three balance problems above in the harness
2. Region picker on first launch (currently hardcoded to `greens`)
3. Campaign chapters and the requirement resolver
4. Open accounts screen (nemesis data is already being collected)
5. Planning table (intention already read by the engine, just not settable)
6. Leaderboard and sync

Note that the engine already accepts `opts.intention` and awards the declared-route
bonus — the planning table just needs a screen to set it.
