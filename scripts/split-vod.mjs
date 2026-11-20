// Split one long recording into short, upload-friendly clips.
//
// This is the bridge for the "one long VOD" workflow: VODs are too long for the
// planner (it only samples a handful of windows per file), so we cut them into
// 60-120s parts first, then feed the folder to HighlightAI like any other set
// of clips.
//
// Cuts prefer scene changes, then loud audio peaks, and every part overlaps its
// neighbours by a couple of seconds so no highlight is lost on a boundary.
// Encoding is stream copy, so splitting a 2 hour VOD takes seconds.
//
// Usage:
//   node scripts/split-vod.mjs <video.mp4> [--out <dir>] [--min 60] [--max 120]
//                               [--overlap 2] [--scene 0.3] [--max-clips 90]
//                               [--dry-run]

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "../server/tools.mjs";

const DEFAULT_MIN = 60;
const DEFAULT_MAX = 120;
const DEFAULT_OVERLAP = 2;
const DEFAULT_SCENE = 0.3;
const LOOKAHEAD = 25;

export function parseArgs(argv) {
  const args = {
    file: "",
    out: "",
    min: DEFAULT_MIN,
    max: DEFAULT_MAX,
    overlap: DEFAULT_OVERLAP,
    scene: DEFAULT_SCENE,
    maxClips: 90,
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out") args.out = argv[++index] || "";
    else if (token === "--min") args.min = Number(argv[++index]) || DEFAULT_MIN;
    else if (token === "--max") args.max = Number(argv[++index]) || DEFAULT_MAX;
    else if (token === "--overlap") args.overlap = Number(argv[++index]);
    else if (token === "--scene") args.scene = Number(argv[++index]);
    else if (token === "--max-clips") args.maxClips = Number(argv[++index]) || 90;
    else if (token === "--dry-run") args.dryRun = true;
    else if (!token.startsWith("--") && !args.file) args.file = token;
  }
  args.min = Math.max(10, args.min);
  args.max = Math.max(args.min, args.max);
  args.overlap = Math.max(0, Math.min(10, Number.isFinite(args.overlap) ? args.overlap : DEFAULT_OVERLAP));
  args.scene = Number.isFinite(args.scene) ? Math.max(0.05, Math.min(0.9, args.scene)) : DEFAULT_SCENE;
  return args;
}

export async function probeDuration(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name",
    "-print_format", "json",
    filePath
  ]);
  const payload = JSON.parse(stdout);
  return {
    duration: Number(payload.format?.duration) || 0,
    hasAudio: (payload.streams || []).some((stream) => stream.codec_type === "audio")
  };
}

