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

export async function pauseAllMusic() {
  for (const playlist of game.playlists ?? []) {
    for (const sound of playlist.sounds ?? []) {
      if (!sound.playing) continue;
      if (typeof playlist.pauseSound === "function") await playlist.pauseSound(sound);
      else {
        const current = sound.sound?.currentTime ?? sound.pausedTime ?? 0;
        await sound.update({ playing: false, pausedTime: current });
      }
    }
  }
}

export async function playIncludedSounds(soundIds = [], { shuffle = false } = {}) {
  const ids = [...new Set((soundIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("No included tracks to play");
  const playlists = new Map();
  for (const id of ids) {
    const found = findSound(id);
    if (!found) continue;
    if (!playlists.has(found.playlist.id)) playlists.set(found.playlist.id, { playlist: found.playlist, ids: [] });
    playlists.get(found.playlist.id).ids.push(id);
  }
  if (!playlists.size) throw new Error("No included tracks to play");
  const modes = globalThis.CONST?.PLAYLIST_MODES ?? { SEQUENTIAL: 0, SHUFFLE: 1 };
  for (const playlist of game.playlists.playing) {
    if (!playlists.has(playlist.id)) await playlist.stopAll();
  }
  let last = null;
  for (const { playlist, ids: group } of playlists.values()) {
    if (shuffle && typeof playlist.update === "function") {
      await playlist.update({ mode: modes.SHUFFLE ?? 1 });
    }
    const startId = shuffle ? group[Math.floor(Math.random() * group.length)] : group[0];
    const sound = playlist.sounds.get(startId);
    if (sound) {
      await playlist.playSound(sound);
      last = { playlist: playlist.name, sound: sound.name, shuffle };
    }
  }
  return last;
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
