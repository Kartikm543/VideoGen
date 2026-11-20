// Caption generation for short-form exports.
//
// The renderer burns an ASS track into the final encode, so caption timing must
// be relative to the *final* timeline (after music alignment and trimming).
// `buildCaptionTrack` transcribes each planned segment and then offsets word
// timings by the cumulative segment duration.

import { transcribeAudioSegment } from "./transcribe.mjs";

export const CAPTION_STYLES = ["Clean impact", "Bold pop", "Minimal"];

const MAX_CUE_CHARS = 46;
const MAX_LINE_CHARS = 23;
const MAX_LINES = 2;
const WORD_GAP_SECONDS = 0.5;

export function normalizeCaptionStyle(value) {
  const name = String(value || "").trim();
  return CAPTION_STYLES.find((style) => style.toLowerCase() === name.toLowerCase()) || "Clean impact";
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function sanitizeCaptionText(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\\{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeCueWords(words = []) {
  return words
    .map((word) => ({
      start: Number(word?.start),
      end: Number(word?.end),
      text: sanitizeCaptionText(word?.text ?? word?.word ?? "")
    }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
}

function wrapLines(words, maxLineChars = MAX_LINE_CHARS, maxLines = MAX_LINES) {
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word.text}` : word.text;
    if (candidate.length > maxLineChars && line) {
      lines.push(line);
      line = word.text;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  // Keep the newest words visible rather than dropping the end of a sentence.
  return lines.slice(lines.length - maxLines);
}

export function buildCaptionCues({ segments = [], segmentWords = [] } = {}) {
  const cues = [];
  let offset = 0;
  segments.forEach((segment, index) => {
    const duration = Math.max(0, Number(segment?.duration) || 0);
    if (duration <= 0) return;
    const words = sanitizeCueWords(segmentWords[index] || [])
      .filter((word) => word.start < duration - 0.03)
      .map((word) => ({
        start: offset + word.start,
        end: offset + Math.min(duration, Math.max(word.start + 0.12, word.end)),
        text: word.text
      }));

    let current = null;
    const flush = () => {
      if (current && current.words.length) cues.push(current);
      current = null;
    };
    for (const word of words) {
      const charCount = current ? current.words.reduce((sum, item) => sum + item.text.length + 1, 0) : 0;
      const gap = current ? word.start - current.end : Infinity;
      if (!current || gap > WORD_GAP_SECONDS || charCount + word.text.length > MAX_CUE_CHARS) {
        flush();
        current = { start: word.start, end: word.end, words: [word] };
      } else {
        current.words.push(word);
        current.end = Math.max(current.end, word.end);
      }
    }
    flush();
    offset += duration;
  });

  return cues
    .map((cue) => ({
      start: Math.round(cue.start * 100) / 100,
      end: Math.round(Math.max(cue.start + 0.4, cue.end) * 100) / 100,
      lines: wrapLines(cue.words)
    }))
    .filter((cue) => cue.lines.length && cue.end - cue.start >= 0.2);
}

export function assTimestamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const wholeSeconds = Math.floor(total % 60);
  const centiseconds = Math.round((total - Math.floor(total)) * 100) % 100;
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${hours}:${pad(minutes)}:${pad(wholeSeconds)}.${pad(centiseconds)}`;
}

export function srtTimestamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const wholeSeconds = Math.floor(total % 60);
  const milliseconds = Math.round((total - Math.floor(total)) * 1000) % 1000;
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)},${pad(milliseconds, 3)}`;
}

export function captionStyleLine({ style = "Clean impact", width = 1080, height = 1920 }) {
  const name = normalizeCaptionStyle(style);
  const base = Math.round(Math.min(width, height) * 0.052);
  // Keep captions inside short-form platform safe zones (UI controls sit along
  // the right edge and bottom of vertical players).
  const marginV = Math.round(height * 0.2);
  const marginX = Math.round(width * 0.09);
  const presets = {
    "Clean impact": {
      size: base,
      primary: "&H00FFFFFF",
      outlineColour: "&H00101010",
      backColour: "&H80000000",
      bold: -1,
      borderStyle: 1,
      outline: 3,
      shadow: 1
    },
    "Bold pop": {
      size: Math.round(base * 1.1),
      primary: "&H0000E7FF",
      outlineColour: "&H99000000",
      backColour: "&H99000000",
      bold: -1,
      borderStyle: 3,
      outline: 11,
      shadow: 0
    },
    Minimal: {
      size: Math.round(base * 0.9),
      primary: "&H00FFFFFF",
      outlineColour: "&H00101010",
      backColour: "&H00000000",
      bold: 0,
      borderStyle: 1,
      outline: 2,
      shadow: 0
    }
  };
  const preset = presets[name];
  return `Style: Caption,Arial,${preset.size},${preset.primary},&H000000FF,${preset.outlineColour},${preset.backColour},${preset.bold},0,0,0,100,100,0,0,${preset.borderStyle},${preset.outline},${preset.shadow},2,${marginX},${marginX},${marginV},1`;
}

export function hookStyleLine({ width = 1080, height = 1920 }) {
  const size = Math.round(Math.min(width, height) * 0.075);
  const marginV = Math.round(height * 0.22);
  const marginX = Math.round(width * 0.09);
  return `Style: Hook,Arial,${size},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,8,${marginX},${marginX},${marginV},1`;
}

export function buildAss({ cues = [], hookText = "", style = "Clean impact", width = 1080, height = 1920 } = {}) {
  const events = cues.map((cue) => {
    const text = cue.lines.join("\\N");
    return `Dialogue: 0,${assTimestamp(cue.start)},${assTimestamp(cue.end)},Caption,,0,0,0,,{\\fad(120,120)}${text}`;
  });
  const hook = sanitizeCaptionText(hookText);
  if (hook) {
    const hookEnd = Math.min(3.2, Math.max(1.8, (cues[0]?.end || 2.4)));
    events.unshift(`Dialogue: 1,0:00:00.00,${assTimestamp(hookEnd)},Hook,,0,0,0,,{\\fad(160,160)}${hook}`);
  }
  return [
    "[Script Info]",
    "; Generated by HighlightAI",
    "ScriptType: v4.00+",
    `PlayResX: ${Math.round(width)}`,
    `PlayResY: ${Math.round(height)}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    captionStyleLine({ style, width, height }),
    hookStyleLine({ width, height }),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    ""
  ].join("\n");
}

