import { MODULE_ID, VERSION } from "./constants.js";
import { applyUiLanguage } from "./i18n.js";
import { Orchestrator } from "./agents/orchestrator.js";
import {
  copyLogDump,
  formatLogDump,
  getLogEntries,
  logInfo,
  openLogFile,
  persistLogs
} from "./debug/log.js";
import { catalogStats } from "./rag/catalog.js";
import { publicLlmConfig, registerSettings } from "./settings.js";
import { attachControls } from "./ui/controls.js";
import { patchPlaylistSearch } from "./ui/playlist-search.js";
import { AgenticDjApp } from "./ui/dj-app.js";

Hooks.once("init", () => {
  registerSettings();
  logInfo("module.init", { version: VERSION, moduleJson: game.modules.get(MODULE_ID)?.version });
});

Hooks.once("i18nInit", () => {
  void applyUiLanguage();
});

Hooks.once("setup", () => {
  patchPlaylistSearch();
});

Hooks.once("ready", async () => {
  await applyUiLanguage();
  patchPlaylistSearch();
  if (!game.user.isGM) {
    logInfo("module.ready.skip", { reason: "not-gm" });
    return;
  }
  const orchestrator = new Orchestrator();
  orchestrator.start();
  attachControls(orchestrator);
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
  game.modules.get(MODULE_ID).api = api;
  globalThis.agenticDj = api;
  logInfo("module.ready", {
    version: VERSION,
    moduleJson: game.modules.get(MODULE_ID)?.version,
    world: game.world?.id,
    catalog: catalogStats(),
    llm: publicLlmConfig()
  });
  ui.notifications.info(game.i18n.localize("AGENTICDJ.Notify.Ready"));
});
