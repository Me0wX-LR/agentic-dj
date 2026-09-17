import { MODULE_ID } from "../constants.js";
import { logWarn } from "../debug/log.js";
import { inferWantedMood } from "../rag/retrieve.js";
import { renderMemoryMarkdown } from "./markdown.js";

const SESSION_KEY = `${MODULE_ID}.session`;
const SETTING_KEY = "learnedMemory";

function emptyState() {
  return {
    recentIds: [],
    skippedIds: [],
    lastProposedIds: [],
    bannedIds: [],
    banned: [],
    likes: {},
    dislikes: {},
    events: []
  };
}

export function memoryDir() {
  return `worlds/${game.world.id}/agentic-dj`;
}

export function memoryPath() {
  return `${memoryDir()}/memory.md`;
}

export class SessionMemory {
  constructor() {
    this.data = emptyState();
    this._writeTimer = null;
  }

  snapshot() {
    return foundry.utils.deepClone(this.data);
  }

  summary() {
    return {
      likes: this.data.likes,
      dislikes: this.data.dislikes,
      bannedIds: this.data.bannedIds,
      recentIds: this.data.recentIds.slice(0, 6)
    };
  }

  async load() {
    const fromWorld = game.settings.get(MODULE_ID, SETTING_KEY);
    if (fromWorld && typeof fromWorld === "object" && Object.keys(fromWorld).length) {
      this.data = { ...emptyState(), ...fromWorld };
      this.data.skippedIds = Array.isArray(fromWorld.skippedIds) ? [...fromWorld.skippedIds] : [];
      this.data.lastProposedIds = Array.isArray(fromWorld.lastProposedIds) ? [...fromWorld.lastProposedIds] : [];
    }
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) {
      try {
        const parsed = JSON.parse(session);
        this.data.skippedIds = uniqueIds([...(this.data.skippedIds ?? []), ...(parsed.skippedIds ?? [])]);
        this.data.lastProposedIds = parsed.lastProposedIds ?? this.data.lastProposedIds ?? [];
        if (!this.data.recentIds.length && parsed.recentIds) this.data.recentIds = parsed.recentIds;
      } catch {
        // ignore
      }
    }
  }

  async record(action, { soundId, name = "", mood = "", scene = "", why = "" } = {}) {
    const event = { action, soundId, name, mood, scene, why, at: Date.now() };
    this.data.events.unshift(event);
    this.data.events = this.data.events.slice(0, 100);

    if (action === "play") {
      this.data.recentIds = [soundId, ...this.data.recentIds.filter(id => id !== soundId)].slice(0, 12);
      this.data.skippedIds = this.data.skippedIds.filter(id => id !== soundId);
      this.data.lastProposedIds = (this.data.lastProposedIds ?? []).filter(id => id !== soundId);
      bump(this.data.likes, mood || "general", soundId, name);
    } else if (action === "skip") {
      if (!this.data.skippedIds.includes(soundId)) this.data.skippedIds.push(soundId);
      bump(this.data.dislikes, mood || "general", soundId, name);
    } else if (action === "ban") {
      if (!this.data.bannedIds.includes(soundId)) this.data.bannedIds.push(soundId);
      if (!this.data.banned.some(row => row.soundId === soundId)) {
        this.data.banned.push({ soundId, name, at: Date.now() });
      }
      bump(this.data.dislikes, mood || "general", soundId, name);
    }
    await this.persist();
  }

  noteProposed(soundIds = []) {
    this.data.lastProposedIds = uniqueIds(soundIds).slice(0, 12);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        skippedIds: this.data.skippedIds,
        recentIds: this.data.recentIds,
        lastProposedIds: this.data.lastProposedIds
      }));
    } catch {
      // sessionStorage can be unavailable in some Foundry hosts
    }
  }

  async forget() {
    this.data = emptyState();
    await this.persist();
  }

  async persist() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        skippedIds: this.data.skippedIds,
        recentIds: this.data.recentIds,
        lastProposedIds: this.data.lastProposedIds
      }));
    } catch {
      // ignore
    }
    await game.settings.set(MODULE_ID, SETTING_KEY, this.snapshot());
    clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => {
      this.writeMarkdown().catch(err => logWarn("memory.md.write.failed", { error: err }));
    }, 250);
  }

  toMarkdown() {
    return renderMemoryMarkdown({
      worldName: game.world?.title || game.world?.id,
      updatedAt: Date.now(),
      likes: this.data.likes,
      dislikes: this.data.dislikes,
      banned: this.data.banned,
      events: this.data.events,
      path: memoryPath()
    });
  }

  async writeMarkdown() {
    const dir = memoryDir();
    const picker = filePickerClass();
    try {
      await picker.createDirectory("data", dir, { notify: false });
    } catch {
      // directory already exists
    }
    const file = new File([this.toMarkdown()], "memory.md", { type: "text/markdown" });
    await picker.upload("data", dir, file, {}, { notify: false });
  }

  async openMarkdown() {
    const text = this.toMarkdown();
    try {
      await this.writeMarkdown();
    } catch (err) {
      logWarn("memory.md.write.failed", { error: err });
    }
    const { openTextViewer } = await import("../ui/text-viewer.js");
    openTextViewer({
      title: game.i18n.localize("AGENTICDJ.Memory"),
      filename: "memory.md",
      path: memoryPath(),
      hint: game.i18n.localize("AGENTICDJ.Viewer.MemoryHint"),
      text
    });
  }
}

export function moodFromSituation(situation = {}, fallback = "") {
  return inferWantedMood(situation) || fallback || "general";
}

function uniqueIds(ids = []) {
  return [...new Set(ids.filter(Boolean))];
}

function bump(map, mood, soundId, name) {
  if (!soundId) return;
  map[mood] ??= {};
  map[mood][soundId] ??= { name, count: 0 };
  map[mood][soundId].name = name || map[mood][soundId].name;
  map[mood][soundId].count += 1;
}

function filePickerClass() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}
