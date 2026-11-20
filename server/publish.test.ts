import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMetadataText,
  buildUploadMetadata,
  coverMoment,
  formatDurationLabel,
  hashtagFor,
  sanitizeMetadataText,
  writePublishFiles
} from "./publish.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "highlight-publish-"));
  tempDirs.push(dir);
  return dir;
}

describe("upload metadata", () => {
  it("builds platform-specific titles, tags, and hashtags", () => {
    const metadata = buildUploadMetadata({
      project: { name: "GTA VI", gameProfile: { name: "GTA VI", genre: "Action" } },
      draft: { style: "Trailer", hookText: "Insane chase", title: "Draft title" },
      preset: { id: "shorts" },
      durationSeconds: 58.4
    });
    expect(metadata.platform).toBe("youtube-shorts");
    expect(metadata.title).toBe("Insane chase");
    expect(metadata.hashtags).toContain("#Shorts");
    expect(metadata.hashtags).toContain("#GTAVI");
    expect(metadata.tags).toContain("GTA VI");
    expect(metadata.description).toContain("Length: 0:58");
    expect(metadata.durationSeconds).toBe(58);
  });

  it("falls back to a readable title and reel hashtags", () => {
    const metadata = buildUploadMetadata({
      project: { gameProfile: { name: "Vice City" } },
      draft: { title: "My clip" },
      preset: { id: "reels" },
      durationSeconds: 90
    });
    expect(metadata.platform).toBe("instagram-reels");
    expect(metadata.title).toBe("My clip | Vice City Reel");
    expect(metadata.hashtags).toContain("#Reels");
    expect(metadata.hashtags).toContain("#GamingReels");
    expect(metadata.description).toContain("Length: 1:30");
  });

  it("sanitizes text and formats duration labels", () => {
    expect(sanitizeMetadataText("  a\n\tb  ", 5)).toBe("a b");
    expect(hashtagFor("Grand Theft Auto VI!")).toBe("#GrandTheftAutoVI");
    expect(hashtagFor("---")).toBe("");
    expect(formatDurationLabel(0)).toBe("0:00");
    expect(formatDurationLabel(125)).toBe("2:05");
  });
});

describe("cover selection", () => {
  const project = {
    files: [
      { id: "quiet", path: "quiet.mp4", metadata: { duration: 5 } },
      { id: "best", path: "best.mp4", metadata: { duration: 10 } }
    ]
  };

  it("uses the highest scoring segment and clamps to the source duration", () => {
    const cover = coverMoment({
      segments: [
        { fileId: "quiet", start: 1, duration: 4, score: 20 },
        { fileId: "best", start: 8, duration: 6, score: 90 }
      ]
    }, project);
    expect(cover?.sourcePath).toBe("best.mp4");
    expect(cover?.at).toBe(9.9);
  });

  it("returns null without a usable segment", () => {
    expect(coverMoment({ segments: [] }, project)).toBeNull();
    expect(coverMoment({ segments: [{ fileId: "missing", start: 0, duration: 2 }] }, project)).toBeNull();
  });
});

describe("publish sidecars", () => {
  it("writes JSON and TXT next to the MP4 without modifying it", async () => {
    const dir = await makeTempDir();
    const videoPath = path.join(dir, "draft.mp4");
    await writeFile(videoPath, "original mp4 bytes", "utf8");
    const metadata = buildUploadMetadata({
      project: { name: "GTA VI" },
      draft: { hookText: "Best moment" },
      preset: { id: "long" },
      durationSeconds: 120
    });

    const { jsonPath, textPath } = await writePublishFiles({ directory: dir, baseName: "draft", metadata });

    expect(await readFile(videoPath, "utf8")).toBe("original mp4 bytes");
    expect(JSON.parse(await readFile(jsonPath, "utf8")).title).toBe("Best moment");
    const text = await readFile(textPath, "utf8");
    expect(text).toBe(buildMetadataText(metadata));
    expect(text).toContain("Platform: youtube");
    expect(text).toContain("Title: Best moment");
  });
});
