import { MODULE_ID } from "./constants.js";
import { Orchestrator } from "./agents/orchestrator.js";
import { registerSettings } from "./settings.js";
import { attachControls } from "./ui/controls.js";
import { AgenticDjApp } from "./ui/dj-app.js";

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  const orchestrator = new Orchestrator();
  orchestrator.start();
  attachControls(orchestrator);
  const api = {
    orchestrator,
    open: () => AgenticDjApp.open(orchestrator),
    analyze: force => orchestrator.analyzeLibrary(force),
    suggest: () => orchestrator.suggestNow()
  };
  game.modules.get(MODULE_ID).api = api;
  globalThis.agenticDj = api;
  ui.notifications.info(game.i18n.localize("AGENTICDJ.Notify.Ready"));
});
