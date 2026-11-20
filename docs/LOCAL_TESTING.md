# Local Run And Real-Footage Test Guide

This guide is for running HighlightAI on your machine and testing it with your
own gameplay or travel recordings. It covers setup, where videos and outputs
live, and a short checklist for a realistic first test.

## 1. What this project is

HighlightAI is a local-first video editor for gameplay highlights. It does not
upload your footage to render anything. A small React frontend talks to a local
Express API, which uses FFmpeg/FFprobe and optional AI endpoints.

```text
React + Vite UI  ->  Express local API  ->  FFmpeg / FFprobe
      |                    |
      |                    +-- project JSON, jobs, uploads, exports on disk
      +-- browser or Electron desktop shell
```

Main pieces:

- `src/` — React UI, API client, export preset controls, review screens.
- `server/index.mjs` — Express routes, background jobs, storage cleanup.
- `server/media.mjs` — planning, scoring, music alignment, rendering.
- `server/audio-beats.mjs` — local tempo/beat/downbeat detection.
- `server/captions.mjs`, `server/transcribe.mjs` — optional captions.
- `server/publish.mjs` — cover frame + upload metadata sidecars.
- `scripts/split-vod.mjs` — splits one long VOD into overlapping clips.
- `scripts/verify-export.mjs` — checks a finished MP4 against export specs.

All runtime data lives under `data/` by default. That folder is ignored by Git.

## 2. Requirements

- Node.js 20 or newer.
- npm.
- FFmpeg and FFprobe.

Check FFmpeg first:

```powershell
ffmpeg -version
ffprobe -version
```

If they are not on `PATH`, run the deterministic setup once. It copies
FFmpeg/FFprobe into `vendor/ffmpeg`, records SHA-256 hashes in a manifest, and
reuses the checked bundle on later runs:

```powershell
npm install
npm run setup:ffmpeg
```

On Windows, if no FFmpeg is found on `PATH`, the setup script downloads the
pinned FFmpeg 9.1 essentials build, verifies its SHA-256, and caches the archive
under `.cache/ffmpeg`. You can also point the app at an existing folder for one
terminal session:

```powershell
$env:HIGHLIGHTAI_FFMPEG_DIR = "C:\path\to\ffmpeg\bin"
```

That folder must contain `ffmpeg.exe` and `ffprobe.exe` on Windows, or the
matching binaries on macOS/Linux.

Optional: an OpenAI-compatible multimodal endpoint for Vision AI and an
OpenAI-compatible `/v1/audio/transcriptions` endpoint for captions. Neither is
required. Rendering works without them.

## 3. Install and run

### Copy/paste quick start

Run these from a PowerShell terminal at the repository root. The static FFmpeg
folder used during full verification in this workspace is FFmpeg 9.1.

```powershell
cd C:\Users\susar\VideoGen
npm install
npm run setup:ffmpeg
npm run dev:full
```

If you are using the temporary FFmpeg folder instead of the prepared bundle:

```powershell
$env:PATH = "C:\Users\susar\AppData\Local\Temp\opencode\ffmpeg\ffmpeg-9.1-essentials_build\bin;" + $env:PATH
```

Then open:

```text
http://localhost:5173
```

`npm run dev:full` starts **both** the API on port 4312 and Vite on port 5173.
Do not run `npm run api` separately unless you want API-only mode.

Install once:

```powershell
npm install
```

Recommended for local web testing — starts the API on port 4312 and Vite on
port 5173:

```powershell
npm run dev:full
```

Then open:

```text
http://localhost:5173
```

Other ways to run:

```powershell
npm run api          # API only, http://127.0.0.1:4312
npm run dev          # Vite only, expects the API to already be running
npm run build        # production frontend build
npm start            # serve built frontend + API on http://127.0.0.1:4312
npm run desktop:dev  # Electron development shell
```

To use a separate test data folder, set it before starting the app:

```powershell
$env:HIGHLIGHTAI_DATA_ROOT = "D:\VideoGenTestData"
npm run dev:full
```

## 4. Where to put source videos

You do not copy files into a special folder by hand. Use the UI:

- **Upload videos** in the browser picks files and copies them into
  `data/uploads/`.
- **Check a folder** in the Electron desktop shell links a folder in place. The
  original files stay where they are; only the project JSON records their paths.

Supported inputs are anything FFmpeg can decode — normally `.mp4`, `.mov`,
`.mkv`, or `.webm`. Short clips of roughly 10–120 seconds work best. A few good
clips are better than many weak ones.

For one long VOD, split it first:

```powershell
npm run split:vod -- "D:\captures\gta-vi-session.mp4" --out "D:\captures\gta-vi-session-parts"
```

Then import the output folder like any other clip folder. The splitter writes
`split-manifest.json` next to the parts.

## 5. First real test checklist

1. Start the app with `npm run dev:full` and open `http://localhost:5173`.
2. Import 5–10 short clips, or the folder produced by `split:vod`.
3. Wait for background analysis to finish. The clip cards will show local
   scores, candidate windows, thumbnails, and previews.
4. Select the clips you care about. Optional: set an AI endpoint in Settings and
   run Vision AI review first. You can skip this for the first test.
