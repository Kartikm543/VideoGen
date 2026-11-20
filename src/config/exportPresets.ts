import type { ExportPresetId, VerticalFit, VideoIdea } from "../types";

export type ExportPresetOption = {
  id: ExportPresetId;
  label: string;
  short: string;
  description: string;
  format: "Landscape" | "Vertical" | null;
  targetDuration: number;
  maxDuration: number;
};

export const EXPORT_PRESET_OPTIONS: ExportPresetOption[] = [
  {
    id: "auto",
    label: "Auto (recommended)",
    short: "Auto",
    description: "Keeps the selected direction and encodes H.264.",
    format: null,
    targetDuration: 0,
    maxDuration: 180
  },
  {
    id: "shorts",
    label: "YouTube Short",
    short: "Short",
    description: "1080x1920 vertical, up to 60 seconds.",
    format: "Vertical",
    targetDuration: 60,
    maxDuration: 60
  },
  {
    id: "reels",
    label: "Instagram Reel",
    short: "Reel",
    description: "1080x1920 vertical, up to 90 seconds.",
    format: "Vertical",
    targetDuration: 60,
    maxDuration: 90
  },
  {
    id: "long",
    label: "1080p upload",
    short: "1080p",
    description: "1920x1080 horizontal, up to 3 minutes.",
    format: "Landscape",
    targetDuration: 120,
    maxDuration: 180
  },
  {
    id: "archive",
    label: "Archive (HEVC)",
    short: "Archive",
    description: "Smaller local archive file using HEVC.",
    format: null,
    targetDuration: 0,
    maxDuration: 180
  }
];

export function exportPresetOption(id: ExportPresetId): ExportPresetOption {
  return EXPORT_PRESET_OPTIONS.find((option) => option.id === id) || EXPORT_PRESET_OPTIONS[0];
}

export type ExportSettings = {
  preset: ExportPresetId;
  fps: 30 | 60;
  verticalFit: VerticalFit;
  cropBiasX: number;
  captions: boolean;
  hookText: string;
  transcriptText: string;
  transcriptName: string;
  publishKit: boolean;
};

export function exportIdeaOverrides(settings: ExportSettings): Partial<VideoIdea> {
  const option = exportPresetOption(settings.preset);
  const shared: Partial<VideoIdea> = {
    preset: settings.preset,
    fps: settings.fps,
    verticalFit: settings.verticalFit,
    cropBiasX: Math.max(-1, Math.min(1, settings.cropBiasX)),
    captions: settings.captions,
    hookText: settings.hookText.trim().slice(0, 90),
    transcriptText: settings.transcriptText.slice(0, 500000),
    transcriptName: settings.transcriptName.slice(0, 160),
    publishKit: settings.publishKit !== false
  };
  if (!option.format) return { ...shared, durationMode: "auto" };
  return {
    ...shared,
    format: option.format,
    durationMode: "fixed",
    duration: option.targetDuration
  };
}

export function formatPresetBadge(value?: { preset?: ExportPresetId; width?: number; height?: number; codec?: string; fps?: number }) {
  if (!value?.preset && !value?.width) return "";
  const option = value.preset ? exportPresetOption(value.preset) : null;
  const size = value.width && value.height ? `${value.width}x${value.height}` : "";
  const codec = value.codec ? value.codec.toUpperCase() : "";
  const fps = value.fps ? `${value.fps}fps` : "";
  return [option?.short, size, codec, fps].filter(Boolean).join(" - ");
}
