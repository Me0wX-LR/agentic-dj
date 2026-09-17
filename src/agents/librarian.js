import { MOODS } from "../constants.js";
import { logError, logInfo, logWarn } from "../debug/log.js";
import { catalogInventory, findSound, listCatalog, writeCard } from "../rag/catalog.js";
import { hasLlmKey, publicLlmConfig } from "../settings.js";
import { analyzeSoundFile } from "../tools/audio-analyze.js";
import { chatJson, extraSystem } from "../tools/llm.js";

export class Librarian {
  async analyzeAll({ force = false } = {}) {
    const all = listCatalog();
    const tracks = all.filter(track => force || !track.analyzedAt);
    logInfo("librarian.analyze.start", {
      force,
      catalogSize: all.length,
      pending: tracks.length,
      llm: publicLlmConfig(),
      playlists: catalogInventory()
    });
    const results = [];
    const failures = [];
    for (const track of tracks) {
      try {
        results.push(await this.analyzeTrack(track.soundId));
      } catch (err) {
        logError("librarian.analyze.track.failed", { name: track.name, path: track.path, error: err });
        failures.push({ name: track.name, error: err.message || String(err) });
      }
    }
    logInfo("librarian.analyze.done", {
      ok: results.length,
      failed: failures.length,
      scanned: tracks.length,
      catalogSize: listCatalog().length,
      failures
    });
    return { results, failures, scanned: tracks.length, catalogSize: listCatalog().length };
  }

  async analyzeFromList(text, { onProgress } = {}) {
    const { parseManualCatalog, parseTableDraft } = await import("../rag/manual-catalog.js");
    const rows = String(text || "").trim().startsWith("[") ? parseTableDraft(text) : parseManualCatalog(text);
    return this.saveRows(rows, { llmFill: true, onProgress });
  }

  async saveRows(rawRows, { llmFill = false, onProgress } = {}) {
    const { heuristicCard, matchRowToTrack, mergeCard, normalizeManualRow } = await import("../rag/manual-catalog.js");
    const rows = (rawRows ?? []).map(normalizeManualRow).filter(row => row.included !== false && (row.name || row.soundId));
    const catalog = listCatalog();
    logInfo("librarian.manual.start", { rows: rows.length, catalogSize: catalog.length, llmFill, llm: publicLlmConfig() });
    const matched = [];
    const unmatched = [];
    for (const row of rows) {
      const track = matchRowToTrack(row, catalog);
      if (!track) unmatched.push(row.name || row.soundId);
      else matched.push({ row, track });
    }
    const byName = new Map();
    if (llmFill && hasLlmKey()) {
      const blanks = matched.filter(item => !item.row.mood);
      const batches = chunk(blanks, 8);
      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        onProgress?.(`LLM tagging ${index * 8 + 1}–${Math.min((index + 1) * 8, blanks.length)} of ${blanks.length}`);
        logInfo("librarian.manual.batch", { index: index + 1, size: batch.length });
        try {
          const payload = await chatJson([
            {
              role: "system",
              content: `You are the Librarian for a TTRPG soundtrack DJ. Tag each listed track from its name and any GM notes. Moods: ${MOODS.join(", ")}. Japanese/Latin OST titles are not all exploration — infer combat, tension, sad, tavern, horror from the title. Do not invent tracks that are not in the list.${extraSystem()}`
            },
            {
              role: "user",
              content: JSON.stringify(batch.map(item => ({
                name: item.track.name,
                path: item.track.path,
                playlist: item.track.playlistName,
                notes: item.row
              })))
            }
          ], 'Schema: {"cards":[{"name":"","mood":"","intensity":1,"tags":[],"setting":[],"instruments":[],"useWhen":"","avoidWhen":""}]}', { maxTokens: 1800 });
          for (const card of payload.cards ?? []) {
            if (card?.name) byName.set(String(card.name).trim().toLowerCase(), card);
          }
        } catch (err) {
          logWarn("librarian.manual.batch.failed", { index: index + 1, error: err });
        }
      }
    }

