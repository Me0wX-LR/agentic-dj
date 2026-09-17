import { MOODS } from "../constants.js";

const MOOD_SET = new Set(MOODS);

export function catalogTemplateHeader() {
  return `# Agentic DJ manual catalog
# One track per line. Columns are optional after the name:
# name | mood | intensity | tags | use when
# Moods: ${MOODS.join(", ")}
# Leave mood/tags blank to let the LLM fill them.
# Name must match a Foundry playlist sound (or "Playlist / Name").
# Lines starting with # are ignored.

`;
}

export function buildCatalogTemplate(tracks = []) {
  const lines = tracks.map(track => {
    const filled = track.mood || (track.tags ?? []).length || track.useWhen;
    if (!filled) return track.name;
    const tags = (track.tags ?? []).join(", ");
    return [track.name, track.mood || "", track.intensity || "", tags, track.useWhen || ""]
      .join(" | ")
      .replace(/ \| +$/g, "");
  });
  return `${catalogTemplateHeader()}${lines.join("\n")}\n`;
}

export function tableRowsFromCatalog(tracks = [], { fill = true } = {}) {
  return tracks.map(track => ({
    included: true,
    soundId: track.soundId,
    name: track.name,
    playlistName: track.playlistName || "",
    mood: fill ? (track.mood || "") : "",
    intensity: fill && track.intensity ? Number(track.intensity) : "",
    tags: fill ? (track.tags ?? []).join(", ") : "",
    useWhen: fill ? (track.useWhen || "") : "",
    analyzed: Boolean(track.mood || track.features)
  }));
}

export function parseTableDraft(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return parseManualCatalog(text);
}

export function serializeTableDraft(rows = []) {
  return JSON.stringify(rows);
}

export function parseManualCatalog(text) {
  const rows = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map(part => part.trim());
    const name = parts[0];
    if (!name) continue;
    rows.push({
      name,
      mood: normalizeMood(parts[1]),
      intensity: parseIntensity(parts[2]),
      tags: splitTags(parts[3]),
      useWhen: parts[4] || "",
      avoidWhen: parts[5] || ""
    });
  }
  return rows;
}

export function normalizeManualRow(row = {}) {
  return {
    included: row.included !== false,
    soundId: row.soundId || "",
    name: row.name || "",
    playlistName: row.playlistName || "",
    mood: normalizeMood(row.mood),
    intensity: parseIntensity(row.intensity),
    tags: Array.isArray(row.tags) ? unique(row.tags) : splitTags(row.tags),
    useWhen: row.useWhen || "",
    avoidWhen: row.avoidWhen || ""
  };
}

export function matchRowToTrack(row, catalog = []) {
  if (row?.soundId) {
    const byId = catalog.find(track => track.soundId === row.soundId);
    if (byId) return byId;
  }
  const needle = normalizeName(row?.name);
  if (!needle) return null;
  const exact = catalog.find(track => normalizeName(track.name) === needle);
  if (exact) return exact;
  const withPlaylist = catalog.find(track => normalizeName(`${track.playlistName} / ${track.name}`) === needle);
  if (withPlaylist) return withPlaylist;
  const byPath = catalog.find(track => {
    const path = String(track.path || "").replace(/\\/g, "/");
    const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    return normalizeName(base) === needle;
  });
  return byPath ?? null;
}

export function filenameHints(name, path = "") {
  const blob = `${name} ${path}`.toLowerCase();
  return [
    "combat", "battle", "boss", "tavern", "inn", "forest", "dungeon", "cave", "city",
    "sea", "ocean", "horror", "dark", "ambient", "explore", "travel", "sad", "epic",
    "mystery", "stealth", "village", "temple"
  ].filter(tag => blob.includes(tag));
}

export function heuristicCard(row, track) {
  const tags = unique([...(row.tags ?? []), ...filenameHints(row.name, track?.path)]);
  const mood = row.mood || guessMood(tags);
  const intensity = row.intensity || (mood === "combat" || mood === "epic" ? 5 : mood === "ambient" ? 1 : 3);
  return {
    tags,
    mood,
    intensity,
    setting: tags.filter(tag => ["tavern", "forest", "dungeon", "city", "sea", "cave"].includes(tag)),
    instruments: [],
    useWhen: row.useWhen || defaultUseWhen(mood),
    avoidWhen: row.avoidWhen || (mood === "combat" ? "Quiet social scenes" : "Peak combat"),
    features: {
      backend: "manual",
      duration: 0,
      tempo: mood === "combat" ? 140 : 100,
      energy: mood === "combat" || mood === "epic" ? 0.55 : 0.12,
      mood,
      intensity,
      tags
    },
    heuristic: true
  };
}

export function mergeCard(base, llmCard = {}) {
  return {
    tags: unique([...(llmCard.tags ?? []), ...(base.tags ?? [])]),
    mood: normalizeMood(llmCard.mood) || base.mood,
    intensity: parseIntensity(llmCard.intensity) || base.intensity,
    setting: Array.isArray(llmCard.setting) && llmCard.setting.length ? llmCard.setting : base.setting,
    instruments: Array.isArray(llmCard.instruments) ? llmCard.instruments : base.instruments,
    useWhen: llmCard.useWhen || base.useWhen,
    avoidWhen: llmCard.avoidWhen || base.avoidWhen,
    features: base.features,
    heuristic: !llmCard.mood
  };
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMood(value) {
  const mood = String(value || "").trim().toLowerCase();
  return MOOD_SET.has(mood) ? mood : "";
}

function parseIntensity(value) {
  if (value == null || String(value).trim() === "") return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function splitTags(value) {
  return unique(String(value || "").split(/[,;/]+/));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(value => String(value).trim().toLowerCase()).filter(Boolean))];
}

function guessMood(tags) {
  if (tags.includes("combat") || tags.includes("battle") || tags.includes("boss")) return "combat";
  if (tags.includes("tavern") || tags.includes("inn")) return "tavern";
  if (tags.includes("horror") || tags.includes("dark")) return "horror";
  if (tags.includes("ambient")) return "ambient";
  if (tags.includes("travel")) return "travel";
  if (tags.includes("epic")) return "epic";
  return "exploration";
}

function defaultUseWhen(mood) {
  switch (mood) {
    case "combat": return "Fights, chases, sudden violence";
    case "tavern": return "Inns, drinking, friendly hubs";
    case "horror": return "Dread, undead, wrongness";
    case "ambient": return "Safe camps and quiet underscoring";
    case "travel": return "Roads, journeys, wilderness";
    case "epic": return "Climaxes and set-piece battles";
    default: return "General exploration";
  }
}
