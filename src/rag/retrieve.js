import { expandQuery, tokenizeSearch } from "./synonyms.js";
import { bm25Retrieve, rerankHits } from "./rerank.js";

const COMBAT_MOODS = new Set(["combat", "epic", "tension"]);
const CALM_MOODS = new Set(["ambient", "exploration", "social", "tavern", "travel", "sad"]);

const MOOD_RULES = [
  { mood: "combat", re: /combat|fight|initiative|attack|battle|ambush|\bkill(?:ed)?\b|\bdy(?:ing|ed)\b|\bdeath\b|slaughter|戰鬥|打仗|開戰|攻擊|攻撃|戦い|戦闘|先攻|死咗|死了|死人|死曬|殺死|擊殺|敵人|打交|打緊交|流血|流曬血/i },
  { mood: "tavern", re: /tavern|\binn\b|\bale\b|\bbar\b|酒館|酒吧|旅館|旅馆|居酒屋/i },
  { mood: "horror", re: /horror|undead|haunt|fear|dread|恐怖|鬼|亡靈|haunt/i },
  { mood: "sad", re: /sad|funeral|grief|loss|悲傷|葬禮|哭喪|哀悼/i },
  { mood: "mystery", re: /mystery|clue|secret|whisper|謎|秘密|線索/i },
  { mood: "tension", re: /tense|tension|stealth|sneak|潛行|偷偷|緊張/i },
  { mood: "travel", re: /travel|road|journey|horse|旅行|旅途|道路/i },
  { mood: "social", re: /social|court|nobl|ball|社交|宮廷|宴会/i }
];

export function tokenize(text = "") {
  return tokenizeSearch(text);
}

export function situationTags(situation = {}) {
  const parts = [
    situation.sceneName,
    situation.transcript,
    situation.recentChat,
    situation.inCombat ? "combat battle fight initiative" : ""
  ];
  const mood = situation.wantedMood || situation.mood;
  if (mood) parts.push(mood);
  return new Set(expandQuery(parts.filter(Boolean).join(" "), mood));
}

export function inferWantedMood(situation = {}) {
  if (situation.inCombat) return "combat";
  const spoken = `${situation.transcript ?? ""} ${situation.recentChat ?? ""}`;
  const fromSpeech = matchMood(spoken);
  if (fromSpeech) return fromSpeech;
  const fromScene = matchMood(situation.sceneName ?? "");
  if (fromScene) return fromScene;
  return "exploration";
}

export function inferWantedIntensity(situation = {}) {
  if (situation.inCombat) return 5;
  const mood = inferWantedMood(situation);
  if (mood === "combat" || mood === "epic") return 5;
  if (mood === "tension" || mood === "horror") return 4;
  if (mood === "ambient" || mood === "sad") return 2;
  return Number(situation.intensity ?? 3) || 3;
}

function matchMood(text) {
  const blob = String(text || "");
  if (!blob.trim()) return "";
  for (const rule of MOOD_RULES) {
    if (rule.re.test(blob)) return rule.mood;
  }
  return "";
}

export function resolveSearchMood(requested, inferred) {
  if (!requested) return inferred;
  if (requested === "exploration" && inferred && inferred !== "exploration") return inferred;
  return requested;
}

/** LLM propose_cues often returns track names instead of Foundry soundIds. */
export function resolveCatalogId(catalog = [], id = "") {
  const raw = String(id || "").trim();
  if (!raw) return "";
  const byId = catalog.find(track => track.soundId === raw);
  if (byId) return byId.soundId;
  const loose = raw.toLowerCase().replace(/[_./\\]+/g, " ").replace(/\s+/g, " ").trim();
  const hit = catalog.find(track => String(track.name || "").toLowerCase().replace(/\s+/g, " ").trim() === loose);
  return hit?.soundId || "";
}

