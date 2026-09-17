import { MODULE_ID } from "../constants.js";
import { sttConfig } from "../settings.js";

export class SpeechListener {
  constructor(onText) {
    this.onText = onText;
    this.active = false;
    this.media = null;
    this.recorder = null;
    this.recognition = null;
    this.timer = null;
  }

  async start() {
    if (this.active) return;
    const cfg = sttConfig();
    this.active = true;
    if (cfg.provider === "webspeech") {
      this.#startWebSpeech();
      return;
    }
    await this.#startChunks(cfg);
  }

  stop() {
    this.active = false;
    this.recognition?.stop?.();
    this.recognition = null;
    try {
      this.recorder?.stop();
    } catch {
      // already stopped
    }
    this.recorder = null;
    this.media?.getTracks()?.forEach(track => track.stop());
    this.media = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  #startWebSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      ui.notifications.warn("Web Speech API is not available in this browser. Switch STT provider in Agentic DJ settings.");
      this.active = false;
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = game.i18n.lang || "en-US";
    recognition.onresult = event => {
      const last = event.results[event.results.length - 1];
      const text = last?.[0]?.transcript?.trim();
      if (text) this.onText(text, "mic");
    };
    recognition.onerror = event => {
      console.warn(`${MODULE_ID} | speech error`, event.error);
      if (event.error === "not-allowed") {
        ui.notifications.error(game.i18n.localize("AGENTICDJ.MicDenied"));
        this.stop();
      }
    };
    recognition.onend = () => {
      if (this.active) recognition.start();
    };
    this.recognition = recognition;
    recognition.start();
  }

  async #startChunks(cfg) {
    try {
      this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      ui.notifications.error(game.i18n.localize("AGENTICDJ.MicDenied"));
      this.active = false;
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(this.media, { mimeType: mime });
    recorder.ondataavailable = async event => {
      if (!this.active || !event.data?.size) return;
      try {
        const text = await transcribeBlob(event.data, cfg);
        if (text) this.onText(text, "mic");
      } catch (err) {
        console.warn(`${MODULE_ID} | STT failed`, err);
      }
    };
    this.recorder = recorder;
    recorder.start();
    this.timer = setInterval(() => {
      if (this.recorder?.state === "recording") {
        this.recorder.stop();
        this.recorder.start();
      }
    }, 8000);
  }
}

export async function transcribeBlob(blob, cfg = sttConfig()) {
  if (cfg.provider === "deepgram") return transcribeDeepgram(blob, cfg);
  return transcribeWhisper(blob, cfg);
}

async function transcribeWhisper(blob, cfg) {
  if (!cfg.apiKey && cfg.provider !== "ollama") throw new Error("STT API key missing");
  const root = cfg.baseUrl.includes("/v1") ? cfg.baseUrl : `${cfg.baseUrl}/v1`;
  const form = new FormData();
  form.append("file", blob, "chunk.webm");
  form.append("model", cfg.model || "whisper-1");
  const response = await fetch(`${root}/audio/transcriptions`, {
    method: "POST",
    headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    body: form
  });
  if (!response.ok) throw new Error(`STT ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return (data.text || "").trim();
}

async function transcribeDeepgram(blob, cfg) {
  if (!cfg.apiKey) throw new Error("Deepgram API key missing");
  const url = new URL(cfg.baseUrl || "https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", cfg.model || "nova-2");
  url.searchParams.set("smart_format", "true");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${cfg.apiKey}`,
      "Content-Type": blob.type || "audio/webm"
    },
    body: blob
  });
  if (!response.ok) throw new Error(`Deepgram ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
}
