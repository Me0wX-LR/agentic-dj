import { FLAG_CARD, FLAG_SCOPE, MODULE_ID } from "../constants.js";
import { mergeSoundDescription, searchBlob } from "./sound-index.js";
import { catalogMoodCounts } from "./retrieve.js";

function audioTaggerTags(doc) {
  const flags = doc.flags?.["audio-tagger"];
  if (!flags) return [];
  if (Array.isArray(flags.tags)) {
    return flags.tags.map(tag => {
      if (typeof tag === "string") return tag;
      return tag.name || tag.snapshot?.name || "";
    }).filter(Boolean);
  }
  if (Array.isArray(flags)) return flags.map(String);
  return [];
}

export function cardFromSound(playlist, sound) {
  const stored = sound.getFlag?.(FLAG_SCOPE, FLAG_CARD) ?? sound.flags?.[FLAG_SCOPE]?.[FLAG_CARD];
  const extraTags = audioTaggerTags(sound);
  return {
    playlistId: playlist.id,
    playlistName: playlist.name,
    soundId: sound.id,
    name: sound.name,
    path: sound.path,
    tags: [...new Set([...(stored?.tags ?? []), ...extraTags, ...(stored?.mood ? [stored.mood] : [])])],
    mood: stored?.mood ?? null,
    intensity: stored?.intensity ?? null,
    setting: stored?.setting ?? [],
    instruments: stored?.instruments ?? [],
    useWhen: stored?.useWhen ?? "",
    avoidWhen: stored?.avoidWhen ?? "",
    features: stored?.features ?? null,
    analyzedAt: stored?.analyzedAt ?? null,
    heuristic: stored?.heuristic ?? false
  };
}

export function playlistDocuments() {
  return game.playlists?.contents ?? [];
}

export function soundDocuments(playlist) {
  return playlist?.sounds?.contents ?? [];
}

export function listCatalog() {
  const catalog = [];
  for (const playlist of playlistDocuments()) {
    for (const sound of soundDocuments(playlist)) {
      catalog.push(cardFromSound(playlist, sound));
    }
  }
  return catalog;
}

export function findSound(soundId) {
  for (const playlist of playlistDocuments()) {
    const sound = playlist.sounds.get(soundId);
    if (sound) return { playlist, sound };
  }
  return null;
}

export function catalogStats() {
  const catalog = listCatalog();
  const analyzed = catalog.filter(track => track.features || track.mood);
  const moods = catalogMoodCounts(catalog);
  return {
    total: catalog.length,
    analyzed: analyzed.length,
    pending: catalog.length - analyzed.length,
    moods: moods.moods,
    dominantMood: moods.dominantMood,
    dominantCount: moods.dominantCount,
    homogeneous: moods.homogeneous
  };
}

export function catalogInventory() {
  return playlistDocuments().map(playlist => ({
    id: playlist.id,
    name: playlist.name,
    mode: playlist.mode,
    sounds: soundDocuments(playlist).map(sound => ({
      id: sound.id,
      name: sound.name,
      path: sound.path || "",
      analyzed: Boolean(sound.getFlag?.(FLAG_SCOPE, FLAG_CARD) ?? sound.flags?.[FLAG_SCOPE]?.[FLAG_CARD])
    }))
  }));
}

export async function writeCard(sound, card) {
  const payload = {
    ...card,
    analyzedAt: Date.now()
  };
  await sound.setFlag(FLAG_SCOPE, FLAG_CARD, payload);
  await sound.setFlag(FLAG_SCOPE, "search", searchBlob({ ...payload, name: sound.name, playlistName: sound.parent?.name }));
  const description = mergeSoundDescription(sound.description || "", {
    ...payload,
    name: sound.name
  });
  if (description !== (sound.description || "")) {
    await sound.update({ description });
  }
  return cardFromSound(sound.parent, sound);
}

export function modulePath(rel) {
  return `modules/${MODULE_ID}/${rel}`;
}
