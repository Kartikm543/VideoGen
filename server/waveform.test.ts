import { describe, expect, it } from "vitest";
import { buildWaveformBins } from "./waveform.mjs";

describe("review waveform", () => {
  it("maps RMS frames into a fixed number of normalized bins", () => {
    const bins = buildWaveformBins([
      { time: 0, level: -70 },
      { time: 0.5, level: 0 },
      { time: 1, level: -70 }
    ], { start: 0, duration: 2, bins: 4 });
    expect(bins).toHaveLength(4);
    expect(bins[1]).toBe(1);
    expect(bins[0]).toBeGreaterThan(0);
    expect(bins[3]).toBeGreaterThan(0);
    expect(bins.every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it("ignores frames outside the visible region", () => {
    const bins = buildWaveformBins([
      { time: 4, level: -10 },
      { time: 12, level: -20 }
    ], { start: 10, duration: 4, bins: 4 });
    expect(bins[2]).toBeCloseTo(0.714, 2);
    expect(bins[0]).toBeLessThan(bins[2]);
  });
});