export function scoreTrack(track, situation, memory = {}) {
  const banned = new Set(memory.bannedIds ?? []);
  const skipped = new Set(memory.skippedIds ?? []);
  const recent = memory.recentIds ?? [];
  const proposed = memory.lastProposedIds ?? [];
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

  const wantedMood = situation.wantedMood || inferWantedMood(situation);
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
  const wantedIntensity = situation.inCombat
    ? 5
    : Number(situation.intensity ?? inferWantedIntensity(situation));
  const intensityDelta = Math.abs(intensity - wantedIntensity);
  score += 3 - intensityDelta;

  const energy = Number(track.features?.energy ?? 0.4);
  const tempo = Number(track.features?.tempo ?? 0);
  if (wantedMood === "combat" || wantedMood === "epic") {
    if (energy > 0.45) {
      score += 3;
      reasons.push("high energy");
    } else if (energy < 0.25) {
      score -= 2;
      reasons.push("too calm for combat");
    }
    if (tempo >= 130) score += 1;
  } else if (CALM_MOODS.has(wantedMood)) {
    if (energy < 0.4) {
      score += 1;
      reasons.push("calm energy");
    }
    if (energy > 0.55) {
      score -= 2;
      reasons.push("too hot for calm scene");
    }
  }

  const recentIndex = recent.indexOf(track.soundId);
  if (recentIndex >= 0) {
    score -= (recent.length - recentIndex) * 2;
    reasons.push("recently played");
  }

  if (proposed.includes(track.soundId)) {
    score -= 5;
    reasons.push("on the last suggestion card");
  }

  const likeCount = memory.likes?.[wantedMood]?.[track.soundId]?.count
    ?? memory.likes?.general?.[track.soundId]?.count
    ?? 0;
  const dislikeCount = memory.dislikes?.[wantedMood]?.[track.soundId]?.count
    ?? memory.dislikes?.general?.[track.soundId]?.count
    ?? 0;
  if (likeCount) {
    score += likeCount * 2;
    reasons.push(`learned like ×${likeCount}`);
  }
  if (dislikeCount) {
    score -= dislikeCount * 2;
    reasons.push(`learned avoid ×${dislikeCount}`);
  }

  return { score, reasons };
}

export function retrieveTracks(catalog, situation, memory, { limit = 8, mood, tags, query, intensity } = {}) {
  const inferred = inferWantedMood(situation);
  const wantedMood = resolveSearchMood(mood, inferred);
  const wantedIntensity = intensity ?? inferWantedIntensity({ ...situation, mood: wantedMood, wantedMood });
  const extra = {
    ...situation,
    mood: wantedMood,
    wantedMood,
    intensity: wantedIntensity,
    recentChat: [situation.recentChat, query, ...(tags ?? [])].filter(Boolean).join(" ")
  };
  const queryTokens = expandQuery(
    [query, extra.transcript, extra.recentChat, extra.sceneName, wantedMood].filter(Boolean).join(" "),
    wantedMood
  );
  const pool = [];
  for (const track of catalog) {
    const features = scoreTrack(track, extra, memory);
    if (!Number.isFinite(features.score)) continue;
    pool.push(track);
  }
  const hits = bm25Retrieve(pool, queryTokens, Math.max(32, Number(limit) * 4));
  const usable = hits.some(row => row.bm25 > 0) ? hits : pool.map(track => ({ track, bm25: 0 }));
  return rerankHits(usable, {
    wantedMood,
    intensity: wantedIntensity,
    inCombat: situation.inCombat,
    memory,
    limit,
    queryTokens,
    featureScore: track => scoreTrack(track, extra, memory)
  });
}

export function verifyCandidates(catalog, soundIds, situation, memory, intendedMood, intendedIntensity) {
  const byId = new Map(catalog.map(track => [track.soundId, track]));
  const dropped = [];
  const kept = [];
  const inferred = inferWantedMood(situation);
  const wantedMood = resolveSearchMood(intendedMood, inferred);
  const extra = {
    ...situation,
    mood: wantedMood,
    wantedMood,
    intensity: intendedIntensity || inferWantedIntensity({ ...situation, wantedMood })
  };
  for (const id of soundIds) {
    const resolved = resolveCatalogId(catalog, id) || id;
    const track = byId.get(resolved);
    if (!track) {
      dropped.push({ soundId: id, reason: "not in catalog" });
      continue;
    }
    const ranked = scoreTrack(track, extra, memory);
    if (!Number.isFinite(ranked.score) || ranked.score < 0) {
      dropped.push({ soundId: id, reason: ranked.reasons.join(", ") || "failed verification" });
      continue;
    }
    kept.push({ track, ...ranked });
  }
  return { kept, dropped };
}

export function catalogMoodCounts(catalog = []) {
  const moods = {};
  for (const track of catalog) {
    if (!(track.features || track.mood)) continue;
    const mood = track.mood || "untagged";
    moods[mood] = (moods[mood] || 0) + 1;
  }
  const entries = Object.entries(moods).sort((a, b) => b[1] - a[1]);
  const analyzed = entries.reduce((sum, [, count]) => sum + count, 0);
  const [dominantMood, dominantCount] = entries[0] || ["", 0];
  return {
    moods,
    analyzed,
    dominantMood,
    dominantCount,
    homogeneous: analyzed >= 4 && dominantCount / analyzed >= 0.8
  };
}
