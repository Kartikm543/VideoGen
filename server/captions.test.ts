import { describe, expect, it } from "vitest";
import {
  assTimestamp,
  buildAss,
  buildCaptionCues,
  buildSrt,
  captionStyleLine,
  hookStyleLine,
  buildHookOnlyTrack,
  buildImportedCaptionTrack,
  parseTranscriptCues,
  normalizeCaptionStyle,
  sanitizeCaptionText,
  srtTimestamp
} from "./captions.mjs";

describe("caption cues", () => {
  it("offsets word timings by the cumulative segment duration", () => {
    const cues = buildCaptionCues({
      segments: [{ duration: 2 }, { duration: 3 }],
      segmentWords: [
        [{ start: 0.2, end: 0.6, text: "first" }],
        [{ start: 0.5, end: 0.9, text: "second" }]
      ]
    });
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBeCloseTo(0.2, 2);
    expect(cues[1].start).toBeCloseTo(2.5, 2);
    expect(cues[1].lines.join(" ")).toBe("second");
  });

  it("merges nearby words and splits on long gaps", () => {
    const cues = buildCaptionCues({
      segments: [{ duration: 10 }],
      segmentWords: [[
        { start: 0, end: 0.3, text: "no" },
        { start: 0.35, end: 0.7, text: "way" },
        { start: 4, end: 4.4, text: "later" }
      ]]
    });
    expect(cues).toHaveLength(2);
    expect(cues[0].lines.join(" ")).toBe("no way");
    expect(cues[1].lines.join(" ")).toBe("later");
  });

  it("drops words that start after the segment ends", () => {
    const cues = buildCaptionCues({
      segments: [{ duration: 1 }],
      segmentWords: [[
        { start: 0.1, end: 0.4, text: "kept" },
        { start: 1.5, end: 1.8, text: "dropped" }
      ]]
    });
    expect(cues).toHaveLength(1);
    expect(cues[0].lines.join(" ")).toBe("kept");
  });

  it("ignores malformed words", () => {
    const cues = buildCaptionCues({
      segments: [{ duration: 5 }],
      segmentWords: [[
        { start: "x", end: 1, text: "bad" },
        { start: 1, end: 0.5, text: "backwards" },
        { start: 1, end: 1.4, text: "   " },
        { start: 1, end: 1.4, text: "good" }
      ]]
    });
    expect(cues).toHaveLength(1);
    expect(cues[0].lines.join(" ")).toBe("good");
  });
});