export async function findSceneCuts(filePath, threshold = DEFAULT_SCENE) {
  try {
    const { stderr } = await run("ffmpeg", [
      "-hide_banner", "-nostats",
      "-i", filePath,
      "-an",
      "-vf", `select='gt(scene,${threshold})',showinfo`,
      "-f", "null", "-"
    ]);
    const times = [];
    const pattern = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
    let match;
    while ((match = pattern.exec(stderr)) !== null) {
      const time = Number(match[1]);
      if (Number.isFinite(time)) times.push(time);
    }
    return times.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function findKeyframes(filePath) {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "packet=pts_time,flags",
      "-of", "csv=p=0",
      filePath
    ]);
    const times = [];
    for (const line of stdout.split(/\r?\n/)) {
      const [pts, flags = ""] = line.split(",");
      if (!flags.includes("K")) continue;
      const time = Number(pts);
      if (Number.isFinite(time)) times.push(time);
    }
    return times.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function keyframeWindow(keyframes = []) {
  if (keyframes.length < 2) return 6;
  const gaps = [];
  for (let index = 1; index < keyframes.length; index += 1) {
    const gap = keyframes[index] - keyframes[index - 1];
    if (gap > 0.01) gaps.push(gap);
  }
  if (!gaps.length) return 6;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(3, Math.min(15, median * 1.25));
}

export function snapToKeyframe(time, keyframes = [], window = keyframeWindow(keyframes)) {
  if (!keyframes.length) return { time, snapped: false };
  let best = null;
  for (const keyframe of keyframes) {
    const distance = Math.abs(keyframe - time);
    if (distance <= window && (!best || distance < Math.abs(best - time))) best = keyframe;
  }
  return best === null ? { time, snapped: false } : { time: Math.round(best * 10) / 10, snapped: true };
}

export async function findAudioPeaks(filePath, hasAudio = true) {
  if (!hasAudio) return [];
  try {
    const { stdout } = await run("ffmpeg", [
      "-hide_banner", "-nostats", "-loglevel", "error",
      "-i", filePath,
      "-map", "0:a:0",
      "-af", "aresample=48000,asetnsamples=n=48000,astats=metadata=1:reset=1,ametadata=mode=print:file=-",
      "-f", "null", "-"
    ]);
    const samples = [];
    let currentTime = 0;
    for (const line of stdout.split(/\r?\n/)) {
      const timeMatch = /pts_time:([0-9]+(?:\.[0-9]+)?)/.exec(line);
      if (timeMatch) currentTime = Number(timeMatch[1]);
      const rmsMatch = /lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+|-inf)/.exec(line);
      if (rmsMatch) {
        const value = rmsMatch[1] === "-inf" ? -120 : Number(rmsMatch[1]);
        if (Number.isFinite(value)) samples.push({ time: currentTime, value });
      }
    }
    if (samples.length < 4) return [];
    const values = samples.map((sample) => sample.value).sort((a, b) => a - b);
    const threshold = values[Math.floor(values.length * 0.88)];
    const peaks = [];
    let bucket = [];
    const flush = () => {
      if (!bucket.length) return;
      const loudest = bucket.reduce((best, item) => (item.value > best.value ? item : best), bucket[0]);
      peaks.push(loudest.time);
      bucket = [];
    };
    for (const sample of samples) {
      if (sample.value >= threshold && sample.value > -50) {
        if (bucket.length && sample.time - bucket[bucket.length - 1].time > 2) flush();
        bucket.push(sample);
      } else {
        flush();
      }
    }
    flush();
    return peaks.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function chooseCutPoint(target, { scenes = [], peaks = [], min = 0, max = Infinity } = {}) {
  const candidates = [];
  for (const time of scenes) {
    if (time >= min && time <= max && Math.abs(time - target) <= LOOKAHEAD) {
      candidates.push({ time, score: -Math.abs(time - target) + 12 });
    }
  }
  for (const time of peaks) {
    if (time >= min && time <= max && Math.abs(time - target) <= LOOKAHEAD) {
      candidates.push({ time, score: -Math.abs(time - target) + 4 });
    }
  }
  if (!candidates.length) return { time: target, reason: "target" };
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    time: Math.round(best.time * 10) / 10,
    reason: scenes.includes(best.time) ? "scene" : "audio-peak"
  };
}

export function planClips({ duration, scenes = [], peaks = [], keyframes = [], min = DEFAULT_MIN, max = DEFAULT_MAX, overlap = DEFAULT_OVERLAP, maxClips = 90 }) {
  if (!(duration > 0)) return [];
  const nominal = Math.min(max, Math.max(min, Math.round((min + max) / 2)));
  const window = keyframeWindow(keyframes);
  const boundaries = [{ time: 0, reason: "start" }];
  let start = 0;
  while (duration - start > max && boundaries.length <= maxClips) {
    const target = start + nominal;
    const { time, reason } = chooseCutPoint(target, {
      scenes,
      peaks,
      min: start + min,
      max: Math.min(duration, start + max)
    });
    const snapped = snapToKeyframe(time, keyframes, window);
    // A cut may only land inside the current min/max window.
    const accepted = snapped.snapped && snapped.time >= start + min && snapped.time <= Math.min(duration, start + max)
      ? snapped
      : { time, snapped: false };
    const boundary = Math.max(start + min, Math.min(duration, accepted.time));
    if (duration - boundary < 0.5) break;
    boundaries.push({ time: Math.round(boundary * 10) / 10, reason: accepted.snapped ? `${reason}+keyframe` : reason });
    start = boundary;
  }
  boundaries.push({ time: Math.round(duration * 10) / 10, reason: "end" });

  return boundaries.slice(0, -1).map((boundary, index) => {
    const next = boundaries[index + 1];
    const clipStart = boundary.time;
    const clipEnd = Math.min(duration, Math.round((next.time + overlap) * 10) / 10);
    return {
      index: index + 1,
      start: clipStart,
      end: clipEnd,
      duration: Math.round((clipEnd - clipStart) * 10) / 10,
      cutReason: next.reason
    };
  });
}

async function splitClip(filePath, outputPath, clip) {
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(clip.start),
    "-i", filePath,
    "-t", String(Math.max(0.1, clip.end - clip.start)),
    "-map", "0",
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    "-movflags", "+faststart",
    outputPath
  ]);
  const { duration } = await probeDuration(outputPath);
  return duration;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Usage: node scripts/split-vod.mjs <video.mp4> [--out <dir>] [--min 60] [--max 120] [--overlap 2] [--scene 0.3] [--max-clips 90] [--dry-run]");
    process.exit(2);
  }
  const filePath = path.resolve(args.file);
  const base = path.basename(filePath, path.extname(filePath));
  const outputDir = path.resolve(args.out || path.join(path.dirname(filePath), `${base}-split`));

  console.log(`Scanning ${path.basename(filePath)} ...`);
  const { duration, hasAudio } = await probeDuration(filePath);
  if (!(duration > 0)) throw new Error("Could not read the video duration.");
  const scenes = await findSceneCuts(filePath, args.scene);
  const peaks = await findAudioPeaks(filePath, hasAudio);
  const keyframes = await findKeyframes(filePath);
  console.log(`Found ${scenes.length} scene cuts, ${peaks.length} audio peaks, and ${keyframes.length} keyframes across ${duration.toFixed(1)}s.`);

  const clips = planClips({
    duration,
    scenes,
    peaks,
    keyframes,
    min: args.min,
    max: args.max,
    overlap: args.overlap,
    maxClips: args.maxClips
  });

  if (clips.length && clips.at(-1).end < duration - 0.5) {    console.warn(`Warning: stopped at --max-clips ${args.maxClips}; ${(duration - clips.at(-1).end).toFixed(1)}s at the end was not split.`);
  }

  if (args.dryRun) {
    for (const clip of clips) {
      console.log(`part ${String(clip.index).padStart(2, "0")}: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s (${clip.duration.toFixed(1)}s, ${clip.cutReason})`);
    }
    return;
  }

  await mkdir(outputDir, { recursive: true });
  const outputs = [];
  for (const clip of clips) {
    const name = `${base}-part-${String(clip.index).padStart(2, "0")}.mp4`;
    const outputPath = path.join(outputDir, name);
    const actualDuration = await splitClip(filePath, outputPath, clip);
    outputs.push({ ...clip, actualDuration: Math.round(actualDuration * 10) / 10, file: outputPath, name });
    console.log(`Wrote ${name} (${clip.duration.toFixed(1)}s planned, ${actualDuration.toFixed(1)}s actual, ${clip.cutReason})`);
    if (actualDuration > args.max + 1.5) {
      console.warn(`  warning: ${name} is longer than --max because the source has sparse keyframes.`);
    }
  }

  const manifest = {
    source: filePath,
    generatedAt: new Date().toISOString(),
    settings: {
      min: args.min,
      max: args.max,
      overlap: args.overlap,
      sceneThreshold: args.scene,
      sceneCuts: scenes.length,
      audioPeaks: peaks.length,
      keyframes: keyframes.length
    },
    duration: Math.round(duration * 10) / 10,
    clips: outputs
  };
  const manifestPath = path.join(outputDir, "split-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`\nSplit ${path.basename(filePath)} into ${outputs.length} clips in ${outputDir}`);
  console.log(`Manifest: ${manifestPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
