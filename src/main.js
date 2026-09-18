import { MODULE_ID, VERSION } from "./constants.js";
import { applyUiLanguage } from "./i18n.js";
import { Orchestrator } from "./agents/orchestrator.js";
import {
  copyLogDump,
  formatLogDump,
  getLogEntries,
  logError,
  logInfo,
  openLogFile,
  persistLogs
} from "./debug/log.js";
import { catalogStats } from "./rag/catalog.js";
import { publicLlmConfig, registerSettings } from "./settings.js";
import { bindControls, registerControlHooks } from "./ui/controls.js";
import { patchPlaylistSearch } from "./ui/playlist-search.js";
import { AgenticDjApp } from "./ui/dj-app.js";

function exposeApi(orchestrator) {
  const api = {
    orchestrator,
    open: () => AgenticDjApp.open(orchestrator),
    analyze: force => orchestrator.analyzeLibrary(force),
    analyzeList: (text, options) => orchestrator.analyzeFromList(text, options),
    suggest: () => orchestrator.suggestNow(),
    logs: getLogEntries,
    copyLogs: copyLogDump,
    dumpLogs: formatLogDump,
    persistLogs,
    openLogs: openLogFile
  };
  const pack = game.modules.get(MODULE_ID);
  if (pack) pack.api = api;
  globalThis.agenticDj = api;
  return api;
}

Hooks.once("init", () => {
  try {
    registerSettings();
    registerControlHooks();
    logInfo("module.init", { version: VERSION, moduleJson: game.modules.get(MODULE_ID)?.version });
  } catch (err) {
    console.error("agentic-dj init failed", err);
  }
});

Hooks.once("i18nInit", () => {
  void applyUiLanguage().catch(err => logError("module.i18nInit.failed", { error: err }));
});

Hooks.once("setup", () => {
  try {
    patchPlaylistSearch();
  } catch (err) {
    logError("module.setup.failed", { error: err });
  }
});

Hooks.once("ready", () => {
  void startModule();
});

async function startModule() {
  try {
    try {
      patchPlaylistSearch();
    } catch (err) {
      logError("module.patchSearch.failed", { error: err });
    }
    if (!game.user.isGM) {
      logInfo("module.ready.skip", { reason: "not-gm" });
      return;
    }
    const orchestrator = new Orchestrator();
    bindControls(orchestrator);
    exposeApi(orchestrator);
    orchestrator.start().catch(err => logError("orchestrator.start.failed", { error: err }));
    logInfo("module.ready", {
      version: VERSION,
      moduleJson: game.modules.get(MODULE_ID)?.version,
      world: game.world?.id,
      catalog: catalogStats(),
      llm: publicLlmConfig()
    });
    ui.notifications.info(game.i18n.localize("AGENTICDJ.Notify.Ready"));
    try {
      await applyUiLanguage();
      bindControls(orchestrator);
    } catch (err) {
      logError("module.language.failed", { error: err });
    }
  } catch (err) {
    logError("module.ready.failed", { error: err });
    ui.notifications.error(game.i18n.format("AGENTICDJ.Notify.Failed", { error: err.message }));
  }
}
