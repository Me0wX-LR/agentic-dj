/**
 * Local music-information features.
 * Tries Essentia.js from a Worker when present, otherwise a Web Audio DSP fallback
 * that estimates tempo, energy, brightness, and heuristic mood tags.
 */
import { modulePath } from "../rag/catalog.js";
import { extractFeatures } from "./audio-features.js";

export { extractFeatures } from "./audio-features.js";

export async function analyzeSoundFile(path) {
  if (!path) throw new Error("Sound has no file path");
  const url = /^https?:/i.test(path) ? path : foundry.utils.getRoute(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch audio ${path}`);
  const buffer = await response.arrayBuffer();
  return analyzeArrayBuffer(buffer);
}

export async function analyzeArrayBuffer(arrayBuffer) {
  const forWorker = arrayBuffer.slice(0);
  try {
    return await analyzeInWorker(forWorker);
  } catch (err) {
    console.warn("agentic-dj | worker analysis failed, using main-thread fallback", err);
    return analyzeOnMainThread(arrayBuffer);
  }
}

function analyzeInWorker(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(foundry.utils.getRoute(modulePath("src/tools/audio-worker.js")), { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("audio worker timeout"));
    }, 25000);
    worker.onmessage = event => {
      clearTimeout(timer);
      worker.terminate();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data.features);
    };
    worker.onerror = event => {
      clearTimeout(timer);
      worker.terminate();
      reject(event.error ?? new Error(event.message));
    };
    worker.postMessage({ arrayBuffer });
  });
}

async function analyzeOnMainThread(arrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audio = await ctx.decodeAudioData(arrayBuffer.slice(0));
  return extractFeatures(audio);
}
