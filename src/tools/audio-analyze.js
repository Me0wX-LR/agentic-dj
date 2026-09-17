/**
 * Local music-information features.
 * Tries Essentia.js from a Worker when present, otherwise a Web Audio DSP fallback
 * that estimates tempo, energy, brightness, and heuristic mood tags.
 */
import { logInfo, logWarn } from "../debug/log.js";
import { modulePath } from "../rag/catalog.js";
import { extractFeatures } from "./audio-features.js";

export { extractFeatures } from "./audio-features.js";

let workerUsable = null;

export async function analyzeSoundFile(path) {
  if (!path) throw new Error("Sound has no file path");
  const url = /^https?:/i.test(path) ? path : foundry.utils.getRoute(path);
  logInfo("audio.fetch", { path, url });
  const response = await fetch(url);
  if (!response.ok) {
    logWarn("audio.fetch.failed", { path, url, status: response.status });
    throw new Error(`Could not fetch audio ${path} (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  logInfo("audio.fetch.ok", { path, bytes: buffer.byteLength });
  return analyzeArrayBuffer(buffer);
}

export async function analyzeArrayBuffer(arrayBuffer) {
  if (workerUsable !== false) {
    const forWorker = arrayBuffer.slice(0);
    try {
      const features = await analyzeInWorker(forWorker);
      workerUsable = true;
      return features;
    } catch (err) {
      workerUsable = false;
      logWarn("audio.worker.fallback", { error: err, skipFurtherWorkers: true });
    }
  }
  const features = await analyzeOnMainThread(arrayBuffer);
  logInfo("audio.mainthread.ok", featureSummary(features));
  return features;
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
      else {
        logInfo("audio.worker.ok", featureSummary(event.data.features));
        resolve(event.data.features);
      }
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

function featureSummary(features = {}) {
  return {
    backend: features.backend,
    duration: features.duration,
    tempo: features.tempo,
    energy: features.energy,
    mood: features.mood,
    intensity: features.intensity,
    tags: features.tags
  };
}
