/**
 * Local MIR feature extraction. Safe to import from a Worker (no Foundry globals).
 */

export function extractFeatures(audioBuffer) {
  const channel = mixMono(audioBuffer);
  const sampleRate = audioBuffer.sampleRate;
  const maxSamples = Math.min(channel.length, Math.floor(sampleRate * 45));
  const slice = channel.subarray(0, maxSamples);
  const windowSize = 1024;
  const hop = 2048;
  const rmsWindows = [];
  const centroids = [];
  const flux = [];
  let prevSpectrum = null;
  let zcrCount = 0;

  for (let i = 0; i + windowSize < slice.length; i += hop) {
    const frame = slice.subarray(i, i + windowSize);
    const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
    rmsWindows.push(rms);
    const spectrum = dftMags(frame);
    centroids.push(spectralCentroid(spectrum, sampleRate, windowSize));
    if (prevSpectrum) flux.push(spectralFlux(prevSpectrum, spectrum));
    prevSpectrum = spectrum;
    zcrCount += zeroCrossings(frame);
  }

  const energy = average(rmsWindows);
  const dynamics = stdev(rmsWindows);
  const centroid = average(centroids);
  const zcr = zcrCount / Math.max(1, slice.length);
  const tempo = estimateTempo(flux, sampleRate, hop);
  const brightness = centroid / (sampleRate / 2);
  const heuristic = heuristicTags({ energy, tempo, brightness, dynamics });
  return {
    backend: "webaudio",
    duration: audioBuffer.duration,
    sampleRate,
    tempo,
    energy: round(energy),
    dynamics: round(dynamics),
    centroid: Math.round(centroid),
    brightness: round(brightness),
    zcr: round(zcr),
    ...heuristic
  };
}

export function intensityFromEnergy(energy) {
  const value = Number(energy);
  if (!Number.isFinite(value)) return 3;
  if (value >= 0.16) return 5;
  if (value >= 0.12) return 4;
  if (value >= 0.08) return 3;
  if (value >= 0.04) return 2;
  return 1;
}

export function heuristicTags({ energy, tempo, brightness, dynamics }) {
  const intensity = intensityFromEnergy(energy);
  // Mastered OST RMS is often 0.03–0.18. Quiet + dark is not horror.
  if (energy >= 0.16 && tempo >= 125) {
    return { mood: "combat", intensity: Math.max(4, intensity), tags: ["battle", "aggressive"] };
  }
  if (energy >= 0.13 && tempo >= 110) {
    return { mood: "epic", intensity: Math.max(3, intensity), tags: ["heroic", "action"] };
  }
  if (energy < 0.035 && brightness < 0.2) {
    return { mood: "ambient", intensity: 1, tags: ["drone", "calm"] };
  }
  if (tempo < 85 && energy < 0.08) {
    return { mood: "sad", intensity: 2, tags: ["slow", "melancholy"] };
  }
  if (dynamics > 0.08 && energy > 0.1) {
    return { mood: "tension", intensity: 3, tags: ["uneasy", "pulse"] };
  }
  return { mood: "exploration", intensity, tags: ["underscore"] };
}

function mixMono(audioBuffer) {
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  const channels = audioBuffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }
  return mono;
}

function dftMags(frame) {
  const n = 256;
  const mags = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      re += frame[t] * Math.cos(angle);
      im -= frame[t] * Math.sin(angle);
    }
    mags[k] = Math.hypot(re, im);
  }
  return mags;
}

function spectralCentroid(mags, sampleRate, windowSize) {
  let num = 0;
  let den = 0;
  for (let k = 0; k < mags.length; k++) {
    const freq = (k * sampleRate) / windowSize;
    num += freq * mags[k];
    den += mags[k];
  }
  return den ? num / den : 0;
}

function spectralFlux(prev, next) {
  let sum = 0;
  const n = Math.min(prev.length, next.length);
  for (let i = 0; i < n; i++) sum += Math.max(0, next[i] - prev[i]);
  return sum;
}

function estimateTempo(flux, sampleRate, hop) {
  if (flux.length < 16) return 100;
  const fps = sampleRate / hop;
  const minLag = Math.round((60 / 180) * fps);
  const maxLag = Math.round((60 / 70) * fps);
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < flux.length - lag; i++) corr += flux[i] * flux[i + lag];
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  const bpm = Math.round((60 * fps) / bestLag);
  return Math.max(70, Math.min(180, bpm));
}

function zeroCrossings(frame) {
  let count = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i - 1] >= 0 && frame[i] < 0) || (frame[i - 1] < 0 && frame[i] >= 0)) count++;
  }
  return count;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const v = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