    const results = [];
    const failures = [];
    for (const [index, item] of matched.entries()) {
      onProgress?.(`Saving ${index + 1}/${matched.length}: ${item.track.name}`);
      try {
        const found = findSound(item.track.soundId);
        if (!found?.sound) throw new Error("Playlist sound missing");
        const base = heuristicCard(item.row, item.track);
        const llmCard = byName.get(item.track.name.toLowerCase()) || byName.get(item.row.name.toLowerCase()) || {};
        const card = mergeCard(base, llmCard);
        if (item.row.mood) card.mood = item.row.mood;
        if (item.row.intensity) card.intensity = item.row.intensity;
        if (item.row.tags.length) card.tags = unique([...item.row.tags, ...card.tags]);
        if (item.row.useWhen) card.useWhen = item.row.useWhen;
        results.push(await writeCard(found.sound, card));
      } catch (err) {
        logError("librarian.manual.save.failed", { name: item.track.name, error: err });
        failures.push({ name: item.track.name, error: err.message || String(err) });
      }
    }
    logInfo("librarian.manual.done", {
      ok: results.length,
      failed: failures.length,
      unmatched,
      catalogSize: listCatalog().length
    });
    return { results, failures, unmatched, scanned: rows.length, catalogSize: listCatalog().length };
  }

  async analyzeTrack(soundId) {
    const catalog = listCatalog();
    const track = catalog.find(row => row.soundId === soundId);
    if (!track) throw new Error("Track not found");
    const found = findSound(soundId);
    if (!found?.sound) throw new Error(`Playlist sound ${track.name} is missing`);
    logInfo("librarian.track.start", {
      name: track.name,
      path: track.path,
      playlist: track.playlistName,
      soundId
    });

    let features = null;
    try {
      features = await analyzeSoundFile(track.path);
      logInfo("librarian.track.features", {
        name: track.name,
        backend: features.backend,
        tempo: features.tempo,
        energy: features.energy,
        mood: features.mood,
        intensity: features.intensity,
        tags: features.tags
      });
    } catch (err) {
      logWarn("librarian.track.decode.fallback", { name: track.name, path: track.path, error: err });
      features = filenameFeatures(track.name, track.path, err.message);
    }

    const filenameTags = filenameHints(track.name, track.path);
    let card = {
      tags: [...new Set([...(features.tags ?? []), ...filenameTags])],
      mood: features.mood,
      intensity: features.intensity,
      setting: filenameTags.filter(tag => ["tavern", "forest", "dungeon", "city", "sea", "cave"].includes(tag)),
      instruments: [],
      useWhen: defaultUseWhen(features.mood),
      avoidWhen: features.mood === "combat" ? "Quiet social scenes" : "Peak combat",
      features,
      heuristic: true
    };
    if (hasLlmKey()) {
      try {
        const llmCard = await chatJson([
          {
            role: "system",
            content: `You are the Librarian agent for a TTRPG soundtrack DJ. Write a compact catalog card from local audio features and the filename. Moods: ${MOODS.join(", ")}.${extraSystem()}`
          },
          {
            role: "user",
            content: JSON.stringify({
              name: track.name,
              path: track.path,
              features,
              filenameTags
            })
          }
        ], 'Schema: {"tags":[],"mood":"","intensity":1,"setting":[],"instruments":[],"useWhen":"","avoidWhen":""}');
        card = {
          tags: unique([...(llmCard.tags ?? []), ...card.tags]),
          mood: llmCard.mood || card.mood,
          intensity: Number(llmCard.intensity ?? card.intensity),
          setting: llmCard.setting ?? card.setting,
          instruments: llmCard.instruments ?? [],
          useWhen: llmCard.useWhen || card.useWhen,
          avoidWhen: llmCard.avoidWhen || card.avoidWhen,
          features,
          heuristic: false
        };
        logInfo("librarian.track.llm.ok", {
          name: track.name,
          mood: card.mood,
          intensity: card.intensity,
          tags: card.tags
        });
      } catch (err) {
        logWarn("librarian.track.llm.failed", { name: track.name, error: err });
      }
    } else {
      logInfo("librarian.track.llm.skipped", { name: track.name, reason: "no LLM key or base URL" });
    }
    const written = await writeCard(found.sound, card);
    logInfo("librarian.track.saved", {
      name: written.name,
      mood: written.mood,
      heuristic: written.heuristic,
      tags: written.tags
    });
    return written;
  }
}

function filenameFeatures(name, path, reason) {
  const tags = filenameHints(name, path);
  const mood = tags.includes("combat") || tags.includes("battle")
    ? "combat"
    : tags.includes("tavern") || tags.includes("inn")
      ? "tavern"
      : tags.includes("horror") || tags.includes("dark")
        ? "horror"
        : tags.includes("ambient")
          ? "ambient"
          : "exploration";
  return {
    backend: "filename",
    duration: 0,
    tempo: 100,
    energy: mood === "combat" ? 0.5 : 0.1,
    mood,
    intensity: mood === "combat" ? 5 : 3,
    tags,
    decodeError: reason || "decode failed"
  };
}

function filenameHints(name, path) {
  const blob = `${name} ${path}`.toLowerCase();
  return [
    "combat", "battle", "boss", "tavern", "inn", "forest", "dungeon", "cave", "city",
    "sea", "ocean", "horror", "dark", "ambient", "explore", "travel", "sad", "epic",
    "mystery", "stealth", "village", "temple"
  ].filter(tag => blob.includes(tag));
}

function defaultUseWhen(mood) {
  switch (mood) {
    case "combat": return "Fights, chases, sudden violence";
    case "tavern": return "Inns, drinking, friendly hubs";
    case "horror": return "Dread, undead, wrongness";
    case "ambient": return "Safe camps and quiet underscoring";
    default: return "General exploration";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(v => String(v).toLowerCase()))];
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}
