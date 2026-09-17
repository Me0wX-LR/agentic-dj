import { foundryContext } from "../tools/foundry-state.js";
import { inferWantedMood } from "../rag/retrieve.js";
import { SpeechListener } from "../tools/stt.js";

export class Listener {
  constructor(onChange) {
    this.onChange = onChange;
    this.transcript = [];
    this.speech = new SpeechListener((text, source) => this.#ingest(text, source));
    this.listening = false;
    this.hooks = [];
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
    await this.speech.start();
    this.listening = this.speech.active;
    this.emit("mic-start");
  }

  stopMic() {
    this.speech.stop();
    this.listening = false;
    this.emit("mic-stop");
  }

  brief() {
    const ctx = foundryContext();
    const transcript = this.transcript.slice(-6).map(row => row.text).join(" ");
    return {
      ...ctx,
      transcript,
      mood: inferWantedMood({ ...ctx, transcript }),
      intensity: ctx.inCombat ? 5 : 3,
      updatedAt: Date.now()
    };
  }

  #ingest(text, source) {
    const clean = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return;
    this.transcript.push({ text: clean, source, at: Date.now() });
    this.transcript = this.transcript.slice(-40);
    this.emit(source);
  }

  emit(reason) {
    this.onChange?.(this.brief(), reason);
  }
}
