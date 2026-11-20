import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeMusicBeats, buildBeatGrid } from "./audio-beats.mjs";
import { alignTrailerSegmentsToMusic } from "./media.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "highlight-beats-"));
  tempDirs.push(dir);
  return dir;
}

function syntheticFrames({ bpm = 120, seconds = 4, fps = 20 } = {}) {
  const interval = Math.max(1, Math.round((60 / bpm) * fps));
  const count = Math.round(seconds * fps);
  return Array.from({ length: count }, (_, index) => ({
    time: index / fps,
    level: index % interval === 0 ? -6 : -34
  }));
}

async function writeClickWav(filePath: string, { bpm = 120, seconds = 8 } = {}) {
  const rate = 44100;
  const sampleCount = rate * seconds;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);

  const interval = Math.round(rate * 60 / bpm);
  for (let index = 0; index < sampleCount; index += 1) {
    const sinceClick = index % interval;
    const amplitude = sinceClick < 500
      ? Math.round(30000 * (1 - sinceClick / 500))
      : 0;
    buffer.writeInt16LE(amplitude, 44 + index * 2);
  }
  await writeFile(filePath, buffer);
}

describe("beat grid", () => {
  it("detects tempo, phase, and 4/4 downbeats from an onset envelope", () => {
    const grid = buildBeatGrid({ frames: syntheticFrames(), duration: 4, fps: 20 });
    expect(grid.method).toBe("onset-autocorrelation");
    expect(grid.bpm).toBeGreaterThan(115);
    expect(grid.bpm).toBeLessThan(125);
    expect(grid.beats.length).toBeGreaterThanOrEqual(8);
    expect(grid.beats[0].time).toBeCloseTo(0, 2);
    expect(grid.beats[1].time).toBeCloseTo(0.5, 2);
    expect(grid.beats[0].downbeat).toBe(true);
    expect(grid.beats[4].downbeat).toBe(true);
    expect(grid.beats[1].downbeat).toBe(false);
  });

  it("returns an empty grid for silence", () => {
    const frames = Array.from({ length: 80 }, (_, index) => ({ time: index / 20, level: -60 }));
    const grid = buildBeatGrid({ frames, duration: 4, fps: 20 });
    expect(grid.beats).toEqual([]);
    expect(grid.bpm).toBe(0);
    expect(grid.method).toBe("none");
  });

  it("analyzes a local WAV without any cloud service", async () => {
    const dir = await makeTempDir();
    const musicPath = path.join(dir, "clicks.wav");
    await writeClickWav(musicPath);
    const grid = await analyzeMusicBeats(musicPath, { duration: 8 });
    expect(grid.bpm).toBeGreaterThan(112);
    expect(grid.bpm).toBeLessThan(128);
    expect(grid.beats.length).toBeGreaterThanOrEqual(15);
    expect(grid.beats[2].time).toBeCloseTo(1, 1);
  });
});

describe("beat-aware trailer alignment", () => {
  it("places cuts on downbeats without cutting protected payoff duration", async () => {
    const dir = await makeTempDir();
    const musicPath = path.join(dir, "clicks.wav");
    await writeClickWav(musicPath);
    const draft = {
      style: "Trailer",
      duration: 8,
      musicRepeats: 1,
      segments: [
        { fileId: "a", start: 0, duration: 6.1, minDuration: 4, score: 90 },
        { fileId: "b", start: 0, duration: 1.9, minDuration: 1.5, score: 88 }
      ]
    };

    const aligned = await alignTrailerSegmentsToMusic(draft, musicPath);

    expect(aligned.musicPlan?.beatGrid?.bpm).toBeGreaterThan(112);
    expect(aligned.segments[0].duration).toBeCloseTo(6, 1);
    expect(aligned.segments[0].beatAligned).toBe(true);
    expect(aligned.segments[0].downbeatCut).toBe(true);
    expect(aligned.segments[1].duration).toBeGreaterThanOrEqual(1.5);
  });
});
