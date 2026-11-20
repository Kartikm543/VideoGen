# TODOs

## Design Debt

- [x] Add a concise `DESIGN.md` for VideoGen's app UI rules.
  - What: Document the design contract for dense local video workflow UI, status copy, AI override language, density controls, close buttons, and responsive card behavior.
  - Why: Prevent visual and copy drift from returning after the current generation-review workflow fixes.
  - Pros: High leverage, small file, useful for future design reviews and implementation.
  - Cons: Adds one docs artifact to maintain.
  - Context: The 2026-07-01 plan design review found no existing `DESIGN.md`; several issues came from design rules living only in scattered JSX/CSS.
  - Depends on / blocked by: None.

- [x] Make the generation checkpoint explicit in the app UI.
  - What: Update dashboard, create-sidebar, and review copy so users understand that Generate video first creates a plan, then enters a required Review and complete checkpoint before render.
  - Why: Prevent the workflow from feeling broken when a user clicks Generate and lands in review instead of immediately getting an export.
  - Pros: Reduces confusion around empty review queues, already-reviewed clips, add-more recovery, and music-length warnings.
  - Cons: Requires a small copy and UI consistency pass across several locations.
  - Context: The 2026-07-01 plan design review approved making generation review a named required checkpoint and previewing that checkpoint before the user clicks Generate.
  - Depends on / blocked by: None.

## Shorts / Reels Export Upgrade

- [x] Add H.264 export presets for Shorts, Reels, 1080p, and a HEVC archive copy.
  - What: `server/export-presets.mjs` plus `src/config/exportPresets.ts` resolve a preset to codec, resolution, fps, framing, and duration cap.
  - Why: HEVC-only output was rejected or mangled by Reels and desktop upload paths.
  - Context: `auto` keeps the historical direction but now encodes H.264; `archive` retains HEVC.

- [x] Normalize the final mix to -14 LUFS and remove double per-segment loudness.
  - What: Final `amix`/render stage applies `loudnorm=I=-14:TP=-1.5:LRA=11`; per-segment loudness was removed for non-trailer styles.

- [x] Add HDR tonemapping, vertical crop bias, and blurred-background framing.
  - What: PQ/HLG sources are tonemapped to BT.709; vertical exports support a -100%..+100% crop bias or a blurred fill.

- [x] Add optional burned-in captions with an SRT sidecar.
  - What: OpenAI-compatible `/v1/audio/transcriptions` word timings are offset onto the final timeline, burned via ASS, and exported as SRT.
  - Why: Shorts/Reels retention depends heavily on on-screen captions.
  - Context: Captions never block a render; failures add a draft notice.

- [x] Split long VODs into overlapping 60-120 s parts.
  - What: `scripts/split-vod.mjs` (`npm run split:vod`) detects scene cuts and audio peaks, stream-copies parts, and writes `split-manifest.json`.
  - Why: The planner samples only a handful of windows per file, so multi-hour recordings need to be pre-cut.

- [x] Add an export verification script.
  - What: `scripts/verify-export.mjs` (`npm run verify:export`) asserts container, codec/profile, resolution, fps, pixel format, faststart, audio format, duration cap, and loudness.

- [x] Add automatic beat/downbeat phrase alignment.
  - What: `server/audio-beats.mjs` detects local tempo, phase, and 4/4 downbeats; the trailer planner prefers those cut points.
  - Why: Current music sync was based only on loudness peaks and could cut before a payoff.
  - Status: Beat grid is saved in `musicPlan.beatGrid`; segments carry `beatAligned` and `downbeatCut` flags.

- [ ] Add small speed ramps on impact frames.
  - What: Apply subtle, duration-preserving video/audio ramps into downbeat cuts.
  - Why: Adds a stronger physical hit to Shorts and Reels edits.
  - Depends on / blocked by: Real-footage A/V sync validation on the new beat grid.

- [x] Add thumbnail and upload-metadata export.
  - What: Export a cover frame and a JSON/TXT pack with title, description, tags, and hashtags.
  - Why: Shorts/Reels publishing needs a cover and copy; manual steps slow the workflow.
  - Status: Wired into render output with preset-aware platform details, clipboard copy in the completed-video panel, and sidecar-aware storage cleanup.

- [ ] Add multi-clip batch export with duplicate detection.
  - What: Render several drafts from one folder in one action and skip near-duplicate action windows.
  - Why: Creators publish multiple Shorts per session.
  - Depends on / blocked by: Visual embeddings or sequence-level duplicate checks.
