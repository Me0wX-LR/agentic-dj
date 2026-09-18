import { MODULE_ID } from "../constants.js";
import { logError, logInfo, logWarn } from "../debug/log.js";
import { AgenticDjApp } from "./dj-app.js";

let orchestrator = null;
let hooksRegistered = false;
let injectedOnce = false;
let observer = null;

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

function placeWrap(root, wrap) {
  const header = root.querySelector(":scope > [data-application-part='header'], :scope > .directory-header, [data-application-part='header'], .directory-header");
  const controls = root.querySelector(":scope > [data-application-part='controls'], [data-application-part='controls']");
  if (header?.parentElement) header.after(wrap);
  else if (controls) controls.prepend(wrap);
  else root.prepend(wrap);
}

export function injectPlaylistButton(app, html) {
  return safe("controls.playlist.inject", () => {
    if (game.user && !game.user.isGM) return false;
    const root = playlistRoot(app, html);
    if (!root) {
      logWarn("controls.playlist.missingRoot");
      return false;
    }
    for (const stray of [...root.querySelectorAll(".agentic-dj-open-wrap")]) {
      const parent = stray.parentElement;
      const clipped = parent?.matches?.("[data-application-part='header'], .directory-header");
      if (clipped) stray.remove();
    }
    let wrap = [...root.querySelectorAll(".agentic-dj-open-wrap")].find(node => {
      const part = node.parentElement?.getAttribute?.("data-application-part");
      return part !== "header";
    });
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "agentic-dj-open-wrap";
      wrap.append(makeOpenButton());
      placeWrap(root, wrap);
    } else if (!wrap.querySelector(".agentic-dj-open")) {
      wrap.replaceChildren(makeOpenButton());
    } else {
      wrap.querySelector(".agentic-dj-open span")?.replaceChildren(buttonLabel());
    }
    watchPlaylist(root);
    if (!injectedOnce) {
      injectedOnce = true;
      logInfo("controls.playlist.injected", {
        parent: wrap.parentElement?.getAttribute?.("data-application-part") || wrap.parentElement?.className || wrap.parentElement?.tagName
      });
    }
    return true;
  });
}

function watchPlaylist(root) {
  if (observer || typeof MutationObserver !== "function") return;
  observer = new MutationObserver(() => {
    if (!root.isConnected) return;
    if (!root.querySelector(".agentic-dj-open-wrap .agentic-dj-open")) injectPlaylistButton();
  });
  observer.observe(root, { childList: true, subtree: true });
}

function injectSettingsButton(app, html) {
  safe("controls.settings.inject", () => {
    if (game.user && !game.user.isGM) return;
    const root = asElement(app?.element) || asElement(html);
    if (!root || root.querySelector(".agentic-dj-open")) return;
    const mount = root.querySelector("#settings-game, .settings-sidebar, [data-application-part='main'], [data-application-part='body']") || root;
    const wrap = document.createElement("div");
    wrap.className = "agentic-dj-open-wrap";
    wrap.append(makeOpenButton());
    mount.prepend(wrap);
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
  Hooks.on("renderSettings", (app, html) => injectSettingsButton(app, html));
  Hooks.on("getSceneControlButtons", controls => safe("controls.scene", () => addSceneTool(controls)));
}

export function bindControls(next) {
  orchestrator = next;
  injectPlaylistButton(ui.playlists);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => injectPlaylistButton(ui.playlists));
  }
  setTimeout(() => injectPlaylistButton(ui.playlists), 250);
  setTimeout(() => injectPlaylistButton(ui.playlists), 1000);
}

/** @deprecated use registerControlHooks + bindControls */
export function attachControls(next) {
  registerControlHooks();
  bindControls(next);
}
