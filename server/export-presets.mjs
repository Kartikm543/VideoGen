// Platform export presets for short-form and upload-ready videos.
//
// `auto` keeps the historical behaviour (format comes from the draft) but now
// encodes H.264 instead of HEVC, because Instagram Reels and most desktop
// upload paths are the most reliable with AVC. `archive` keeps the old HEVC
// ladder for local archives.

export const EXPORT_PRESET_IDS = ["auto", "shorts", "reels", "long", "archive"];

export const EXPORT_PRESETS = {
  auto: {
    id: "auto",
    label: "Auto (recommended)",
    description: "H.264 MP4 sized to the selected direction.",
    format: null,
    width: 0,
    height: 0,
    fps: 30,
    codec: "h264",
    crf: 19,
    maxDuration: 180
  },
  shorts: {
    id: "shorts",
    label: "YouTube Short",
    description: "1080x1920 vertical, up to 60 seconds, H.264.",
    format: "Vertical",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    crf: 18,
    maxDuration: 60
  },
  reels: {
    id: "reels",
    label: "Instagram Reel",
    description: "1080x1920 vertical, up to 90 seconds, H.264.",
    format: "Vertical",
    width: 1080,
    height: 1920,
    fps: 30,
    codec: "h264",
    crf: 19,
    maxDuration: 90
  },
  long: {
    id: "long",
    label: "1080p upload",
    description: "1920x1080 horizontal, up to 3 minutes, H.264.",
    format: "Landscape",
    width: 1920,
    height: 1080,
    fps: 30,
    codec: "h264",
    crf: 20,
    maxDuration: 180
  },
  archive: {
    id: "archive",
    label: "Archive (HEVC)",
    description: "Smaller local archive file using HEVC.",
    format: null,
    width: 0,
    height: 0,
    fps: 30,
    codec: "hevc",
    crf: 23,
    maxDuration: 180
  }
};

export function normalizeExportPresetId(value) {
  const id = String(value || "").trim().toLowerCase();
  return EXPORT_PRESET_IDS.includes(id) ? id : "auto";
}

export function clampExportFps(value, fallback = 30) {
  return Number(value) === 60 ? 60 : Number(value) === 30 ? 30 : fallback === 60 ? 60 : 30;
}

export function resolveExportPreset(draft = {}) {
  const id = normalizeExportPresetId(draft?.preset);
  const preset = EXPORT_PRESETS[id];
  const vertical = preset.format ? preset.format === "Vertical" : draft?.format === "Vertical";
  const format = vertical ? "Vertical" : "Landscape";
  return {
    ...preset,
    id,
    format,
    width: preset.width || (vertical ? 1080 : 1920),
    height: preset.height || (vertical ? 1920 : 1080),
    fps: clampExportFps(draft?.fps, preset.fps)
  };
}

export function presetTargetDuration(presetId, fallback = 0) {
  const preset = EXPORT_PRESETS[normalizeExportPresetId(presetId)];
  const fallbackSeconds = Math.max(0, Number(fallback) || 0);
  if (preset.id === "auto" || preset.id === "archive") return fallbackSeconds;
  return Math.min(preset.maxDuration, Math.max(15, fallbackSeconds || preset.maxDuration));
}

export function presetSummary(preset) {
  return `${preset.width}x${preset.height} ${preset.fps}fps ${String(preset.codec).toUpperCase()}`;
}
