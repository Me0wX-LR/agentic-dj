/**
 * Pure catalog retrieval used by the Director and by Node tests.
 * Foundry is not required.
 */

const COMBAT_MOODS = new Set(["combat", "epic", "tension"]);
const CALM_MOODS = new Set(["ambient", "exploration", "social", "tavern", "travel", "sad"]);

export function tokenize(text = "") {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(token => token.length > 2);
}

export function situationTags(situation = {}) {
  const parts = [
    situation.sceneName,
    situation.mood,
    situation.transcript,
    situation.recentChat,
    situation.inCombat ? "combat battle fight initiative" : "exploration scene"
  ];
  return new Set(tokenize(parts.filter(Boolean).join(" ")));
}

export function scoreTrack(track, situation, memory = {}) {
  const banned = new Set(memory.bannedIds ?? []);
  const skipped = new Set(memory.skippedIds ?? []);
  const recent = memory.recentIds ?? [];
  if (banned.has(track.soundId)) return { score: -Infinity, reasons: ["banned"] };
  if (skipped.has(track.soundId)) return { score: -Infinity, reasons: ["skipped"] };

  const sitTags = situationTags(situation);
  const trackTags = new Set([
    ...(track.tags ?? []).map(t => String(t).toLowerCase()),
    track.mood,
    ...(track.setting ?? []),
    ...tokenize(track.useWhen ?? ""),
    ...tokenize(track.name ?? "")
  ]);

  let score = 0;
  const reasons = [];
  let overlap = 0;
  for (const tag of trackTags) {
    if (sitTags.has(tag)) overlap += 1;
  }
  score += overlap * 3;
  if (overlap) reasons.push(`tag overlap ${overlap}`);

  const wantedMood = inferWantedMood(situation);
  if (track.mood && track.mood === wantedMood) {
    score += 6;
    reasons.push(`mood ${track.mood}`);
  } else if (track.mood && wantedMood === "combat" && COMBAT_MOODS.has(track.mood)) {
    score += 4;
    reasons.push(`combat-adjacent ${track.mood}`);
  } else if (track.mood && wantedMood !== "combat" && COMBAT_MOODS.has(track.mood) && CALM_MOODS.has(wantedMood)) {
    score -= 4;
    reasons.push("too aggressive");
  }

  const intensity = Number(track.intensity ?? 3);
  const wantedIntensity = situation.inCombat ? 5 : Number(situation.intensity ?? 3);
  const intensityDelta = Math.abs(intensity - wantedIntensity);
  score += 3 - intensityDelta;

  const energy = Number(track.features?.energy ?? 0.4);
  if (situation.inCombat && energy > 0.45) {
    score += 2;
    reasons.push("high energy");
  }
  if (!situation.inCombat && energy < 0.4) {
    score += 1;
    reasons.push("calm energy");
  }

  const recentIndex = recent.indexOf(track.soundId);
  if (recentIndex >= 0) {
    score -= (recent.length - recentIndex) * 2;
    reasons.push("recently played");
  }
  if (skipped.has(track.soundId)) {
    score -= 3;
    reasons.push("skipped earlier");
  }

  return { score, reasons };
}

export function inferWantedMood(situation = {}) {
  const blob = `${situation.mood ?? ""} ${situation.transcript ?? ""} ${situation.recentChat ?? ""} ${situation.sceneName ?? ""}`.toLowerCase();
  if (situation.inCombat || /\b(combat|fight|initiative|attack|battle|ambush)\b/.test(blob)) return "combat";
  if (/\b(tavern|inn|ale|bar)\b/.test(blob)) return "tavern";
  if (/\b(horror|undead|haunt|fear|dread)\b/.test(blob)) return "horror";
  if (/\b(sad|funeral|grief|loss)\b/.test(blob)) return "sad";
  if (/\b(mystery|clue|secret|whisper)\b/.test(blob)) return "mystery";
  if (/\b(tense|tension|stealth|sneak)\b/.test(blob)) return "tension";
  if (/\b(travel|road|journey|horse)\b/.test(blob)) return "travel";
  if (/\b(social|court|nobl|ball)\b/.test(blob)) return "social";
  return situation.inCombat ? "combat" : "exploration";
}

export function retrieveTracks(catalog, situation, memory, { limit = 8, mood, tags, query, intensity } = {}) {
  const extra = {
    ...situation,
    mood: mood || situation.mood,
    intensity: intensity ?? situation.intensity,
    recentChat: [situation.recentChat, query, ...(tags ?? [])].filter(Boolean).join(" ")
  };
  return [...catalog]
    .map(track => ({ track, ...scoreTrack(track, extra, memory) }))
    .filter(row => Number.isFinite(row.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function verifyCandidates(catalog, soundIds, situation, memory, intendedMood, intendedIntensity) {
  const byId = new Map(catalog.map(track => [track.soundId, track]));
  const dropped = [];
  const kept = [];
  for (const id of soundIds) {
    const track = byId.get(id);
    if (!track) {
      dropped.push({ soundId: id, reason: "not in catalog" });
      continue;
    }
    const ranked = scoreTrack(track, { ...situation, mood: intendedMood, intensity: intendedIntensity }, memory);
    if (ranked.score < 0) {
      dropped.push({ soundId: id, reason: ranked.reasons.join(", ") || "failed verification" });
      continue;
    }
    kept.push({ track, ...ranked });
  }
  return { kept, dropped };
}
