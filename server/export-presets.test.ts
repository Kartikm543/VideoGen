import { describe, expect, it } from "vitest";
import {
  EXPORT_PRESETS,
  clampExportFps,
  normalizeExportPresetId,
  presetSummary,
  presetTargetDuration,
  resolveExportPreset
} from "./export-presets.mjs";

describe("export presets", () => {
  it("falls back to auto for unknown ids", () => {
    expect(normalizeExportPresetId(undefined)).toBe("auto");
    expect(normalizeExportPresetId("garbage")).toBe("auto");
    expect(normalizeExportPresetId("  SHORTS ")).toBe("shorts");
  });

  it("keeps the historical direction for auto and archive", () => {
    expect(resolveExportPreset({ preset: "auto", format: "Vertical" })).toMatchObject({
      id: "auto",
      format: "Vertical",
      width: 1080,
      height: 1920,
      codec: "h264"
    });
    expect(resolveExportPreset({ preset: "auto", format: "Landscape" })).toMatchObject({
      format: "Landscape",
      width: 1920,
      height: 1080
    });
    expect(resolveExportPreset({ preset: "archive", format: "Landscape" })).toMatchObject({
      codec: "hevc",
      width: 1920,
      height: 1080
    });
  });

  it("forces vertical 1080x1920 for shorts and reels", () => {
    expect(resolveExportPreset({ preset: "shorts", format: "Landscape" })).toMatchObject({
      format: "Vertical",
      width: 1080,
      height: 1920,
      maxDuration: 60
    });
    expect(resolveExportPreset({ preset: "reels", format: "Landscape" })).toMatchObject({
      format: "Vertical",
      width: 1080,
      height: 1920,
      maxDuration: 90
    });
  });

  it("forces landscape 1920x1080 for the long preset", () => {
    expect(resolveExportPreset({ preset: "long", format: "Vertical" })).toMatchObject({
      format: "Landscape",
      width: 1920,
      height: 1080,
      maxDuration: 180
    });
  });

  it("clamps the requested frame rate to the supported values", () => {
    expect(clampExportFps(60)).toBe(60);
    expect(clampExportFps("60")).toBe(60);
    expect(clampExportFps(24)).toBe(30);
    expect(clampExportFps(undefined, 60)).toBe(60);
    expect(clampExportFps(50, 60)).toBe(60);
    expect(resolveExportPreset({ preset: "shorts", fps: 60 }).fps).toBe(60);
    expect(resolveExportPreset({ preset: "shorts", fps: 24 }).fps).toBe(30);
  });

  it("caps durations per preset without inflating short drafts", () => {
    expect(presetTargetDuration("shorts", 45)).toBe(45);
    expect(presetTargetDuration("shorts", 120)).toBe(60);
    expect(presetTargetDuration("shorts", 0)).toBe(60);
    expect(presetTargetDuration("reels", 200)).toBe(90);
    expect(presetTargetDuration("long", 999)).toBe(180);
    expect(presetTargetDuration("auto", 42)).toBe(42);
    expect(presetTargetDuration("archive", 0)).toBe(0);
  });

  it("summarizes the encoding target for progress copy", () => {
    expect(presetSummary(EXPORT_PRESETS.shorts)).toBe("1080x1920 30fps H264");
    expect(presetSummary({ ...EXPORT_PRESETS.long, fps: 60 })).toBe("1920x1080 60fps H264");
  });
});
