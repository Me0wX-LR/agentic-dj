import { MODULE_ID } from "../constants.js";

const MEMORY_KEY = `${MODULE_ID}.session`;

function emptyMemory() {
  return {
    recentIds: [],
    skippedIds: [],
    bannedIds: [],
    acceptReasons: [],
    rejectReasons: []
  };
}

export class SessionMemory {
  constructor() {
    this.data = emptyMemory();
  }

  snapshot() {
    return foundry.utils.deepClone(this.data);
  }

  markPlayed(soundId, why = "") {
    this.data.recentIds = [soundId, ...this.data.recentIds.filter(id => id !== soundId)].slice(0, 12);
    if (why) this.data.acceptReasons.unshift({ soundId, why, at: Date.now() });
    this.data.acceptReasons = this.data.acceptReasons.slice(0, 20);
    this.#persist();
  }

  skip(soundId, why = "") {
    if (!this.data.skippedIds.includes(soundId)) this.data.skippedIds.push(soundId);
    this.data.rejectReasons.unshift({ soundId, why, at: Date.now(), kind: "skip" });
    this.data.rejectReasons = this.data.rejectReasons.slice(0, 20);
    this.#persist();
  }

  ban(soundId, why = "") {
    if (!this.data.bannedIds.includes(soundId)) this.data.bannedIds.push(soundId);
    this.data.rejectReasons.unshift({ soundId, why, at: Date.now(), kind: "ban" });
    this.data.rejectReasons = this.data.rejectReasons.slice(0, 20);
    this.#persist();
  }

  load() {
    const saved = sessionStorage.getItem(MEMORY_KEY);
    if (!saved) return;
    try {
      this.data = { ...emptyMemory(), ...JSON.parse(saved) };
    } catch (err) {
      console.warn(`${MODULE_ID} | could not restore session memory`, err);
    }
  }

  #persist() {
    try {
      sessionStorage.setItem(MEMORY_KEY, JSON.stringify(this.data));
    } catch {
      // ignore quota
    }
  }
}