5. In the create panel, choose an export preset:
   - `YouTube Short` — 1080x1920, up to 60 seconds.
   - `Instagram Reel` — 1080x1920, up to 90 seconds.
   - `1080p upload` — 1920x1080, up to 3 minutes.
6. Optional settings:
   - **Frame rate**: 30 or 60 fps.
   - **Vertical framing**: center crop with framing bias, or blurred background.
   - **Burn in captions**: import an SRT/VTT/TXT transcript, or configure a transcription endpoint. Imported transcripts take precedence and need no AI endpoint; the render continues
     without captions if neither is available.
   - **Opening hook text**: shown for the first couple of seconds. This is a
     lightweight addon: it burns in without captions, transcription, Vision AI,
     Ollama, or cloud keys.
   - **Create publishing pack**: on by default; writes a cover and upload
     details beside the MP4.
7. Choose music if you want a scored edit. Beat/downbeat-aware cuts run for
   `Trailer` style with a soundtrack. Without music, the render uses game audio.
8. Click **Generate video**. In review, use the RMS waveform and snap guides to
   trim the visible region. Ctrl/Cmd+click or Shift+click selects multiple queue
   parts for batch agree/skip/reject; Space, `A`, `S`, `X`, and arrow keys are
   also available. Confirm or trim the proposed cuts.
9. Click **Render MP4** and wait for the progress bar to reach 100%.
10. The completed video appears in the create panel with playback, export
    details, cover image, and a **Copy post details** button.

For several different Shorts from one source file, repeat steps 5–10 with
different confirmed/trimmed moments. If the source is short, the automatic
planner may otherwise pick the same strongest moment every time.

## 6. Where outputs are

By default, finished files are under `data/exports/`:

```text
data/exports/<projectId>-<draftId>.mp4          final video
data/exports/<projectId>-<draftId>.srt          captions, when enabled
data/exports/<projectId>-<draftId>-cover.jpg    cover frame
data/exports/<projectId>-<draftId>.json         upload metadata
data/exports/<projectId>-<draftId>.txt          copy/paste post details
```

The UI also shows the completed video and, in the Electron shell, offers **Show
in Explorer** for the exact MP4 path. Exports are served from
`/media/exports/<filename>`.

Other runtime folders:

| Path | Contents |
| --- | --- |
| `data/uploads/` | Copies of browser-uploaded source videos |
| `data/projects/` | Project records: files, metadata, drafts, reviews, decisions |
| `data/jobs/` | Background ingest, index, preprocess, and render job state |
| `data/thumbnails/` | Regenerable source clip thumbnails |
| `data/previews/` | Regenerable source clip previews |
| `data/tmp/` | Temporary render and analysis work; cleared at startup |

Storage cleanup keeps exports while a project draft still references them and
removes orphaned files at startup. Do not delete a project JSON if you want to
keep its exports.

## 7. Verify a finished MP4

```powershell
npm run verify:export -- "data\exports\<projectId>-<draftId>.mp4" --preset shorts
```

Use `--preset reels`, `--preset long`, or `--preset archive` as appropriate. Add
`--fps 60` for a 60 fps export. The verifier checks container, codec, profile,
resolution, frame rate, pixel format, faststart, audio format, duration cap, and
loudness.

Full-range source footage is converted to limited-range `yuv420p` during render.
If an older export reports `yuvj420p`, rebuild with the latest code and render
again.

Run the full local check with:

```powershell
npm run verify
```

That runs the production build, the whole test suite, and syntax checks for the
backend modules and scripts.

## 8. Common issues

- **FFmpeg errors immediately**: run `npm run setup:ffmpeg` once, or make sure
  `ffmpeg` and `ffprobe` are both reachable. Check with `ffmpeg -version` and
  `ffprobe -version`, or set `HIGHLIGHTAI_FFMPEG_DIR`.
- **Port 4312 is busy**: stop the other service or set `PORT` before starting the
  API. If you change the API port from 4312, the Vite proxy in `vite.config.ts`
  must be updated too.
- **Captions are missing**: import an SRT/VTT/TXT transcript, or configure an
  OpenAI-compatible transcription endpoint in Settings. Captions are optional and
  never block a render.
- **No cover or metadata files**: make sure `Create publishing pack` is enabled
  before generating the draft. Render notices on the draft explain any failure.
- **Exports disappeared**: startup cleanup removes exports that are no longer
  referenced by a project draft. Keep the project JSON if you want the files.

## 9. Music alignment behavior

`server/audio-beats.mjs` runs FFmpeg locally, reads 50 ms RMS frames, builds an
onset envelope, estimates tempo by autocorrelation, and chooses the strongest
phase as beat 1. Every fourth beat is marked as a downbeat. The planner uses
those points together with older loudness peaks and prefers downbeats for
Trailer cuts, while still protecting each segment's minimum payoff duration and
the 180-second hard cap.

The result is recorded on the draft under `musicPlan.beatGrid`:

```json
{
  "bpm": 120,
  "period": 0.5,
  "phase": 0,
  "beats": 17,
  "downbeats": 5,
  "method": "onset-autocorrelation"
}
```

Planned segments also carry `beatAligned` and `downbeatCut` flags. This makes it
easy to confirm that the feature ran during a real test.
