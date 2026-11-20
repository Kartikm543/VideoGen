// Local beat-grid detection for soundtrack-aware editing.
//
// We deliberately avoid a heavy audio library. FFmpeg writes 50 ms RMS frames;
// positive changes in loudness form an onset envelope. Autocorrelation finds a
// repeating period, and the strongest phase across that period becomes beat 1.
// The result is a list of beat/downbeat times used by the planner to place cuts.

import { run } from "./tools.mjs";

const FPS = 20;
const FRAME_SAMPLES = 2205; // 44100 Hz / 20 fps
const MIN_BPM = 70;
const MAX_BPM = 180;

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function emptyGrid(fps = FPS) {
  return { bpm: 0, period: 0, phase: 0, beats: [], resolution: fps, method: "none" };
}

export function parseRmsFrames(stderr = "") {
  return [...stderr.matchAll(/pts_time:([\d.]+)[\s\S]*?lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|-inf|inf)/g)]
    .map((match) => {
      const raw = match[2];
      // FFmpeg prints -inf for silent frames. Keep them as a low finite value so
      // the next audible frame produces a clean onset step.
      const level = raw === "-inf" ? -100 : raw === "inf" ? 100 : Number(raw);
      return { time: Number(match[1]), level };
    })
    .filter((frame) => Number.isFinite(frame.time) && Number.isFinite(frame.level));
}

function onsetEnvelope(frames = []) {
  const raw = frames.map((frame, index) => {
    if (index === 0) return 0;
    return Math.max(0, Number(frame.level) - Number(frames[index - 1].level));
  });
  return raw.map((value, index) => (
    (raw[Math.max(0, index - 1)] + value + raw[Math.min(raw.length - 1, index + 1)]) / 3
  ));
}

function estimatePeriod(envelope = [], fps = FPS) {
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) * fps));
  const maxLag = Math.min(Math.floor(envelope.length / 4), Math.ceil((60 / MIN_BPM) * fps));
  if (maxLag < minLag) return 60 / 120;
  let best = { lag: Math.round((60 / 120) * fps), score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let count = 0;
    for (let index = lag; index < envelope.length; index += 1) {
      sum += envelope[index] * envelope[index - lag];
      count += 1;
    }
    const score = count ? sum / count : 0;
    if (score > best.score) best = { lag, score };
  }
  return best.lag / fps;
}

function estimatePhase(envelope = [], fps = FPS, period = 0.5) {
  const periodFrames = Math.max(1, Math.round(period * fps));
  let best = { offset: 0, score: -Infinity };
  for (let offset = 0; offset < periodFrames; offset += 1) {
    let sum = 0;
    let count = 0;
    for (let index = offset; index < envelope.length; index += periodFrames) {
      sum += envelope[index] || 0;
      count += 1;
    }
    const score = count ? sum / count : 0;
    if (score > best.score) best = { offset, score };
  }
  return best.offset / fps;
}

export function buildBeatGrid({ frames = [], duration = 0, fps = FPS } = {}) {
  if (frames.length < 8 || !(Number(duration) > 0)) return emptyGrid(fps);
  const envelope = onsetEnvelope(frames);
  const peak = Math.max(...envelope);
  if (!Number.isFinite(peak) || peak <= 0.0005) return emptyGrid(fps);

  const period = estimatePeriod(envelope, fps);
  const phase = estimatePhase(envelope, fps, period);
  const beats = [];
  for (let time = phase, index = 0; time <= duration + 0.001 && beats.length < 2000; time += period, index += 1) {
    const frameIndex = Math.min(envelope.length - 1, Math.max(0, Math.round(time * fps)));
    const strength = (envelope[frameIndex] || 0) / peak;
    beats.push({
      index,
      time: round(time),
      downbeat: index % 4 === 0,
      strength: round(Math.min(1, Math.max(0, strength)), 2)
    });
  }
  if (beats.length < 4) return emptyGrid(fps);
  return {
    bpm: round(60 / period, 1),
    period: round(period),
    phase: round(phase),
    beats,
    resolution: fps,
    method: "onset-autocorrelation"
  };
}

export async function analyzeMusicBeats(filePath, { duration = 0, signal } = {}) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-i", filePath, "-vn",
    "-af", `aresample=${FPS * FRAME_SAMPLES},asetnsamples=n=${FRAME_SAMPLES},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    "-f", "null", "-"
  ], { signal });
  const frames = parseRmsFrames(stderr);
  const lastFrame = frames[frames.length - 1]?.time || 0;
  return buildBeatGrid({ frames, duration: Number(duration) > 0 ? duration : lastFrame, fps: FPS });
}
