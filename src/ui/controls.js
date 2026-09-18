import { MODULE_ID } from "../constants.js";
import { logError, logInfo, logWarn } from "../debug/log.js";
import { AgenticDjApp } from "./dj-app.js";

let orchestrator = null;
let hooksRegistered = false;
let injectedOnce = false;

function safe(event, fn) {
  try {
    return fn();
  } catch (err) {
    logError(event, { error: err });
    return false;
  }
}

export function openDj() {
  return safe("controls.open", () => {
    const current = orchestrator || game.modules.get(MODULE_ID)?.api?.orchestrator;
    if (!current) {
      logWarn("controls.open.missing");
      ui.notifications?.warn(game.i18n.localize("AGENTICDJ.Notify.NotReady"));
      return false;
    }
    AgenticDjApp.open(current);
    return true;
  });
}

function asElement(value) {
  if (value instanceof HTMLElement) return value;
  if (value?.[0] instanceof HTMLElement) return value[0];
  return null;
}

function playlistApp(app) {
  if (app && (app.id === "playlists" || app.tabName === "playlists" || app.constructor?.name === "PlaylistDirectory")) {
    return app;
  }
  return ui?.playlists || ui?.sidebar?.tabs?.playlists || game?.playlists?.directory || null;
}

function playlistRoot(app, html) {
  const dir = playlistApp(app);
  return (
    asElement(dir?.element) ||
    asElement(html) ||
    document.querySelector("#playlists, .tab.playlists, [data-tab='playlists']")
  );
}

function buttonLabel() {
  return game.i18n?.localize?.("AGENTICDJ.Title") || "Agentic DJ";
}

function makeOpenButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "agentic-dj-open";
  button.innerHTML = `<i class="fa-solid fa-headphones"></i> <span>${buttonLabel()}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openDj();
  });
  return button;
}

function mountWrap(parent, button) {
  let wrap = parent.querySelector(":scope > .agentic-dj-open-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "agentic-dj-open-wrap";
    parent.append(wrap);
  }
  wrap.replaceChildren(button);
  return wrap;
}

export function injectPlaylistButton(app, html) {
  return safe("controls.playlist.inject", () => {
    if (game.user && !game.user.isGM) return false;
    const root = playlistRoot(app, html);
    if (!root) {
      logWarn("controls.playlist.missingRoot");
      return false;
    }
    if (root.querySelector(".agentic-dj-open-wrap .agentic-dj-open")) {
      const existing = root.querySelector(".agentic-dj-open");
      if (existing) existing.querySelector("span")?.replaceChildren(buttonLabel());
      return true;
    }
    const button = makeOpenButton();
    const header = root.querySelector("[data-application-part='header'], .directory-header");
    const controls = root.querySelector("[data-application-part='controls']");
    if (header) mountWrap(header, button);
    else if (controls) mountWrap(controls, button);
    else {
      const wrap = document.createElement("div");
      wrap.className = "agentic-dj-open-wrap";
      wrap.append(button);
      root.prepend(wrap);
    }
    if (!injectedOnce) {
      injectedOnce = true;
      logInfo("controls.playlist.injected", {
        header: Boolean(header),
        controls: Boolean(controls)
      });
    }
    return true;
  });
}

function isPlaylistDirectory(app) {
  if (app === "playlists") return true;
  const id = app?.id || app?.tabName || app?.options?.id;
  return id === "playlists" || app?.constructor?.name === "PlaylistDirectory";
}

function addSceneTool(controls) {
  if (!game.user?.isGM) return;
  const tool = {
    name: MODULE_ID,
    title: game.i18n.localize("AGENTICDJ.ControlTitle"),
    icon: "fa-solid fa-headphones",
    button: true,
    visible: true,
    onChange: () => openDj(),
    onClick: () => openDj()
  };
  if (Array.isArray(controls)) {
    const token = controls.find(c => c.name === "token" || c.name === "tokens") ?? controls[0];
    if (!token) return;
    if (Array.isArray(token.tools)) {
      if (!token.tools.some(entry => entry.name === MODULE_ID)) token.tools.push(tool);
    } else if (token.tools && typeof token.tools === "object") {
      token.tools[MODULE_ID] ??= tool;
    }
    return;
  }
  const group = controls?.tokens ?? controls?.token ?? controls?.controls?.tokens ?? controls?.controls?.token;
  if (!group) return;
  if (Array.isArray(group.tools)) {
    if (!group.tools.some(entry => entry.name === MODULE_ID)) group.tools.push(tool);
  } else if (group.tools && typeof group.tools === "object") {
    group.tools[MODULE_ID] ??= tool;
  }
}

export function registerControlHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;
  Hooks.on("renderPlaylistDirectory", (app, html) => injectPlaylistButton(app, html));
  Hooks.on("renderApplicationV2", (app, html) => {
    if (isPlaylistDirectory(app)) injectPlaylistButton(app, html);
  });
  Hooks.on("renderSidebarTab", (app, html) => {
    if (isPlaylistDirectory(app)) injectPlaylistButton(app, html);
  });
  Hooks.on("changeSidebarTab", app => {
    if (isPlaylistDirectory(app)) injectPlaylistButton(typeof app === "string" ? ui?.playlists : app);
  });
  Hooks.on("getSceneControlButtons", controls => safe("controls.scene", () => addSceneTool(controls)));
}

export function bindControls(next) {
  orchestrator = next;
  injectPlaylistButton(ui.playlists);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => injectPlaylistButton(ui.playlists));
  }
  setTimeout(() => injectPlaylistButton(ui.playlists), 250);
}

/** @deprecated use registerControlHooks + bindControls */
export function attachControls(next) {
  registerControlHooks();
  bindControls(next);
}
