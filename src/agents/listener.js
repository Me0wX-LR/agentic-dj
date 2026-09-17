import { foundryContext } from "../tools/foundry-state.js";
import { inferWantedIntensity, inferWantedMood } from "../rag/retrieve.js";
import { SpeechListener } from "../tools/stt.js";
import {
  MIC_STOP_GRACE_MS,
  dropSources,
  mergeUtterance,
  newestEntry,
  pruneTranscript,
  transcriptText
} from "../memory/transcript.js";

export class Listener {
  constructor(onChange) {
    this.onChange = onChange;
    this.transcript = [];
    this.speech = new SpeechListener((text, source) => this.#ingest(text, source));
    this.listening = false;
    this.hooks = [];
    this.lapseTimer = null;
  }

  startHooks() {
    this.stopHooks();
    const relay = () => this.emit("foundry");
    const ids = [
      ["combatStart", relay],
      ["combatEnd", relay],
      ["updateCombat", relay],
      ["canvasReady", relay],
      ["createChatMessage", (msg) => {
        if (msg.isRoll) this.#ingest(msg.flavor || "dice roll", "chat");
        else this.#ingest(msg.content, "chat");
      }]
    ];
    for (const [hook, fn] of ids) {
      Hooks.on(hook, fn);
      this.hooks.push([hook, fn]);
    }
  }

  stopHooks() {
    for (const [hook, fn] of this.hooks) Hooks.off(hook, fn);
    this.hooks = [];
  }

  async startMic() {
    clearTimeout(this.lapseTimer);
    await this.speech.start();
    this.listening = this.speech.active;
    this.emit("mic-start");
  }

  stopMic() {
    this.speech.stop();
    this.listening = false;
    this.emit("mic-stop");
    this.#scheduleLapse();
  }

  clearTranscript({ sources = null } = {}) {
    clearTimeout(this.lapseTimer);
    this.transcript = sources ? dropSources(this.transcript, sources) : [];
    this.emit("transcript-clear");
  }

  brief() {
    this.transcript = pruneTranscript(this.transcript);
    const ctx = foundryContext();
    const transcript = transcriptText(this.transcript);
    const newest = newestEntry(this.transcript);
    return {
      ...ctx,
      transcript,
      mood: inferWantedMood({ ...ctx, transcript }),
      intensity: inferWantedIntensity({ ...ctx, transcript }),
      transcriptAt: newest?.at ?? null,
      transcriptAgeMs: newest ? Date.now() - newest.at : null,
      updatedAt: Date.now()
    };
  }

  #ingest(text, source) {
    const clean = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return;
    this.transcript = mergeUtterance(this.transcript, clean, source);
    this.emit(source);
  }

  #scheduleLapse() {
    clearTimeout(this.lapseTimer);
    this.lapseTimer = setTimeout(() => {
      if (this.listening) return;
      const before = this.transcript.length;
      this.transcript = dropSources(this.transcript, ["mic"]);
      if (this.transcript.length !== before) this.emit("mic-lapse");
    }, MIC_STOP_GRACE_MS);
  }

  emit(reason) {
    this.onChange?.(this.brief(), reason);
  }
}
