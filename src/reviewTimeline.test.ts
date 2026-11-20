import { describe, expect, it } from "vitest";
import { nudgeTrimValue, reviewTimelineWindow, snapTrimValue, timelinePercent, updateMultiSelection } from "./reviewTimeline";

describe("review timeline helpers", () => {
  it("builds a padded window around the active candidate", () => {
    expect(reviewTimelineWindow({ start: 40, end: 46 }, 120, 8)).toEqual({ start: 32, end: 54, duration: 22 });
  });

  it("caps very long review windows", () => {
    const window = reviewTimelineWindow({ start: 80, end: 160 }, 600, 8);
    expect(window.duration).toBeLessThanOrEqual(60);
    expect(window.start).toBeGreaterThanOrEqual(0);
    expect(window.end).toBeLessThanOrEqual(600);
  });

  it("maps trim times to rail percentages", () => {
    const window = reviewTimelineWindow({ start: 40, end: 46 }, 120, 8);
    expect(timelinePercent(32, window)).toBe(0);
    expect(timelinePercent(43, window)).toBe(50);
    expect(timelinePercent(60, window)).toBe(100);
  });

  it("snaps to nearby cut cues without crossing the other edge", () => {
    const window = { start: 20, end: 60, duration: 40 };
    const current = { start: 40, end: 48 };
    expect(snapTrimValue({ value: 38.9, part: "start", current, window, cues: [39, 47] })).toBe(39);
    expect(snapTrimValue({ value: 38.2, part: "start", current, window, cues: [39] })).toBe(38.2);
    expect(snapTrimValue({ value: 47.1, part: "end", current, window, cues: [39, 47] })).toBe(47);
  });

  it("nudges a trim edge with shift-arrow semantics", () => {
    const window = { start: 20, end: 60, duration: 40 };
    const current = { start: 40, end: 48 };
    expect(nudgeTrimValue({ value: 40, direction: -1, window, current, part: "start" })).toBe(39.5);
    expect(nudgeTrimValue({ value: 48, direction: 1, window, current, part: "end" })).toBe(48.5);
  });

  it("supports plain, additive, and shift-range selection", () => {
    const ids = ["a", "b", "c", "d"];
    expect(updateMultiSelection({ selected: [], anchor: "", id: "b", ids }).selected).toEqual(["b"]);
    expect(updateMultiSelection({ selected: ["b"], anchor: "b", id: "d", ids, additive: true }).selected).toEqual(["b", "d"]);
    expect(updateMultiSelection({ selected: ["b", "d"], anchor: "b", id: "c", ids, shiftKey: true }).selected).toEqual(["b", "d", "c"]);
  });
});
