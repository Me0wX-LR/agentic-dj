import { MODULE_ID } from "../constants.js";

export const LOG_LIMIT = 400;
export const LOG_FILE = "debug.log";

const entries = [];
let persistTimer = null;
let persisting = false;

const SECRET_KEYS = /^(apiKey|llmApiKey|sttApiKey|authorization|password|token|secret)$/i;
const SECRET_PATTERN = /(sk-[A-Za-z0-9]{8,}|Bearer\s+\S+)/gi;

export function redact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return value.replace(SECRET_PATTERN, match => maskSecret(match));
  if (typeof value !== "object" || depth > 6) return value;
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: String(value.stack || "").split("\n").slice(0, 6).join("\n") };
  }
  if (Array.isArray(value)) return value.slice(0, 40).map(item => redact(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.test(key)) out[key] = maskSecret(String(item ?? ""));
    else out[key] = redact(item, depth + 1);
  }
  return out;
}

export function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "••••";
  return `••••${text.slice(-4)}`;
}

export function log(level, event, data) {
  const safe = redact(data);
  const entry = {
    t: Date.now(),
    iso: new Date().toISOString(),
    level,
    event,
    data: safe === undefined ? undefined : safe
  };
  entries.push(entry);
  if (entries.length > LOG_LIMIT) entries.shift();
  const line = formatLine(entry);
  if (level === "error") console.error(line, entry.data ?? "");
  else if (level === "warn") console.warn(line, entry.data ?? "");
  else console.log(line, entry.data ?? "");
  schedulePersist();
  return entry;
}

export function logInfo(event, data) {
  return log("info", event, data);
}

export function logWarn(event, data) {
  return log("warn", event, data);
}

export function logError(event, data) {
  return log("error", event, data);
}

export function getLogEntries() {
  return entries.slice();
}

export function formatLogDump() {
  const header = [
    `agentic-dj engineer log`,
    `written ${new Date().toISOString()}`,
    `entries ${entries.length}`,
    ""
  ];
  return [...header, ...entries.map(formatLine)].join("\n");
}

export async function copyLogDump() {
  const text = formatLogDump();
  if (game?.clipboard?.copyPlainText) {
    await game.clipboard.copyPlainText(text);
    return text;
  }
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return text;
  }
  throw new Error("Clipboard is not available");
}

export function logDir() {
  return `worlds/${game.world.id}/agentic-dj`;
}

export function logPath() {
  return `${logDir()}/${LOG_FILE}`;
}

export async function persistLogs() {
  if (persisting || typeof game === "undefined" || !game.world?.id) return;
  persisting = true;
  try {
    const dir = logDir();
    const picker = filePickerClass();
    try {
      await picker.createDirectory("data", dir, { notify: false });
    } catch {
      // directory already exists
    }
    const file = new File([formatLogDump()], LOG_FILE, { type: "text/plain" });
    await picker.upload("data", dir, file, {}, { notify: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | debug.log write failed`, err);
  } finally {
    persisting = false;
  }
}

export async function openLogFile() {
  await persistLogs();
  const picker = filePickerClass();
  const app = new picker({
    type: "text",
    current: logDir(),
    callback: () => null
  });
  app.render({ force: true });
}

function formatLine(entry) {
  const payload = entry.data === undefined ? "" : ` ${safeJson(entry.data)}`;
  return `[${MODULE_ID}] ${entry.iso} ${entry.level.toUpperCase()} ${entry.event}${payload}`;
}

function safeJson(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  } catch {
    return String(value);
  }
}

function schedulePersist() {
  if (typeof game === "undefined") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistLogs().catch(() => null);
  }, 800);
}

function filePickerClass() {
  return foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}
