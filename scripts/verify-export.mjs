// Verify that an exported MP4 matches the platform specs HighlightAI targets.
//
// Usage:
//   node scripts/verify-export.mjs <video.mp4> [--preset shorts|reels|long|auto|archive]
//                                   [--fps 30|60] [--no-loudness] [--json]
//
// Exit code is 0 when every check passes, 1 otherwise. The script only reads
// the file; it never writes next to it.

import { open } from "node:fs/promises";
import path from "node:path";
import { run } from "../server/tools.mjs";
import { EXPORT_PRESETS, normalizeExportPresetId, resolveExportPreset } from "../server/export-presets.mjs";

const KNOWN_RESOLUTIONS = new Set(["1080x1920", "1920x1080"]);

function parseArgs(argv) {
  const args = { file: "", preset: "auto", fps: 0, loudness: true, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--preset") args.preset = argv[++index] || "auto";
    else if (token === "--fps") args.fps = Number(argv[++index]) || 0;
    else if (token === "--no-loudness") args.loudness = false;
    else if (token === "--json") args.json = true;
    else if (!token.startsWith("--") && !args.file) args.file = token;
  }
  return args;
}

async function ffprobeJson(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);
  return JSON.parse(stdout);
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value || "0/1").split("/");
  const rate = Number(numerator) / Number(denominator || 1);
  return Number.isFinite(rate) ? rate : 0;
}

async function hasFastStart(filePath) {
  // Faststart means `moov` is written before `mdat`. Read the first 256 KB and
  // compare offsets; sample tables for our short exports always fit there.
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    const moov = head.indexOf(Buffer.from("moov"));
    const mdat = head.indexOf(Buffer.from("mdat"));
    if (moov < 0) return false;
    return mdat < 0 || moov < mdat;
  } finally {
    await handle.close();
  }
}

async function measureLoudness(filePath) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostats",
    "-i", filePath,
    "-map", "0:a:0",
    "-af", "loudnorm=print_format=json",
    "-f", "null", "-"
  ]);
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const payload = JSON.parse(stderr.slice(start, end + 1));
    const integrated = Number(payload.input_i);
    const truePeak = Number(payload.input_tp);
    return Number.isFinite(integrated) ? { integrated, truePeak } : null;
  } catch {
    return null;
  }
}

function check(checks, name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
}

function describe(value) {
  return value === undefined || value === null ? "unknown" : String(value);
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error("Usage: node scripts/verify-export.mjs <video.mp4> [--preset shorts|reels|long|auto|archive] [--fps 30|60] [--no-loudness] [--json]");
  process.exit(2);
}

const filePath = path.resolve(args.file);
const presetId = normalizeExportPresetId(args.preset);
const preset = resolveExportPreset({ preset: presetId, fps: args.fps || EXPORT_PRESETS[presetId].fps });
const expectedFps = args.fps || preset.fps;
const checks = [];

let info;
try {
  info = await ffprobeJson(filePath);
} catch (error) {
  console.error(`Could not probe ${filePath}: ${error.message}`);
  process.exit(2);
}

const video = (info.streams || []).find((stream) => stream.codec_type === "video");
const audio = (info.streams || []).find((stream) => stream.codec_type === "audio");
const format = info.format || {};
const duration = Number(format.duration) || 0;

check(checks, "container is mp4", /mp4|mov/i.test(String(format.format_name || "")), describe(format.format_name));
check(checks, "has a video stream", Boolean(video), video ? `${video.codec_name} ${video.width}x${video.height}` : "missing");
check(checks, "has an audio stream", Boolean(audio), audio ? `${audio.codec_name} ${audio.sample_rate}Hz ${audio.channels}ch` : "missing");
check(checks, "video codec is h264 or hevc", ["h264", "hevc"].includes(video?.codec_name), describe(video?.codec_name));

const expectedCodec = preset.codec;
check(checks, `video codec matches the ${presetId} preset (${expectedCodec})`, video?.codec_name === expectedCodec, describe(video?.codec_name));

const resolution = video ? `${video.width}x${video.height}` : "";
const expectedResolution = `${preset.width}x${preset.height}`;
if (presetId === "auto") {
  check(checks, "resolution is a supported export size", KNOWN_RESOLUTIONS.has(resolution), resolution);
} else {
  check(checks, `resolution is ${expectedResolution}`, resolution === expectedResolution, resolution);
}

const fps = parseRate(video?.r_frame_rate);
check(checks, `frame rate is ${expectedFps}fps`, Math.abs(fps - expectedFps) < 0.5, `${fps.toFixed(2)}fps`);

check(checks, "pixel format is yuv420p", video?.pix_fmt === "yuv420p", describe(video?.pix_fmt));

if (video?.codec_name === "h264") {
  check(checks, "h264 profile is High", String(video.profile || "").toLowerCase().startsWith("high"), describe(video.profile));
  const level = Number(video.level);
  check(checks, "h264 level is within 4.2", !Number.isFinite(level) || level <= 42, describe(video.level));
} else if (video?.codec_name === "hevc") {
  check(checks, "hevc profile is Main", /main/i.test(String(video.profile || "")), describe(video.profile));
}

check(checks, "audio codec is aac", audio?.codec_name === "aac", describe(audio?.codec_name));
check(checks, "audio sample rate is 48 kHz", Number(audio?.sample_rate) === 48000, describe(audio?.sample_rate));
check(checks, "audio is stereo", Number(audio?.channels) === 2, describe(audio?.channels));

check(checks, "faststart is enabled (moov before mdat)", await hasFastStart(filePath), "moov placement");

const cap = Math.min(180, Number(preset.maxDuration) || 180);
check(checks, `duration is within the ${cap}s cap`, duration > 0 && duration <= cap + 0.25, `${duration.toFixed(2)}s`);

if (args.loudness) {
  try {
    const loudness = await measureLoudness(filePath);
    if (loudness) {
      check(
        checks,
        "integrated loudness is near -14 LUFS",
        Math.abs(loudness.integrated - -14) <= 1.5,
        `${loudness.integrated.toFixed(1)} LUFS, true peak ${Number.isFinite(loudness.truePeak) ? loudness.truePeak.toFixed(1) : "?"} dBTP`
      );
    } else {
      check(checks, "integrated loudness is near -14 LUFS", false, "loudnorm produced no measurement");
    }
  } catch (error) {
    check(checks, "integrated loudness is near -14 LUFS", false, `loudnorm failed: ${error.message}`);
  }
}

const failed = checks.filter((entry) => !entry.pass);
const payload = {
  file: filePath,
  preset: presetId,
  expected: {
    codec: preset.codec,
    width: preset.width,
    height: preset.height,
    fps: expectedFps,
    maxDuration: cap
  },
  duration: Math.round(duration * 100) / 100,
  checks,
  passed: failed.length === 0
};

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`Verifying ${path.basename(filePath)} against the ${preset.id} preset`);
  for (const entry of checks) {
    console.log(`${entry.pass ? "PASS" : "FAIL"}  ${entry.name}  (${entry.detail})`);
  }
  console.log(failed.length ? `\n${failed.length} check(s) failed.` : "\nAll checks passed.");
}

process.exit(failed.length ? 1 : 0);