export function buildSrt(cues = []) {
  return cues.map((cue, index) => [
    String(index + 1),
    `${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}`,
    cue.lines.join("\n"),
    ""
  ].join("\n")).join("\n");
}

export function buildHookOnlyTrack({ draft = {}, width, height } = {}) {
  const hookText = sanitizeCaptionText(draft?.hookText || "");
  if (!hookText) return null;
  return {
    cues: [],
    ass: buildAss({
      cues: [],
      hookText,
      style: draft?.captionStyle || "Clean impact",
      width: Number(width) || Number(draft?.outputWidth) || undefined,
      height: Number(height) || Number(draft?.outputHeight) || undefined
    }),
    srt: "",
    failed: 0,
    total: 0,
    hookOnly: true
  };
}

const TIMESTAMP_PATTERN = "(?:\\d{1,2}:)?\\d{2}:\\d{2}[,.]\\d{1,3}";
const SUBTITLE_TIME_LINE = new RegExp(`^\\s*(${TIMESTAMP_PATTERN})\\s*-->\\s*(${TIMESTAMP_PATTERN})(?:\\s+.*)?$`, "i");

function parseSubtitleTimestamp(value) {
  const parts = String(value || "").replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
}

function cleanSubtitleText(value) {
  return sanitizeCaptionText(String(value || "").replace(/<\/?[^>]+>/g, " ").replace(/\{\\[^}]*\}/g, " "));
}

function cueLinesFromText(value) {
  const words = cleanSubtitleText(value).split(/\s+/).filter(Boolean).map((text) => ({ text }));
  return words.length ? wrapLines(words) : [];
}

