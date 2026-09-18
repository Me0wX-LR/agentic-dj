import { FLAG_SCOPE } from "../constants.js";
import { cardFromSound } from "../rag/catalog.js";
import { searchBlob } from "../rag/sound-index.js";
import { expandQuery } from "../rag/synonyms.js";

/**
 * Let the Playlists directory search bar match Agentic DJ mood, tags, and use-when.
 */
export function patchPlaylistSearch() {
  const Directory = foundry.applications?.sidebar?.tabs?.PlaylistDirectory;
  if (!Directory?.prototype?._matchSearchEntries) return;
  if (Directory.prototype._agenticDjSearchPatched) return;
  const original = Directory.prototype._matchSearchEntries;
  Directory.prototype._matchSearchEntries = function (query, entryIds, folderIds, autoExpandIds, options = {}) {
    original.call(this, query, entryIds, folderIds, autoExpandIds, options);
    const raw = document.querySelector('.directory[data-tab="playlists"] input[name="search"]')?.value
      || document.querySelector('#playlists input[name="search"]')?.value
      || query
      || "";
    const terms = String(raw).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return;
    const soundIds = options.soundIds ??= new Set();
    for (const playlist of this.collection) {
      let hit = false;
      for (const sound of playlist.sounds) {
        if (!soundMatchesTerms(playlist, sound, terms)) continue;
        soundIds.add(sound.id);
        hit = true;
      }
      if (!hit) continue;
      entryIds.add(playlist.id);
      for (let folder = playlist.folder; folder; folder = folder.folder) {
        folderIds.add(folder.id);
        autoExpandIds?.add?.(folder.id);
      }
    }
  };
  Directory.prototype._agenticDjSearchPatched = true;
}

export function soundMatchesTerms(playlist, sound, terms) {
  const card = cardFromSound(playlist, sound);
  const hay = [
    searchBlob(card),
    sound.name || "",
    sound.description || "",
    sound.getFlag?.(FLAG_SCOPE, "search") || ""
  ].join(" ").toLowerCase();
  return terms.every(term => {
    if (hay.includes(term)) return true;
    return expandQuery(term).some(token => token.length > 1 && hay.includes(token));
  });
}
