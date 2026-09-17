import { findSound } from "../rag/catalog.js";

export function playingSummary() {
  return (game.playlists?.playing ?? []).map(playlist => ({
    playlist: playlist.name,
    tracks: playlist.sounds.filter(s => s.playing).map(s => s.name)
  }));
}

export async function playSoundById(soundId, { stopOthers = true } = {}) {
  const found = findSound(soundId);
  if (!found) throw new Error(`Sound ${soundId} not found`);
  if (stopOthers) {
    for (const playlist of game.playlists.playing) {
      if (playlist.id !== found.playlist.id) await playlist.stopAll();
    }
    for (const other of found.playlist.sounds) {
      if (other.id !== soundId && other.playing) await found.playlist.stopSound(other);
    }
  }
  await found.playlist.playSound(found.sound);
  return { playlist: found.playlist.name, sound: found.sound.name };
}

export async function stopAllMusic() {
  for (const playlist of game.playlists.playing) await playlist.stopAll();
}

export async function previewSound(soundId) {
  const found = findSound(soundId);
  if (!found) return;
  const src = foundry.utils.getRoute(found.sound.path);
  const helper = game.audio;
  if (helper?.play) {
    await helper.play({ src, channel: "music", volume: 0.5 });
    return;
  }
  const audio = new Audio(src);
  audio.volume = 0.5;
  await audio.play();
  setTimeout(() => audio.pause(), 8000);
}
