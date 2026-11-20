// OpenAI-compatible speech transcription used for burned-in captions.
//
// Works with hosted endpoints and local servers (faster-whisper-server,
// whisper.cpp server) that expose POST /v1/audio/transcriptions.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "./tools.mjs";

export function transcriptionEndpoint(endpoint = "") {
  const url = new URL(String(endpoint));
  let pathname = url.pathname.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(pathname)) {
    pathname = pathname.replace(/\/chat\/completions$/, "/audio/transcriptions");
  } else if (!/\/audio\/transcriptions$/.test(pathname)) {
    pathname = `${pathname}/audio/transcriptions`;
  }
  url.pathname = pathname;
  url.search = "";
  return url.toString();
}

function normalizeWords(payload = {}) {
  const words = [];
  for (const entry of Array.isArray(payload.words) ? payload.words : []) {
    const start = Number(entry?.start ?? entry?.start_time);
    const end = Number(entry?.end ?? entry?.end_time);
    const text = String(entry?.word ?? entry?.text ?? "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    words.push({ start, end, text });
  }
  if (words.length) return words;

  for (const segment of Array.isArray(payload.segments) ? payload.segments : []) {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    const text = String(segment?.text ?? "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const parts = text.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const perWord = (end - start) / parts.length;
    parts.forEach((part, index) => {
      words.push({
        start: Math.round((start + index * perWord) * 100) / 100,
        end: Math.round((start + (index + 1) * perWord) * 100) / 100,
        text: part
      });
    });
  }
  return words;
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

export async function transcribeAudioSegment({
  filePath,
  start = 0,
  duration = 0,
  provider = {},
  signal,
  timeoutMs = 180_000
} = {}) {
  if (!filePath) throw new Error("Source video is missing.");
  if (!provider?.endpoint || !provider?.model) throw new Error("Transcription endpoint and model are required.");
  const segmentDuration = Math.max(0.5, Math.min(120, Number(duration) || 0));
  const segmentStart = Math.max(0, Number(start) || 0);
  const dir = await mkdtemp(path.join(os.tmpdir(), "highlightai-caption-"));
  const audioPath = path.join(dir, "segment.mp3");
  try {
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(segmentStart), "-t", String(segmentDuration),
      "-i", filePath,
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
      audioPath
    ], { signal });
    const audio = await readFile(audioPath);
    if (!audio.length) return { words: [], text: "" };

    const form = new FormData();
    form.append("file", new Blob([audio], { type: "audio/mpeg" }), "segment.mp3");
    form.append("model", String(provider.model));
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const response = await fetch(transcriptionEndpoint(provider.endpoint), {
      method: "POST",
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      body: form,
      signal: requestSignal(signal, timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Transcription request failed with status ${response.status}.`);
    }
    const words = normalizeWords(payload);
    return { words, text: String(payload?.text || words.map((word) => word.text).join(" ")) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