describe("caption formatting", () => {
  it("formats ASS and SRT timestamps", () => {
    expect(assTimestamp(0)).toBe("0:00:00.00");
    expect(assTimestamp(61.5)).toBe("0:01:01.50");
    expect(assTimestamp(3661.25)).toBe("1:01:01.25");
    expect(srtTimestamp(61.5)).toBe("00:01:01,500");
    expect(srtTimestamp(0)).toBe("00:00:00,000");
  });

  it("sanitizes unsafe characters out of caption text", () => {
    expect(sanitizeCaptionText("  hello\n\\ {world} ")).toBe("hello world");
    expect(normalizeCaptionStyle("bold pop")).toBe("Bold pop");
    expect(normalizeCaptionStyle("unknown")).toBe("Clean impact");
  });

  it("builds a valid ASS document with a hook event", () => {
    const ass = buildAss({
      cues: [{ start: 0.5, end: 1.5, lines: ["hello", "world"] }],
      hookText: "watch this",
      style: "Bold pop",
      width: 1080,
      height: 1920
    });
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("Style: Hook");
    expect(ass).toContain("Dialogue: 1,0:00:00.00");
    expect(ass).toContain("watch this");
    expect(ass).toContain("Dialogue: 0,0:00:00.50,0:00:01.50,Caption");
    expect(ass).toContain("hello\\Nworld");
  });

  it("omits the hook when no hook text is provided", () => {
    const ass = buildAss({ cues: [{ start: 0, end: 1, lines: ["hi"] }], hookText: "   " });
    expect(ass).not.toContain("Dialogue: 1");
  });

  it("builds a hook-only ASS track without transcription", () => {
    const track = buildHookOnlyTrack({
      draft: { hookText: "watch this", captionStyle: "Bold pop" },
      width: 1080,
      height: 1920
    });
    expect(track).not.toBeNull();
    expect(track.hookOnly).toBe(true);
    expect(track.cues).toEqual([]);
    expect(track.srt).toBe("");
    expect(track.ass).toContain("Style: Hook");
    expect(track.ass).toContain("Dialogue: 1,0:00:00.00");
    expect(track.ass).toContain("watch this");
    expect(track.ass).not.toContain("Dialogue: 0,");
  });

  it("returns no hook-only track for blank hook text", () => {
    expect(buildHookOnlyTrack({ draft: { hookText: "   " } })).toBeNull();
  });

  it("builds an SRT sidecar with sequential indices", () => {
    const srt = buildSrt([
      { start: 0, end: 1.2, lines: ["one"] },
      { start: 1.3, end: 2.8, lines: ["two", "lines"] }
    ]);
    expect(srt.startsWith("1\n00:00:00,000 --> 00:00:01,200\none")).toBe(true);
    expect(srt).toContain("2\n00:00:01,300 --> 00:00:02,800\ntwo\nlines");
  });

  it("scales caption style to the output size", () => {
    const vertical = captionStyleLine({ width: 1080, height: 1920 });
    const landscape = captionStyleLine({ width: 1920, height: 1080 });
    expect(vertical).toContain("Style: Caption,Arial,");
    // Font size is derived from the shorter edge, so both should match.
    expect(vertical.split(",")[2]).toBe(landscape.split(",")[2]);
  });

  it("keeps captions and hook text inside vertical safe zones", () => {
    const width = 1080;
    const height = 1920;
    for (const line of [
      captionStyleLine({ width, height }),
      hookStyleLine({ width, height })
    ]) {
      const fields = line.split(",");
      const marginLeft = Number(fields[19]);
      const marginRight = Number(fields[20]);
      const marginVertical = Number(fields[21]);
      expect(marginLeft).toBeGreaterThanOrEqual(Math.round(width * 0.08));
      expect(marginRight).toBeGreaterThanOrEqual(Math.round(width * 0.08));
      expect(marginVertical).toBeGreaterThanOrEqual(Math.round(height * 0.18));
    }
  });
});

describe("imported transcripts", () => {
  it("parses SRT cues and strips subtitle tags", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:02,500",
      "Hello <i>world</i>",
      "",
      "2",
      "00:00:03.000 --> 00:00:04.000",
      "Second line"
    ].join("\n");
    const cues = parseTranscriptCues(srt, { duration: 10 });
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(2.5);
    expect(cues[0].lines.join(" ")).toBe("Hello world");
    expect(cues[1].lines.join(" ")).toBe("Second line");
  });

  it("parses VTT cues and skips notes", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE generated elsewhere",
      "",
      "00:00:00.500 --> 00:00:01.200 align:start",
      "First cue"
    ].join("\n");
    const cues = parseTranscriptCues(vtt, { duration: 8 });
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBe(0.5);
    expect(cues[0].lines.join(" ")).toBe("First cue");
  });

  it("distributes untimed plain text across the final duration", () => {
    const cues = parseTranscriptCues("one two three four", { duration: 8 });
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBe(0);
    expect(cues[0].end).toBe(8);
    expect(cues[0].lines.join(" ")).toBe("one two three four");
  });

  it("builds an imported caption track with hook text", () => {
    const track = buildImportedCaptionTrack({
      transcript: "1\n00:00:01,000 --> 00:00:02,000\nImported words",
      transcriptName: "captions.srt",
      duration: 10,
      hookText: "HOOK",
      style: "Minimal",
      width: 1080,
      height: 1920
    });
    expect(track).not.toBeNull();
    expect(track.imported).toBe(true);
    expect(track.sourceName).toBe("captions.srt");
    expect(track.ass).toContain("Dialogue: 1,0:00:00.00");
    expect(track.ass).toContain("Imported words");
    expect(track.srt).toContain("Imported words");
  });
});
