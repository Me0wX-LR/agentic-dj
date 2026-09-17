import { MODULE_ID } from "../constants.js";
import { catalogStats } from "../rag/catalog.js";
import { SessionMemory, memoryPath, moodFromSituation } from "../memory/session.js";
import { setting } from "../settings.js";
import { playSoundById, previewSound, stopAllMusic } from "../tools/playlists.js";
import { Director } from "./director.js";
import { Librarian } from "./librarian.js";
import { Listener } from "./listener.js";

export class Orchestrator {
  constructor() {
    this.memory = new SessionMemory();
    this.librarian = new Librarian();
    this.director = new Director(this.memory);
    this.listener = new Listener((brief, reason) => this.#onSituation(brief, reason));
    this.situation = this.listener.brief();
    this.proposal = { cues: [], plan: "", dropped: [] };
    this.status = "idle";
    this.lastSuggestAt = 0;
    this.app = null;
    this.debounce = null;
  }

  async start() {
    await this.memory.load();
    this.listener.startHooks();
    this.situation = this.listener.brief();
    if (setting("autoAnalyze")) {
      this.analyzeLibrary().catch(err => console.warn(`${MODULE_ID} | auto-analyze`, err));
    }
  }

  bind(app) {
    this.app = app;
  }

  refreshUi() {
    this.app?.render?.();
  }

  async toggleListen() {
    if (this.listener.listening) this.listener.stopMic();
    else await this.listener.startMic();
    this.refreshUi();
  }

  async analyzeLibrary(force = false) {
    this.status = "analyzing";
    this.refreshUi();
    try {
      const results = await this.librarian.analyzeAll({ force });
      this.status = "idle";
      ui.notifications.info(game.i18n.format("AGENTICDJ.Analyzed", { count: results.length }));
      return results;
    } catch (err) {
      this.status = "error";
      ui.notifications.error(err.message);
      throw err;
    } finally {
      this.refreshUi();
    }
  }

  async suggestNow({ recoverFrom = null } = {}) {
    this.status = "planning";
    this.refreshUi();
    this.situation = this.listener.brief();
    try {
      this.proposal = await this.director.plan(this.situation, { recoverFrom });
      this.lastSuggestAt = Date.now();
      this.status = "awaiting-gm";
      return this.proposal;
    } catch (err) {
      this.status = "error";
      ui.notifications.error(err.message);
      throw err;
    } finally {
      this.refreshUi();
    }
  }

  async playCue(soundId) {
    const cue = this.proposal.cues.find(row => row.soundId === soundId);
    await playSoundById(soundId);
    await this.memory.record("play", {
      soundId,
      name: cue?.name,
      mood: moodFromSituation(this.situation, cue?.mood),
      scene: this.situation.sceneName,
      why: cue?.why ?? ""
    });
    this.status = "playing";
    ui.notifications.info(game.i18n.localize("AGENTICDJ.Played"));
    this.refreshUi();
  }

  async previewCue(soundId) {
    await previewSound(soundId);
  }

  async skipCue(soundId) {
    const cue = this.proposal.cues.find(row => row.soundId === soundId);
    await this.memory.record("skip", {
      soundId,
      name: cue?.name,
      mood: moodFromSituation(this.situation, cue?.mood),
      scene: this.situation.sceneName,
      why: "gm-skip"
    });
    ui.notifications.info(game.i18n.localize("AGENTICDJ.Rejected"));
    await this.suggestNow({ recoverFrom: { soundId, action: "skip" } });
  }

  async banCue(soundId) {
    const cue = this.proposal.cues.find(row => row.soundId === soundId);
    await this.memory.record("ban", {
      soundId,
      name: cue?.name,
      mood: moodFromSituation(this.situation, cue?.mood),
      scene: this.situation.sceneName,
      why: "gm-ban"
    });
    ui.notifications.info(game.i18n.localize("AGENTICDJ.Banned"));
    await this.suggestNow({ recoverFrom: { soundId, action: "ban" } });
  }

  async openMemory() {
    await this.memory.openMarkdown();
  }

  async forgetMemory() {
    await this.memory.forget();
    ui.notifications.info(game.i18n.localize("AGENTICDJ.MemoryCleared"));
    this.refreshUi();
  }

  async stopMusic() {
    await stopAllMusic();
    this.refreshUi();
  }

  snapshot() {
    return {
      situation: this.situation,
      proposal: this.proposal,
      listening: this.listener.listening,
      status: this.status,
      catalog: catalogStats(),
      memory: this.memory.snapshot(),
      memoryPath: memoryPath()
    };
  }

  #onSituation(brief, reason) {
    this.situation = brief;
    this.refreshUi();
    if (reason === "mic-start" || reason === "mic-stop") return;
    const cooldown = Number(setting("cooldown") || 20) * 1000;
    if (Date.now() - this.lastSuggestAt < cooldown) return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.suggestNow().catch(err => console.warn(`${MODULE_ID} | autosuggest`, err));
    }, 1500);
  }
}
