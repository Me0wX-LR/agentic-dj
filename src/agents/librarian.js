import { MODULE_ID, MOODS } from "../constants.js";
import { listCatalog, writeCard } from "../rag/catalog.js";
import { hasLlmKey } from "../settings.js";
import { analyzeSoundFile } from "../tools/audio-analyze.js";
import { chatJson, extraSystem } from "../tools/llm.js";

export class Librarian {
  constructor() {
    this.queue = [];
    this.busy = false;
  }

  async analyzeAll({ force = false } = {}) {
    const tracks = listCatalog().filter(track => force || !track.analyzedAt);
    const results = [];
    for (const track of tracks) {
      try {
        results.push(await this.analyzeTrack(track.soundId));
      } catch (err) {
        console.warn(`${MODULE_ID} | analyze failed for ${track.name}`, err);
      }
    }
    return results;
  }

  async analyzeTrack(soundId) {
    const catalog = listCatalog();
    const track = catalog.find(row => row.soundId === soundId);
    if (!track) throw new Error("Track not found");
    const found = [...game.playlists].flatMap(p => [...p.sounds].map(sound => ({ playlist: p, sound }))).find(row => row.sound.id === soundId);
    const features = await analyzeSoundFile(track.path);
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
      } catch (err) {
        console.warn(`${MODULE_ID} | librarian LLM failed, keeping heuristic card`, err);
      }
    }
    return writeCard(found.sound, card);
  }
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
