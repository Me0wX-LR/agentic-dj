import { MODULE_ID } from "../constants.js";
import { logError, logInfo } from "../debug/log.js";
import { catalogStats } from "../rag/catalog.js";
import { SessionMemory, memoryPath, moodFromSituation } from "../memory/session.js";
import { publicLlmConfig, setting } from "../settings.js";
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
    this.analysisProgress = "";
  }

  async start() {
    logInfo("orchestrator.start", { autoAnalyze: setting("autoAnalyze"), llm: publicLlmConfig() });
    await this.memory.load();
    this.listener.startHooks();
    this.situation = this.listener.brief();
    logInfo("orchestrator.ready", {
      scene: this.situation.sceneName,
      inCombat: this.situation.inCombat,
      catalog: catalogStats()
    });
    if (setting("autoAnalyze")) {
      const stats = catalogStats();
      if (stats.pending > 8) {
        logInfo("orchestrator.autoAnalyze.skipped", { pending: stats.pending, reason: "use-manual-list" });
      } else {
        this.analyzeLibrary().catch(err => logError("orchestrator.autoAnalyze.failed", { error: err }));
      }
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
    logInfo("orchestrator.listen", { listening: this.listener.listening });
    this.refreshUi();
  }

  async analyzeLibrary(force = false) {
    this.status = "analyzing";
    this.refreshUi();
    logInfo("orchestrator.analyze", { force });
    try {
      const { results, failures, scanned, catalogSize } = await this.librarian.analyzeAll({ force });
      this.status = "idle";
      if (!catalogSize) {
        ui.notifications.warn(game.i18n.localize("AGENTICDJ.NoTracks"));
      } else if (!results.length) {
        const first = failures[0]?.error ? ` ${failures[0].error}` : "";
        ui.notifications.error(game.i18n.format("AGENTICDJ.AnalyzedNone", { scanned, error: first }));
      } else if (failures.length) {
        ui.notifications.warn(game.i18n.format("AGENTICDJ.AnalyzedPartial", {
          count: results.length,
          failed: failures.length
        }));
      } else {
        ui.notifications.info(game.i18n.format("AGENTICDJ.Analyzed", { count: results.length }));
      }
      return results;
    } catch (err) {
      this.status = "error";
      logError("orchestrator.analyze.failed", { error: err });
      ui.notifications.error(err.message);
      throw err;
    } finally {
      this.analysisProgress = "";
      this.refreshUi();
    }
  }

  async analyzeFromList(text, { suggestAfter = false, situationNote = "", onProgress } = {}) {
    this.status = "analyzing";
    this.analysisProgress = "Reading catalog list…";
    this.refreshUi();
    logInfo("orchestrator.manual.analyze", { suggestAfter, situationChars: situationNote.length });
    try {
      await game.settings.set(MODULE_ID, "manualCatalogDraft", text);
      const { results, failures, unmatched, scanned } = await this.librarian.analyzeFromList(text, {
        onProgress: message => {
          this.analysisProgress = message;
          onProgress?.(message);
          this.refreshUi();
        }
      });
      this.status = "idle";
      this.analysisProgress = "";
      if (!scanned) {
        ui.notifications.warn(game.i18n.localize("AGENTICDJ.Manual.Empty"));
      } else if (!results.length) {
        ui.notifications.error(game.i18n.format("AGENTICDJ.Manual.NoneMatched", {
          scanned,
          sample: unmatched.slice(0, 3).join(", ")
        }));
      } else {
        const extra = unmatched.length ? ` ${game.i18n.format("AGENTICDJ.Manual.Unmatched", { count: unmatched.length })}` : "";
        ui.notifications.info(`${game.i18n.format("AGENTICDJ.Manual.Saved", { count: results.length })}${extra}`);
        if (failures.length) ui.notifications.warn(game.i18n.format("AGENTICDJ.AnalyzedPartial", {
          count: results.length,
          failed: failures.length
        }));
      }
      if (suggestAfter && results.length) {
        if (situationNote) {
          this.listener.transcript.push({ text: situationNote, source: "manual", at: Date.now() });
          this.listener.transcript = this.listener.transcript.slice(-40);
        }
        await this.suggestNow();
      }
      return results;
    } catch (err) {
      this.status = "error";
      logError("orchestrator.manual.failed", { error: err });
      ui.notifications.error(err.message);
      throw err;
    } finally {
      this.analysisProgress = "";
      this.refreshUi();
    }
  }

  async suggestNow({ recoverFrom = null } = {}) {
    this.status = "planning";
    this.refreshUi();
    this.situation = this.listener.brief();
    logInfo("orchestrator.suggest", {
      recoverFrom,
      scene: this.situation.sceneName,
      inCombat: this.situation.inCombat,
      mood: this.situation.mood,
      transcript: String(this.situation.transcript || "").slice(0, 200)
    });
    try {
      this.proposal = await this.director.plan(this.situation, { recoverFrom });
      this.lastSuggestAt = Date.now();
      this.status = "awaiting-gm";
      logInfo("orchestrator.suggest.done", {
        usedLlm: this.proposal.usedLlm,
        cueCount: this.proposal.cues?.length ?? 0,
        cues: (this.proposal.cues ?? []).map(cue => ({ name: cue.name, mood: cue.mood, soundId: cue.soundId })),
        dropped: this.proposal.dropped,
        fallback: this.proposal.fallback || ""
      });
      return this.proposal;
    } catch (err) {
      this.status = "error";
      logError("orchestrator.suggest.failed", { error: err });
      ui.notifications.error(err.message);
      throw err;
    } finally {
      this.refreshUi();
    }
  }

  async playCue(soundId) {
    const cue = this.proposal.cues.find(row => row.soundId === soundId);
    logInfo("orchestrator.play", { soundId, name: cue?.name });
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
    logInfo("orchestrator.skip", { soundId, name: cue?.name });
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
    logInfo("orchestrator.ban", { soundId, name: cue?.name });
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

  async copyLogs() {
    const { copyLogDump } = await import("../debug/log.js");
    await copyLogDump();
  }

  async openLogs() {
    const { openLogFile, persistLogs } = await import("../debug/log.js");
    await persistLogs();
    await openLogFile();
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
      memoryPath: memoryPath(),
      analysisProgress: this.analysisProgress
    };
  }

  #onSituation(brief, reason) {
    this.situation = brief;
    this.refreshUi();
    logInfo("listener.situation", {
      reason,
      scene: brief.sceneName,
      inCombat: brief.inCombat,
      mood: brief.mood,
      transcript: String(brief.transcript || "").slice(0, 160)
    });
    if (reason === "mic-start" || reason === "mic-stop") return;
    const cooldown = Number(setting("cooldown") || 20) * 1000;
    if (Date.now() - this.lastSuggestAt < cooldown) {
      logInfo("orchestrator.autosuggest.cooldown", { reason, cooldownMs: cooldown });
      return;
    }
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.suggestNow().catch(err => logError("orchestrator.autosuggest.failed", { error: err }));
    }, 1500);
  }
}
