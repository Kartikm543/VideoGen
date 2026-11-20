// Lightweight visible-region audio waveform for the review trim rail.
//
// We only decode the region the editor can currently see and use FFmpeg's
// existing astats RMS metadata. No waveform image, extra dependency, or
// project metadata rewrite is needed.

import { parseRmsFrames } from "./audio-beats.mjs";
import { run } from "./tools.mjs";

export const WAVEFORM_FPS = 10;
const SAMPLES_PER_FRAME = 4410; // 44100 Hz / 10 fps
const MIN_DB = -70;

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function buildWaveformBins(frames = [], { start = 0, duration = 0, bins = 96 } = {}) {
  const count = Math.max(1, Math.min(240, Math.round(Number(bins) || 96)));
  const span = Math.max(0.01, Number(duration) || 0.01);
  const regionStart = Math.max(0, Number(start) || 0);
  const levels = Array.from({ length: count }, () => -100);

  for (const frame of frames) {
    const relative = Number(frame.time) - regionStart;
    if (!Number.isFinite(relative) || relative < -0.1 || relative > span + 0.1) continue;
    const index = Math.max(0, Math.min(count - 1, Math.floor((relative / span) * count)));
    const level = Number(frame.level);
    levels[index] = Math.max(levels[index], Number.isFinite(level) ? level : -100);
  }

  const normalized = levels.map((level) => round(Math.min(1, Math.max(0, (level - MIN_DB) / -MIN_DB)), 3));
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] > 0) continue;
    let before = 0;
    let after = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (normalized[cursor] > 0) { before = normalized[cursor]; break; }
    }
    for (let cursor = index + 1; cursor < normalized.length; cursor += 1) {
      if (normalized[cursor] > 0) { after = normalized[cursor]; break; }
    }
    normalized[index] = round((before + after) / 2, 3);
  }
  return normalized;
}

export async function analyzeWaveform(filePath, { start = 0, end = 0, bins = 96, signal } = {}) {
  const sourceStart = Math.max(0, Number(start) || 0);
  const sourceEnd = Math.max(sourceStart + 0.1, Number(end) || sourceStart + 30);
  const duration = Math.min(120, sourceEnd - sourceStart);
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-ss", String(round(sourceStart)), "-t", String(round(duration)), "-i", filePath,
    "-vn", "-map", "0:a:0?",
    "-af", `aresample=${WAVEFORM_FPS * SAMPLES_PER_FRAME},asetnsamples=n=${SAMPLES_PER_FRAME},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    "-f", "null", "-"
  ], { signal });
  const frames = parseRmsFrames(stderr);
  return {
    start: round(sourceStart),
    end: round(sourceStart + duration),
    duration: round(duration),
    resolution: WAVEFORM_FPS,
    method: "astats-rms",
    available: frames.length > 0,
    bins: buildWaveformBins(frames, { start: 0, duration, bins })
  };
}
