// Publishing extras: a cover frame and upload metadata written next to the MP4.
//
// The metadata pack is intentionally plain: a JSON sidecar for tooling and a
// human-readable .txt for copy/paste. Nothing is uploaded anywhere; the app
// only prepares the files a creator normally types by hand.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "./tools.mjs";

const PLATFORM_BY_PRESET = {
  shorts: "youtube-shorts",
  reels: "instagram-reels",
  long: "youtube",
  auto: "general",
  archive: "general"
};

const BASE_HASHTAGS = {
  "youtube-shorts": ["#Shorts", "#Gaming", "#GamingClips"],
  "instagram-reels": ["#Reels", "#Gaming", "#GamingReels", "#InstaGaming"],
  youtube: ["#Gaming", "#Highlights"],
  general: ["#Gaming"]
};

export function sanitizeMetadataText(value, maxLength = 100) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function hashtagFor(value) {
  const cleaned = String(value || "").replace(/[^a-z0-9]+/gi, "");
  return cleaned ? `#${cleaned}` : "";
}

function dedupe(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

export function formatDurationLabel(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `0:${String(remainder).padStart(2, "0")}`;
}

export function buildUploadMetadata({ project = {}, draft = {}, preset = {}, durationSeconds = 0 } = {}) {
  const platform = PLATFORM_BY_PRESET[preset.id] || "general";
  const gameName = sanitizeMetadataText(project.gameProfile?.name || project.name || "Gameplay", 40);
  const genre = sanitizeMetadataText(project.gameProfile?.genre || "", 30);
  const style = sanitizeMetadataText(draft.style || "", 24);
  const hook = sanitizeMetadataText(draft.hookText || "", 60);
  const draftTitle = sanitizeMetadataText(draft.title || "", 60);
  const presetLabel = preset.id === "reels" ? "Reel" : preset.id === "shorts" ? "Short" : preset.id === "long" ? "Highlight" : "Highlight";

  let title = hook || draftTitle || `${gameName} ${presetLabel}`;
  if (!hook && gameName && !title.toLowerCase().includes(gameName.toLowerCase())) {
    title = `${title} | ${gameName} ${presetLabel}`;
  }
  title = sanitizeMetadataText(title, 95);

  const hashtags = dedupe([
    ...(BASE_HASHTAGS[platform] || BASE_HASHTAGS.general),
    hashtagFor(gameName),
    hashtagFor(genre)
  ]).slice(0, 9);

  const tags = dedupe([
    gameName,
    genre,
    style,
    `${gameName} highlights`,
    "gaming highlights",
    preset.id === "reels" ? "reels" : preset.id === "long" ? "long form" : "shorts",
    "highlight"
  ])
    .filter((tag) => tag.length <= 30)
    .slice(0, 15);

  const descriptionLines = [
    hook || draftTitle || `${gameName} ${presetLabel.toLowerCase()}`,
    "",
    `Game: ${gameName}`,
    ...(genre ? [`Genre: ${genre}`] : []),
    ...(style ? [`Edit style: ${style}`] : []),
    `Length: ${formatDurationLabel(durationSeconds)}`,
    "",
    "Captured and edited locally with HighlightAI.",
    "Game footage and music remain the rights of their respective owners. Verify licenses before publishing.",
    "",
    hashtags.join(" ")
  ];

  return {
    platform,
    title,
    description: descriptionLines.join("\n"),
    tags,
    hashtags,
    game: gameName,
    genre: genre || null,
    style: style || null,
    durationSeconds: Math.round(Number(durationSeconds) || 0),
    generatedAt: new Date().toISOString()
  };
}

export function buildMetadataText(metadata = {}) {
  return [
    "HighlightAI upload details",
    "========================",
    `Platform: ${metadata.platform || "general"}`,
    `Title: ${metadata.title || ""}`,
    "",
    "Description",
    "-----------",
    metadata.description || "",
    "",
    `Tags: ${(metadata.tags || []).join(", ")}`,
    `Hashtags: ${(metadata.hashtags || []).join(" ")}`,
    ""
  ].join("\n");
}

export function coverMoment(draft = {}, project = {}) {
  const files = new Map((project.files || []).map((file) => [file.id, file]));
  const usable = (draft.segments || []).filter((segment) => files.get(segment.fileId)?.path);
  if (!usable.length) return null;
  const best = usable.reduce((winner, segment) =>
    Number(segment.score || 0) > Number(winner.score || 0) ? segment : winner, usable[0]);
  const file = files.get(best.fileId);
  const fileDuration = Math.max(0, Number(file.metadata?.duration) || 0);
  const start = Math.max(0, Number(best.start) || 0);
  const duration = Math.max(0.5, Number(best.duration) || 1);
  const preferred = start + duration * 0.7;
  const at = fileDuration ? Math.min(Math.max(0, fileDuration - 0.1), preferred) : Math.max(0, preferred);
  return { sourcePath: file.path, at: Math.round(at * 100) / 100 };
}

export async function renderCoverFrame({ sourcePath, at = 0, outputPath, width = 1080, height = 1920, signal } = {}) {
  if (!sourcePath || !outputPath) throw new Error("A source video and output path are required for the cover frame.");
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=contrast=1.04:saturation=1.05`;
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(Math.max(0, Number(at) || 0)),
    "-i", sourcePath,
    "-frames:v", "1",
    "-vf", filter,
    "-q:v", "2",
    outputPath
  ], { signal });
}

export async function writePublishFiles({ directory, baseName, metadata } = {}) {
  const jsonPath = path.join(directory, `${baseName}.json`);
  const textPath = path.join(directory, `${baseName}.txt`);
  await writeFile(jsonPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await writeFile(textPath, buildMetadataText(metadata), "utf8");
  return { jsonPath, textPath };
}
