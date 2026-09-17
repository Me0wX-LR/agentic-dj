import { FLAG_CARD, FLAG_SCOPE, MODULE_ID } from "../constants.js";

function audioTaggerTags(doc) {
  const flags = doc.flags?.["audio-tagger"];
  if (!flags) return [];
  if (Array.isArray(flags.tags)) return flags.tags.map(tag => typeof tag === "string" ? tag : tag.name).filter(Boolean);
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
    tags: [...new Set([...(stored?.tags ?? []), ...extraTags])],
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

export function listCatalog() {
  const catalog = [];
  for (const playlist of game.playlists ?? []) {
    for (const sound of playlist.sounds ?? []) {
      catalog.push(cardFromSound(playlist, sound));
    }
  }
  return catalog;
}

export function findSound(soundId) {
  for (const playlist of game.playlists ?? []) {
    const sound = playlist.sounds.get(soundId);
    if (sound) return { playlist, sound };
  }
  return null;
}

export function catalogStats() {
  const catalog = listCatalog();
  const analyzed = catalog.filter(track => track.features || track.mood);
  return {
    total: catalog.length,
    analyzed: analyzed.length,
    pending: catalog.length - analyzed.length
  };
}

export async function writeCard(sound, card) {
  const payload = {
    ...card,
    analyzedAt: Date.now()
  };
  await sound.setFlag(FLAG_SCOPE, FLAG_CARD, payload);
  return cardFromSound(sound.parent, sound);
}

export function modulePath(rel) {
  return `modules/${MODULE_ID}/${rel}`;
}
