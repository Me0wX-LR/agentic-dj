import { MOODS } from "../constants.js";

const MOOD_SET = new Set(MOODS);

/**
 * Filename-first mood. Game OST RMS from Web Audio is often 0.03–0.18, so
 * "quiet and dark" is not a reliable horror signal — titles are.
 */
const RULES = [
  { re: /\b(combat|battle|boss|fight|war|schranz|shot|crawler|distorted|repulsion)\b/i, mood: "combat", tags: ["battle", "aggressive"], intensity: 5, useWhen: "Fights, chases, sudden violence", avoidWhen: "Quiet social scenes" },
  { re: /\b(blood|stain|horror|abyss|abgrund|undead|ghost|dread)\b/i, mood: "horror", tags: ["dark", "dread"], intensity: 3, useWhen: "Wrongness, undead, the city rotting", avoidWhen: "Bright tavern banter" },
  { re: /\b(tears|lament|farewell|grief|sorrow|rain|cry|lonely)\b/i, mood: "sad", tags: ["sad", "melancholy"], intensity: 3, useWhen: "Grief, rain, funerals, quiet after blood", avoidWhen: "Peak combat" },
  { re: /\b(peace|dove|lullaby|aftercare)\b/i, mood: "ambient", tags: ["calm", "peace"], intensity: 2, useWhen: "Camps, underscoring, waiting", avoidWhen: "Peak combat" },
  { re: /\b(tavern|inn|alehouse|folk)\b/i, mood: "tavern", tags: ["folk", "social"], intensity: 2, useWhen: "Inns, drinking, friendly hubs", avoidWhen: "Peak combat" },
  { re: /\b(flower|garden|heart|pure|rosa|luna|episode|emerald|love)\b/i, mood: "social", tags: ["social", "character"], intensity: 2, useWhen: "Talks, character scenes, indoor hubs", avoidWhen: "Peak combat" },
  { re: /\b(prison|alley|stairs|spiral|tension|uneasy)\b/i, mood: "tension", tags: ["tension", "watchful"], intensity: 3, useWhen: "Stealth, countdown, walking into a trap", avoidWhen: "Peak combat" },
  { re: /\b(ascension|epic|heroic|concerto|climax|victory|triumph)\b/i, mood: "epic", tags: ["heroic", "climax"], intensity: 4, useWhen: "Climaxes, revelations, set-piece stands", avoidWhen: "Quiet social scenes" },
  { re: /\b(mystery|secret|shadow|noir|night)\b/i, mood: "mystery", tags: ["mystery", "night"], intensity: 2, useWhen: "Investigation, streets after dark", avoidWhen: "Peak combat" },
  { re: /\b(theme|piano|ambient|drone|city|roots)\b/i, mood: "ambient", tags: ["drone", "calm"], intensity: 1, useWhen: "Safe camps and quiet underscoring", avoidWhen: "Peak combat" },
  { re: /\b(travel|journey|road|wander|world)\b/i, mood: "travel", tags: ["travel", "underscore"], intensity: 3, useWhen: "Roads, journeys, wilderness", avoidWhen: "Peak combat" }
];

export function stripTrackIndex(name = "") {
  return String(name)
    .replace(/^\s*\d+\s*[-_.]?\s*\d+\s*[-_.]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTitle(name = "", path = "") {
  const file = String(path || "").replace(/\\/g, "/").split("/").pop() || "";
  const stem = file.replace(/\.[^.]+$/, "");
  const blob = `${stripTrackIndex(name)} ${stripTrackIndex(stem)}`
    .toLowerCase()
    .replace(/[_./\\]+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return blob;
}

export function moodFromTitle(name = "", path = "") {
  const title = normalizeTitle(name, path);
  if (!title) return null;
  for (const rule of RULES) {
    if (!rule.re.test(title)) continue;
    return {
      mood: MOOD_SET.has(rule.mood) ? rule.mood : "exploration",
      tags: [...rule.tags],
      intensity: rule.intensity,
      useWhen: rule.useWhen,
      avoidWhen: rule.avoidWhen,
      source: "title",
      title
    };
  }
  return null;
}

export function intensityFromEnergy(energy) {
  const value = Number(energy);
  if (!Number.isFinite(value)) return 3;
  if (value >= 0.16) return 5;
  if (value >= 0.12) return 4;
  if (value >= 0.08) return 3;
  if (value >= 0.04) return 2;
  return 1;
}
