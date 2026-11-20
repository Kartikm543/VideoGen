import { describe, expect, it } from "vitest";
import { chooseCutPoint, keyframeWindow, parseArgs, planClips, snapToKeyframe } from "./split-vod.mjs";

describe("split-vod planning", () => {
  it("parses and sanitises CLI arguments", () => {
    const args = parseArgs(["C:\\clips\\vod.mp4", "--min", "45", "--max", "80", "--overlap", "3", "--scene", "0.5", "--dry-run"]);
    expect(args.file).toBe("C:\\clips\\vod.mp4");
    expect(args.min).toBe(45);
    expect(args.max).toBe(80);
    expect(args.overlap).toBe(3);
    expect(args.scene).toBe(0.5);
    expect(args.dryRun).toBe(true);
  });

  it("never lets max fall below min and clamps overlap", () => {
    const args = parseArgs(["vod.mp4", "--min", "90", "--max", "30", "--overlap", "99"]);
    expect(args.max).toBe(90);
    expect(args.overlap).toBe(10);
  });

  it("splits a long recording into bounded, overlapping clips", () => {
    const clips = planClips({ duration: 600, scenes: [], peaks: [], min: 60, max: 120, overlap: 2 });
    expect(clips.length).toBeGreaterThanOrEqual(5);
    expect(clips.length).toBeLessThanOrEqual(10);
    expect(clips[0].start).toBe(0);
    expect(clips.at(-1).end).toBeCloseTo(600, 1);
    for (const clip of clips) {
      expect(clip.duration).toBeGreaterThan(0);
      expect(clip.duration).toBeLessThanOrEqual(122.1);
    }
    for (let index = 1; index < clips.length; index += 1) {
      const overlap = clips[index - 1].end - clips[index].start;
      expect(overlap).toBeCloseTo(2, 1);
    }
  });

  it("returns a single clip for videos shorter than the maximum", () => {
    const clips = planClips({ duration: 45, scenes: [], peaks: [], min: 60, max: 120, overlap: 2 });
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ index: 1, start: 0, end: 45, cutReason: "end" });
  });

  it("prefers a nearby scene cut over an audio peak", () => {
    const chosen = chooseCutPoint(90, { scenes: [93], peaks: [88], min: 60, max: 120 });
    expect(chosen).toEqual({ time: 93, reason: "scene" });
  });

  it("uses an audio peak when no scene change is nearby", () => {
    const chosen = chooseCutPoint(90, { scenes: [], peaks: [95], min: 60, max: 120 });
    expect(chosen).toEqual({ time: 95, reason: "audio-peak" });
  });

  it("falls back to the target when no candidate is within range", () => {
    expect(chooseCutPoint(90, { scenes: [200], peaks: [5], min: 60, max: 120 })).toEqual({ time: 90, reason: "target" });
  });

  it("snaps planned boundaries to scene cuts", () => {
    const clips = planClips({ duration: 260, scenes: [88, 176], peaks: [], min: 60, max: 120, overlap: 2 });
    expect(clips[0].end).toBeCloseTo(90, 1);
    expect(clips[1].end).toBeCloseTo(178, 1);
    expect(clips[0].cutReason).toBe("scene");
  });

  it("starts every part on a keyframe so stream-copy durations stay accurate", () => {
    const keyframes = [0, 8, 16, 24, 32, 40];
    const clips = planClips({ duration: 40, scenes: [], peaks: [], keyframes, min: 10, max: 20, overlap: 2 });
    expect(clips.map((clip) => clip.start)).toEqual([0, 16, 32]);
    expect(clips[1].cutReason).toContain("keyframe");
    for (let index = 1; index < clips.length; index += 1) {
      expect(clips[index - 1].end - clips[index].start).toBeCloseTo(2, 1);
    }
  });

  it("derives a keyframe snap window from the GOP length", () => {
    expect(keyframeWindow([])).toBe(6);
    expect(keyframeWindow([0, 2, 4, 6])).toBe(3);
    expect(keyframeWindow([0, 10])).toBe(12.5);
    expect(snapToKeyframe(9.5, [0, 10], 3)).toEqual({ time: 10, snapped: true });
    expect(snapToKeyframe(5, [0, 10], 3)).toEqual({ time: 5, snapped: false });
  });
});
