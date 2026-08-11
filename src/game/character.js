/* ------------------------------------------------------------
   src/game/character.js
   Character state, persisted in SQLite alongside the tracks.

   Single row, JSON blob. Not elegant, but the shape of character
   state is still moving and migrating a JSON column is free.
   Split it into real columns once it stops changing.
   ------------------------------------------------------------ */

import * as SQLite from "expo-sqlite";
import { levelFromXp, BADGES, DEFAULT_REGION } from "./world";

let dbPromise = null;
const db = () => (dbPromise ??= SQLite.openDatabaseAsync("trailbound.db"));

export const BLANK_CHARACTER = {
  regionId: DEFAULT_REGION,
  xp: 0,
  hikes: 0,
  guidedHikes: 0,
  totalMiles: 0,
  totalGain: 0,
  bestGain: 0,
  bestElev: 0,
  bestDist: 0,
  bestClass: 0,
  condition: 100,
  conditionUpdatedAt: null,
  gear: {},
  stash: [],
  nemeses: {},
  trophies: [],
  badges: [],
  salvage: 0,
  studyCharges: 0,
  intention: null,
  activeCampaign: null,
  activeChapter: null,
  dailyXp: 0,
  dailyXpDate: null,
  lastHikeAt: null,
};

export async function initCharacterTable() {
  const d = await db();
  await d.execAsync(`
    CREATE TABLE IF NOT EXISTS character (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export async function loadCharacter() {
  const d = await db();
  const row = await d.getFirstAsync(`SELECT data FROM character WHERE id = 1`);
  if (!row?.data) return { ...BLANK_CHARACTER };
  try {
    return { ...BLANK_CHARACTER, ...JSON.parse(row.data) };
  } catch (e) {
    console.warn("[trailbound] character row corrupt, starting fresh:", e.message);
    return { ...BLANK_CHARACTER };
  }
}

export async function saveCharacter(character) {
  const d = await db();
  await d.runAsync(
    `INSERT INTO character (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [JSON.stringify(character), Date.now()]
  );
  return character;
}

export async function resetCharacter() {
  const d = await db();
  await d.runAsync(`DELETE FROM character WHERE id = 1`);
  return { ...BLANK_CHARACTER };
}

/* ---------- passive recovery ----------
   Condition and study charges accrue with real elapsed days whether
   or not the app was opened. Called on load, never on a timer.
   No streaks, no penalty for being away. */
const CONDITION_PER_DAY = 20;
const STUDY_PER_DAY = 1;
const STUDY_CAP = 3;
const INTENTION_EXPIRY_DAYS = 10;

export function applyElapsed(character, now = Date.now()) {
  const last = character.conditionUpdatedAt ?? character.lastHikeAt ?? now;
  const days = Math.floor((now - last) / 86400000);
  if (days <= 0) return character;

  const next = {
    ...character,
    condition: Math.min(100, (character.condition ?? 100) + days * CONDITION_PER_DAY),
    studyCharges: Math.min(STUDY_CAP, (character.studyCharges ?? 0) + days * STUDY_PER_DAY),
    conditionUpdatedAt: now,
  };

  if (next.intention?.setAt &&
      now - next.intention.setAt > INTENTION_EXPIRY_DAYS * 86400000) {
    next.intention = null;
  }
  return next;
}

/* ---------- daily cap ---------- */
export function dailyRoom(character, cap = 6000, now = Date.now()) {
  const today = new Date(now).toDateString();
  const used = character.dailyXpDate === today ? (character.dailyXp || 0) : 0;
  return { used, room: Math.max(0, cap - used), today };
}

export function applyDailyCap(character, awarded, cap = 6000, now = Date.now()) {
  const { used, room, today } = dailyRoom(character, cap, now);
  const granted = Math.min(awarded, room);
  return {
    granted,
    capped: granted < awarded,
    character: { ...character, dailyXp: used + granted, dailyXpDate: today },
  };
}

/* ---------- badges ---------- */
export function newBadges(character) {
  return BADGES.filter(b => !(character.badges || []).includes(b.id) && b.test(character));
}

export function awardBadges(character) {
  const earned = newBadges(character);
  if (!earned.length) return { character, earned };
  return {
    character: { ...character, badges: [...(character.badges || []), ...earned.map(b => b.id)] },
    earned,
  };
}

/* ---------- convenience ---------- */
export const progressOf = character => levelFromXp(character.xp || 0);
