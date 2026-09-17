import { MOODS } from "../constants.js";
import { moodFromTitle } from "./title-mood.js";

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
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return parseCatalogJson(text);
    } catch {
      return [];
    }
  }
  return parseManualCatalog(text);
}

/** Loose name for matching Foundry playlist sounds to import JSON. */
export function normalizeMatchName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_./\\]+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCatalogJson(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  const list = Array.isArray(data)
    ? data
    : data?.tracks ?? data?.rows ?? data?.catalog ?? data?.cards;
  if (!Array.isArray(list)) {
    throw new Error("JSON must be an array of tracks or { tracks: [] }");
  }
  return list.map(normalizeImportTrack).filter(row => row.name || row.file || row.soundId);
}

export function exportCatalogJson(rows = [], extra = {}) {
  return {
    module: "agentic-dj",
    format: 1,
    exportedAt: extra.exportedAt || new Date().toISOString(),
    tracks: rows.map(row => {
      const tags = Array.isArray(row.tags) ? unique(row.tags) : splitTags(row.tags);
      return {
        included: row.included !== false,
        soundId: row.soundId || "",
        name: row.name || row.foundryName || "",
        playlistName: row.playlistName || "",
        file: row.file || row.path || "",
        mood: normalizeMood(row.mood),
        intensity: parseIntensity(row.intensity) || undefined,
        tags,
        useWhen: row.useWhen || "",
        avoidWhen: row.avoidWhen || ""
      };
    })
  };
}

export function applyImportedTracks(catalog = [], importedRaw) {
  const imported = parseCatalogJson(importedRaw);
  const maps = buildMatchMaps(catalog);
  const overlay = new Map();
  const unmatched = [];
  for (const row of imported) {
    const track = matchImportedTrack(row, catalog, maps);
    if (!track) {
      unmatched.push(row.name || row.file || row.soundId);
      continue;
    }
    overlay.set(track.soundId, row);
  }
  const rows = catalog.map(track => {
    const hit = overlay.get(track.soundId);
    if (!hit) return tableRowsFromCatalog([track], { fill: true })[0];
    return {
      included: hit.included !== false,
      soundId: track.soundId,
      name: track.name,
      playlistName: track.playlistName || "",
      mood: hit.mood || "",
      intensity: hit.intensity || "",
      tags: Array.isArray(hit.tags) ? hit.tags.join(", ") : (hit.tags || ""),
      useWhen: hit.useWhen || "",
      avoidWhen: hit.avoidWhen || "",
      analyzed: Boolean(track.mood || track.features)
    };
  });
  return {
    rows,
    matched: overlay.size,
    unmatched,
    scanned: imported.length
  };
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
  return matchImportedTrack(row, catalog, buildMatchMaps(catalog));
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
  const title = moodFromTitle(row.name || track?.name, track?.path);
  const tags = unique([...(row.tags ?? []), ...(title?.tags ?? []), ...filenameHints(row.name, track?.path)]);
  const mood = row.mood || title?.mood || guessMood(tags);
  const intensity = row.intensity || title?.intensity || (mood === "combat" || mood === "epic" ? 5 : mood === "ambient" ? 1 : 3);
  return {
    tags,
    mood,
    intensity,
    setting: tags.filter(tag => ["tavern", "forest", "dungeon", "city", "sea", "cave"].includes(tag)),
    instruments: [],
    useWhen: row.useWhen || title?.useWhen || defaultUseWhen(mood),
    avoidWhen: row.avoidWhen || title?.avoidWhen || (mood === "combat" ? "Quiet social scenes" : "Peak combat"),
    features: {
      backend: "manual",
      duration: 0,
      tempo: mood === "combat" ? 140 : 100,
      energy: mood === "combat" || mood === "epic" ? 0.55 : 0.12,
      mood,
      intensity,
      tags
    },
    heuristic: !row.mood
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
  return normalizeMatchName(value);
}

function normalizeImportTrack(row = {}) {
  const file = row.file || row.path || row.filename || "";
  const name = row.name || row.foundryName || row.title || "";
  const aliases = [
    name,
    row.foundryName,
    file,
    ...(Array.isArray(row.aliases) ? row.aliases : [])
  ].filter(Boolean);
  return {
    included: row.included !== false,
    soundId: row.soundId || "",
    name,
    file,
    playlistName: row.playlistName || row.playlist || "",
    mood: normalizeMood(row.mood),
    intensity: parseIntensity(row.intensity),
    tags: Array.isArray(row.tags) ? unique(row.tags) : splitTags(row.tags),
    useWhen: row.useWhen || "",
    avoidWhen: row.avoidWhen || "",
    aliases
  };
}

function trackKeys(track) {
  const path = String(track.path || track.file || "").replace(/\\/g, "/");
  const stem = path.split("/").pop() || "";
  return [
    track.soundId,
    normalizeMatchName(track.name),
    normalizeMatchName(`${track.playlistName || ""} ${track.name || ""}`),
    normalizeMatchName(stem),
    normalizeMatchName(track.file),
    normalizeMatchName(track.foundryName)
  ].filter(Boolean);
}

function buildMatchMaps(catalog = []) {
  const byId = new Map();
  const byLoose = new Map();
  const bySuffix = new Map();
  for (const track of catalog) {
    if (track.soundId) byId.set(track.soundId, track);
    for (const key of trackKeys(track)) {
      if (key === track.soundId) continue;
      if (byLoose.has(key) && byLoose.get(key) !== track) byLoose.set(key, null);
      else if (!byLoose.has(key)) byLoose.set(key, track);
    }
    const suffix = normalizeMatchName(track.name).replace(/^\d+\s+\d+\s+/, "");
    if (suffix && suffix !== normalizeMatchName(track.name)) {
      if (bySuffix.has(suffix) && bySuffix.get(suffix) !== track) bySuffix.set(suffix, null);
      else if (!bySuffix.has(suffix)) bySuffix.set(suffix, track);
    }
  }
  return { byId, byLoose, bySuffix };
}

function matchImportedTrack(row, catalog = [], maps = buildMatchMaps(catalog)) {
  if (row?.soundId && maps.byId.has(row.soundId)) return maps.byId.get(row.soundId);
  const needles = [
    row?.name,
    row?.foundryName,
    row?.file,
    row?.path,
    ...(row?.aliases ?? [])
  ].filter(Boolean);
  for (const needle of needles) {
    const key = normalizeMatchName(needle);
    if (key && maps.byLoose.get(key)) return maps.byLoose.get(key);
  }
  for (const needle of needles) {
    const suffix = normalizeMatchName(needle).replace(/^\d+\s+\d+\s+/, "");
    if (suffix && maps.bySuffix.get(suffix)) return maps.bySuffix.get(suffix);
  }
  return null;
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
