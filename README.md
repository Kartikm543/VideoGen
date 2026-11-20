# HighlightAI

HighlightAI is a local-first editing assistant for turning long gameplay recordings into finished Shorts, Reels, and short long-form videos. It is built for editors who already understand pacing, hooks, and payoff: instead of scrubbing hours of footage from zero, you get a reviewable shortlist, precise trim control, and an upload-ready deliverable.

The app keeps the evidence behind every decision visible — what was scanned, what a model suggested, what you confirmed, what you rejected, and why a render proceeded or stopped. AI is optional; the core scan, review, and render stay on your machine.

## Preview

### App UI

The desktop workspace for importing recordings, reviewing candidate clips, configuring AI, and starting local render jobs.

![HighlightAI app UI](docs/assets/App.gif)

### Generated Video

An example final video rendered by HighlightAI from selected gameplay moments.

[Watch the generated video on YouTube](https://youtu.be/jIYO9-3kVyE)

![HighlightAI generated video](docs/assets/GenerateVideo.gif)

## What It Does

- **Brings footage in without duplicating the library.** Link a folder of short clips or one long VOD. Multi-hour sessions can be split into overlapping working parts so the same planning flow still applies.
- **Builds a “where to look” map.** It scans for scene changes, audio spikes, motion bursts, and likely opening points, then turns them into previewable candidate windows with thumbnails.
- **Adds an optional second pair of eyes.** Vision review can tag visible events and note uncertainty instead of silently guessing. You decide whether that opinion is useful.
- **Keeps the editorial call with you.** Trim against a local RMS waveform and snap guides, select several parts at once, skip a candidate for this pass, or permanently reject weak footage. Your confirmations lead later drafts; your rejections stay out.
- **Assembles a rough cut with editor logic.** The planner builds from confirmed moments first, then verified AI events, strong candidates, pre-indexed windows, and local-signal fallbacks. You can inspect the planned timeline before export and send it back for changes.
- **Makes Trailer cuts feel musical.** Beat/downbeat-aware alignment places cuts on the rhythm while protecting the payoff and the platform duration limit.
- **Finishes in the right shape.** Presets cover vertical Shorts/Reels and 1080p long-form, with crop or blur framing, sensible frame rates, HDR-safe color, and consistent playback loudness.
- **Adds hook and captions only when wanted.** A hook title burns into the opening seconds even with captions off. Captions can come from an imported SRT/VTT/TXT transcript or an optional transcription endpoint; an SRT sidecar is saved and failures never block the video.
- **Packages the handoff.** Alongside the MP4, it can write a cover still, upload notes, and metadata so the post is ready to hand to a social manager or scheduling tool.
- **Checks the delivery before posting.** A final check confirms frame size, frame rate, codec, color range, audio, duration, fast-start, and loudness against the chosen preset.

### How This Maps To Your Editing Toolkit

| If you normally use… | HighlightAI handles it as… |
| --- | --- |
| Binning and syncing footage | Linked folders or one long recording split into working parts |
| Scrubbing for selects | Local candidate windows with previews and thumbnails |
| Marking in/out, keeping, or rejecting | Waveform trim, snap guides, multi-select, confirm, skip, or permanent reject |
| Building a string-out | A draft planner that prioritizes your confirmed moments first |
| A trusted second opinion on a rough pass | Optional Vision review that surfaces uncertain calls instead of hiding them |
| Beat markers and rhythmic trimming | Local beat/downbeat alignment for Trailer-style edits |
| Adjustment layers, safe margins, and crop presets | Platform presets with vertical crop/blur and UI-safe text placement |
| An opening title or pattern interrupt | Hook text that burns in without needing captions or AI |
| Burn-in captions plus an SRT export | Imported transcript or optional transcription, burn-in, and sidecar delivery |
| Audio normalization and platform export | Compatible H.264 MP4s with controlled loudness and fast-start |
| A client deliverables folder | MP4, cover still, upload notes, and metadata written together |
| A final QC pass | `verify:export` against the selected preset |

Think of it as the selects assistant and delivery assistant wrapped around your existing editing judgment — not a black-box replacement for Premiere, Resolve, Final Cut, or CapCut.

## Architecture

```text
Electron desktop shell
  |
  | opens packaged app or Vite dev server
  v
React + Vite UI
  |
  | typed fetch client
  v
Express local API
  |
  | project JSON, job JSON, uploads, previews, thumbnails, exports
  v
Local data root
  |
  +-- FFprobe metadata probing
  +-- FFmpeg signal analysis and rendering
  +-- Optional Vision/Text AI endpoints
  +-- User highlight confirmations and rejections
```

### Frontend

The frontend lives in `src/`.

- `src/App.tsx` owns the main workflow: imports, project loading, clip library, highlight review, AI settings, background jobs, draft generation, render progress, and generated-video previews.
- `src/services/api.ts` is the typed local API client. It also sanitizes user-facing errors so raw FFmpeg logs, local paths, endpoints, and secrets do not leak into the UI.
- `src/services/analyzer.ts` contains formatting, duration, preset, and asset helpers.
- `src/config/exportPresets.ts` maps the selectable export presets to draft overrides (direction, duration, fps, framing, captions, publishing pack) for the create panel.
- `src/types.ts` defines the shared project, media, job, draft, review, and AI contracts.
- `src/App.path-panel.test.tsx` and `src/services/api.test.ts` cover UI workflow and API error-sanitization behavior.

During Vite development the client calls `http://127.0.0.1:4312/api`. In production it uses same-origin `/api` served by Express.

### Backend

The backend lives in `server/`.

- `server/index.mjs` starts the Express API, owns storage paths, serves media, manages ingest, fast indexing, Vision AI review, highlight confirmation/rejection, draft generation, render jobs, final review pauses, recovery, and cleanup.
- `server/media.mjs` wraps FFmpeg/FFprobe and contains candidate scoring, planning, segment alignment, visual-review edits, music extension, and rendering helpers. Shared JSON persistence lives in `server/json-store.mjs`, and the render duration cap lives in `server/policy.mjs`.
- `server/export-presets.mjs` defines the auto/shorts/reels/long/archive presets and resolves a draft to a concrete codec, resolution, fps, and duration cap.
- `server/captions.mjs` builds caption cues, ASS burn-in tracks, and SRT sidecars; `server/transcribe.mjs` talks to OpenAI-compatible `/v1/audio/transcriptions` endpoints.
- `server/publish.mjs` builds the cover frame and JSON/TXT upload-details sidecars written next to each MP4.
- `server/tools.mjs` resolves bundled FFmpeg binaries and runs child processes for the rest of the backend.
- `server/dev.mjs` runs the API and Vite dev server together.
- `server/media.test.ts` covers planning, review, and render-helper behavior.

The backend uses JSON files on disk rather than a database. Development data lives under `data/`. Packaged Electron builds set `HIGHLIGHTAI_DATA_ROOT` to the Electron user-data folder.

### Desktop Shell

The Electron shell lives in `desktop/`.

- `desktop/main.mjs` creates the window, starts the local API in packaged mode, waits for `/api/health`, and loads either the packaged app or Vite dev URL.
- `desktop/preload.cjs` exposes desktop-only operations such as choosing a local folder and showing exports in the OS file browser.

## Processing Flow

1. Import browser-selected files or link a local folder from the desktop shell.
2. Probe each video for duration, codecs, frame rate, resolution, bitrate, and audio availability.
3. Build local signals: scene changes, loudness peaks, action scores, highlight starts, thumbnails, previews, and candidate windows.
4. Optionally run Vision AI review. Results are saved as compact metadata: tags, traits, scores, events, attempts, AI decisions, and rejection reasons.
5. Review highlight candidates in the app. Users can trim and confirm useful periods, skip candidates for the current session, or save permanent not-highlight rejections.
6. Generate a draft. The planner prefers user-confirmed moments, then verified AI events, strong AI candidates, fast-index windows, and local-signal fallback moments.
7. Optionally run final visual review on the planned timeline. Approved timelines continue; revised timelines can be trimmed; rejected timelines enter a review-needed state.
8. Render locally with FFmpeg. Music can be omitted, used once, or repeated for a longer two-pass edit.
9. Save the export, caption SRT, cover frame, and upload-details sidecars under the local data root.

## Review Workflow

The current workflow is built around human-in-the-loop quality control:

- **AI verified** moments have a visible payoff and can feed generation directly.
- **Potential highlight** moments come from uncertain Vision AI timelines or fast-index windows.
- **Local signal** moments come from deterministic audio/scene/action analysis when AI evidence is weak.
- **Confirmed** moments are treated as high-confidence source material in future drafts.
- **Rejected** not-highlight ranges are removed from future candidate lists and draft plans.
- **Final review** can trim or reject planned shots before rendering. If it cannot approve the automatic timeline, the render job returns `needs_review` instead of silently exporting a weak video.

## AI Coverage Helper

The project includes a command-line helper for checking whether a local project has enough AI-reviewed or auto-usable source material:

```powershell
npm run ai:coverage
```

Configuration is read from environment variables:

```text
HIGHLIGHTAI_API=http://127.0.0.1:4312/api
PROJECT_ID=<optional project id>
VISION_ENDPOINT=http://127.0.0.1:11434/v1/chat/completions
VISION_MODEL=qwen2.5vl:7b
VISION_API_KEY=
MAX_CHECK_SECONDS=1800
FRAMES_PER_VIDEO=10
SAMPLE_INTERVAL=6
TARGET_RATE=95
```

The helper chooses the latest usable project when `PROJECT_ID` is not set, reports current coverage, checks model availability, optionally runs first-pass and refinement Vision AI review, then reports whether the target AI generation coverage passed.

## Project Layout

```text
desktop/              Electron main process and preload bridge
server/               Express API, job recovery, FFmpeg/AI orchestration
src/                  React app, API client, shared types, frontend tests
scripts/              Packaging, mock AI, coverage, icon, FFmpeg, and QA utilities
docs/                 Workflow notes, QA audit, assets, and engineering docs
build/                Source build assets such as app icons
data/                 Local runtime data, ignored by Git
dist/                 Vite production build, ignored by Git
release/              Electron package output, ignored by Git
vendor/               Prepared local FFmpeg assets, ignored by Git
```

## Runtime Data

`data/` is generated at runtime and intentionally ignored by Git. It can contain:

- uploaded files and linked project records;
- project JSON under `data/projects/`;
- background job JSON under `data/jobs/`;
- thumbnails, previews, preprocess frames, and temporary render files;
- rendered exports under `data/exports/`;
- AI review state, highlight confirmations, highlight rejections, and QA reports.

Large source recordings, generated videos, package outputs, tool state, logs, and local secrets are ignored in `.gitignore`.

## Requirements

- Node.js 20 or newer.
- npm.
- FFmpeg and FFprobe on `PATH`, or run the pinned local setup below.
- Optional: Ollama or another OpenAI-compatible multimodal endpoint for Vision AI.

## Install

```powershell
npm install
npm run setup:ffmpeg
```

`setup:ffmpeg` is checksummed and safe to rerun. It reuses `vendor/ffmpeg` when
its manifest still matches, and on Windows it can download and verify the pinned
FFmpeg 9.1 build if FFmpeg is not already available.

## Run

API only:

```powershell
npm run api
```

Vite frontend only:

```powershell
npm run dev
```

Full local web app:

```powershell
npm run dev:full
```

Desktop development:

```powershell
npm run desktop:dev
```

For a guided real-footage run — where to put source videos, where outputs are
written, and a first-test checklist — see `docs/LOCAL_TESTING.md`.

## Build And Verify

Production web build:

```powershell
npm run build
```

Windows portable desktop package:

```powershell
npm run package:win
```

Full verification:

```powershell
npm run verify
```

`npm run verify` runs the TypeScript build, Vite build, Vitest suite, and backend syntax checks.

Check a rendered export against the platform spec:

```powershell
npm run verify:export -- "data\exports\my-video.mp4" --preset shorts
```

Split a long recording before importing it:

```powershell
npm run split:vod -- "D:\captures\full-session.mp4" --out "D:\captures\session-parts"
```

See `docs/EXPORT_SPECS.md` for preset dimensions, caption behavior, and every
verification check.

## AI Configuration

Vision review is optional. The app can use local Ollama, a LAN-hosted server, or a cloud endpoint that exposes an OpenAI-compatible chat completions API.

Default local vision settings:

```text
Endpoint: http://127.0.0.1:11434/v1/chat/completions
Model: qwen2.5vl:7b
API key: blank
```

Local Ollama endpoints are capped to one active vision request to reduce GPU contention. LAN or cloud endpoints can use more workers through the app's AI settings.

## Privacy Model

- Raw footage stays local unless the user explicitly configures and starts AI review against an external endpoint.
- FFmpeg analysis and rendering run locally.
- Runtime project data is stored under `data/` in development or Electron user data in packaged builds.
- API keys for active AI jobs are kept in process memory and are not written to job JSON.
- User-facing errors are sanitized to avoid exposing low-level renderer output, local paths, endpoints, tokens, or secrets.
- Generated media and local project data are ignored by Git.

## License

MIT
