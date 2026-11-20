// Deterministic local FFmpeg preparation.
//
// Safe to run repeatedly:
//   - copies ffmpeg/ffprobe (+ DLLs on Windows) into vendor/ffmpeg
//   - records a manifest with every copied file's SHA-256
//   - reuses the existing bundle when every hash still matches
//   - downloads a pinned, checksum-verified Windows build when FFmpeg is not on PATH
//
// This script intentionally has no npm dependencies.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const destination = path.join(root, "vendor", "ffmpeg");
const manifestPath = path.join(destination, "manifest.json");
const cacheRoot = path.join(root, ".cache", "ffmpeg");

const pinned = {
  version: "9.1",
  platform: "windows-x86_64",
  archiveName: "ffmpeg-release-essentials.zip",
  sourceUrl: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
  sha256: "b9bbbb3accece000cbeec994f856649354e52c773807841e78908374b24d658fd"
};

function log(message) {
  process.stdout.write(`${message}\n`);
}

function binaryName(command) {
  return process.platform === "win32" ? `${command}.exe` : command;
}

function locate(command) {
  const configured = process.env.HIGHLIGHTAI_FFMPEG_DIR;
  if (configured) {
    const candidate = path.join(configured, binaryName(command));
    if (existsSync(candidate)) return candidate;
  }
  const resolver = process.platform === "win32" ? "where.exe" : "which";
  try {
    const output = execFileSync(resolver, [command], { encoding: "utf8" }).trim();
    return output.split(/\r?\n/)[0] || "";
  } catch {
    return "";
  }
}

function execFileSync(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} failed`);
  return result.stdout;
}

function toolVersion(executable) {
  try {
    const output = execFileSync(executable, ["-version"]);
    return output.split(/\r?\n/)[0]?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function runtimeFiles(sourceDirs) {
  const names = new Set();
  for (const sourceDir of sourceDirs) {
    if (!sourceDir) continue;
    for (const name of await readdir(sourceDir)) {
      if (/^(ffmpeg|ffprobe)(\.exe)?$/i.test(name) || /\.dll$/i.test(name)) names.add(name);
    }
  }
  const result = [];
  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const source = sourceDirs.map((dir) => dir && path.join(dir, name)).find((candidate) => candidate && existsSync(candidate));
    if (source) result.push({ name, source });
  }
  return result;
}

async function readManifest() {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function manifestMatches(manifest) {
  if (!manifest?.files || typeof manifest.files !== "object") return false;
  if (manifest.pinnedSha256 !== pinned.sha256) return false;
  for (const [name, expected] of Object.entries(manifest.files)) {
    const target = path.join(destination, name);
    if (!existsSync(target)) return false;
    if ((await sha256File(target)) !== expected) return false;
  }
  return true;
}

async function downloadPinnedArchive() {
  await mkdir(cacheRoot, { recursive: true });
  const archivePath = path.join(cacheRoot, pinned.archiveName);
  if (existsSync(archivePath) && (await sha256File(archivePath)) === pinned.sha256) {
    log(`Using cached FFmpeg archive ${archivePath}`);
    return archivePath;
  }

  log(`Downloading pinned FFmpeg ${pinned.version} from ${pinned.sourceUrl}`);
  const response = await fetch(pinned.sourceUrl);
  if (!response.ok || !response.body) throw new Error(`FFmpeg download failed: HTTP ${response.status}`);
  const hash = createHash("sha256");
  const parts = [];
  for await (const chunk of response.body) {
    hash.update(chunk);
    parts.push(Buffer.from(chunk));
  }
  const actual = hash.digest("hex");
  if (actual !== pinned.sha256) {
    throw new Error(`FFmpeg checksum mismatch.\n  expected ${pinned.sha256}\n  got      ${actual}`);
  }
  await writeFile(archivePath, Buffer.concat(parts));
  return archivePath;
}

async function findBinDir(rootDir) {
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === binaryName("ffmpeg").toLowerCase())
      && entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === binaryName("ffprobe").toLowerCase())) {
      return current;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
    }
  }
  return "";
}

async function extractPinnedArchive(staging) {
  const archivePath = await downloadPinnedArchive();
  await mkdir(staging, { recursive: true });
  const tar = process.platform === "win32"
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    : "tar";
  const result = spawnSync(tar, ["-xf", archivePath, "-C", staging], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || "Could not unpack FFmpeg archive");
  const binDir = await findBinDir(staging);
  if (!binDir) throw new Error("FFmpeg archive did not contain ffmpeg and ffprobe");
  return binDir;
}

async function main() {
  const existing = await readManifest();
  if (await manifestMatches(existing)) {
    log(`FFmpeg bundle is ready in ${destination} (${existing.version})`);
    return;
  }

  const ffmpegPath = locate("ffmpeg");
  const ffprobePath = locate("ffprobe");
  let sourceDirs = [ffmpegPath ? path.dirname(ffmpegPath) : "", ffprobePath ? path.dirname(ffprobePath) : ""].filter(Boolean);
  let sourceLabel = sourceDirs[0] || "PATH";

  if (!ffmpegPath || !ffprobePath || !existsSync(ffmpegPath) || !existsSync(ffprobePath)) {
    if (process.platform !== "win32" || process.arch !== "x64") {
      throw new Error("FFmpeg and FFprobe must be on PATH, or set HIGHLIGHTAI_FFMPEG_DIR to a folder containing both.");
    }
    const staging = path.join(cacheRoot, "staging");
    await rm(staging, { recursive: true, force: true });
    sourceLabel = await extractPinnedArchive(staging);
    sourceDirs = [sourceLabel];
  }

  const files = await runtimeFiles(sourceDirs);
  const ffmpeg = files.find((file) => file.name.toLowerCase() === binaryName("ffmpeg").toLowerCase());
  const ffprobe = files.find((file) => file.name.toLowerCase() === binaryName("ffprobe").toLowerCase());
  if (!ffmpeg || !ffprobe) throw new Error(`FFmpeg runtime is missing ${binaryName("ffmpeg")} or ${binaryName("ffprobe")}`);

  const stagingDestination = `${destination}.partial`;
  await rm(stagingDestination, { recursive: true, force: true });
  await mkdir(stagingDestination, { recursive: true });
  const hashes = {};
  for (const file of files) {
    await copyFile(file.source, path.join(stagingDestination, file.name));
    hashes[file.name] = await sha256File(file.source);
  }
  const manifest = {
    version: toolVersion(ffmpeg.source),
    pinnedSha256: pinned.sha256,
    source: sourceLabel,
    files: hashes
  };
  await writeFile(path.join(stagingDestination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await rm(destination, { recursive: true, force: true });
  await rename(stagingDestination, destination);
  log(`Bundled ${files.length} FFmpeg runtime files from ${sourceLabel}`);
  log(`Manifest: ${manifestPath}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