function roundCueTime(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function plainTextCues(text, duration) {
  const words = cleanSubtitleText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const groups = [];
  let current = [];
  for (const word of words) {
    const candidate = [...current, word].join(" ");
    if (current.length && candidate.length > MAX_CUE_CHARS) {
      groups.push(current.join(" "));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) groups.push(current.join(" "));

  const totalChars = groups.reduce((sum, group) => sum + group.length, 0) || 1;
  const usable = Math.max(0.5, Number(duration) || 0) || groups.length * 1.4;
  const minSpan = Math.min(0.7, usable / groups.length);
  const spans = groups.map((group) => Math.max(minSpan, (usable * group.length) / totalChars));
  const spanTotal = spans.reduce((sum, span) => sum + span, 0) || 1;
  let cursor = 0;
  return groups.map((group, index) => {
    const start = (cursor / spanTotal) * usable;
    cursor += spans[index];
    const end = (cursor / spanTotal) * usable;
    return { start: roundCueTime(start), end: roundCueTime(Math.max(start + 0.3, end)), lines: wrapLines(group.split(/\s+/).map((word) => ({ text: word }))) };
  }).filter((cue) => cue.lines.length);
}

export function parseTranscriptCues(text, { duration = 0 } = {}) {
  const raw = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!raw) return [];
  const limit = Math.max(0, Number(duration) || 0);
  const timed = [];

  for (const block of raw.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim());
    const timeIndex = lines.findIndex((line) => SUBTITLE_TIME_LINE.test(line));
    if (timeIndex < 0) continue;
    const match = lines[timeIndex].match(SUBTITLE_TIME_LINE);
    if (!match) continue;
    const start = parseSubtitleTimestamp(match[1]);
    const end = parseSubtitleTimestamp(match[2]);
    const body = lines.slice(timeIndex + 1).map(cleanSubtitleText).filter(Boolean);
    if (!body.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (limit && start >= limit) continue;
    timed.push({
      start: roundCueTime(start),
      end: roundCueTime(limit ? Math.min(limit, end) : end),
      lines: cueLinesFromText(body.join(" "))
    });
  }

  const cues = timed.length ? timed : plainTextCues(raw, limit);
  return cues.filter((cue) => cue.lines.length && cue.end > cue.start);
}

export function buildImportedCaptionTrack({
  transcript,
  transcriptName = "",
  duration = 0,
  hookText = "",
  style = "Clean impact",
  width,
  height
} = {}) {
  const text = typeof transcript === "string" ? transcript : String(transcript?.text || "");
  const cues = parseTranscriptCues(text, { duration });
  if (!cues.length) return null;
  return {
    cues,
    ass: buildAss({ cues, hookText, style, width, height }),
    srt: buildSrt(cues),
    failed: 0,
    total: cues.length,
    imported: true,
    sourceName: String(transcriptName || "")
  };
}

export async function buildCaptionTrack({
  project,
  draft,
  provider,
  signal,
  onProgress,
  concurrency = 2
} = {}) {
  const segments = Array.isArray(draft?.segments) ? draft.segments : [];
  const files = new Map((project?.files || []).map((file) => [file.id, file]));
  const segmentWords = segments.map(() => []);
  let failed = 0;
  let completed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < segments.length) {
      if (signal?.aborted) throw new DOMException("Operation cancelled", "AbortError");
      const index = cursor;
      cursor += 1;
      const segment = segments[index];
      const file = files.get(segment.fileId);
      if (!file?.path) {
        failed += 1;
        continue;
      }
      try {
        const result = await transcribeAudioSegment({
          filePath: file.path,
          start: clampNumber(segment.start, 0, Math.max(0, Number(file.metadata?.duration) || 0), 0),
          duration: clampNumber(segment.duration, 0.5, 120, 8),
          provider,
          signal
        });
        segmentWords[index] = result.words;
      } catch (error) {
        if (signal?.aborted) throw error;
        failed += 1;
      }
      completed += 1;
      await onProgress?.({ completed, total: segments.length });
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, segments.length || 1)) }, worker));

  const cues = buildCaptionCues({ segments, segmentWords });
  return {
    cues,
    ass: buildAss({
      cues,
      hookText: draft?.hookText || "",
      style: draft?.captionStyle || "Clean impact",
      width: Number(draft?.outputWidth) || undefined,
      height: Number(draft?.outputHeight) || undefined
    }),
    srt: buildSrt(cues),
    failed,
    total: segments.length
  };
}
