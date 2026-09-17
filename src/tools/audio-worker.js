import { extractFeatures } from "./audio-features.js";

self.onmessage = async event => {
  try {
    const { arrayBuffer } = event.data;
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(arrayBuffer);
    let features = extractFeatures(audio);
    try {
      const mod = await import("./essentia-bridge.js");
      const extra = await mod.analyzeWithEssentia(audio);
      if (extra) features = { ...features, ...extra, backend: "essentia+webaudio" };
    } catch {
      // keep webaudio features
    }
    self.postMessage({ features });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
