# Export Specs

HighlightAI ships upload-ready MP4s and publishing sidecars. This document
records what each preset produces, how captions work, and how to verify an
export before uploading.

## Presets

| Preset | Resolution | Max duration | Video codec | Use it for |
| --- | --- | --- | --- | --- |
| `auto` (default) | Direction of the draft (1080x1920 or 1920x1080) | 180 s | H.264 High@4.2 | General editing, keeps the selected direction |
| `shorts` | 1080x1920 | 60 s | H.264 High@4.2 | YouTube Shorts |
| `reels` | 1080x1920 | 90 s | H.264 High@4.2 | Instagram Reels |
| `long` | 1920x1080 | 180 s | H.264 High@4.2 | YouTube / general 1080p uploads |
| `archive` | Direction of the draft | 180 s | HEVC Main | Smaller local archive files |

Notes:

- H.264 is the default because Instagram Reels and many desktop upload paths
  either reject or mishandle HEVC. `archive` keeps the old HEVC ladder.
- Every preset writes `-pix_fmt yuv420p`, `-movflags +faststart`, AAC audio at
  48 kHz stereo, and an integrated loudness target of -14 LUFS (true peak
  -1.5 dBTP) using `loudnorm`.
- `shorts` and `reels` force vertical framing regardless of the draft direction.
  `long` forces landscape.
- The 180-second hard cap in `server/policy.mjs` still applies to every preset.

## Vertical framing

When a horizontal recording is exported vertically, the app supports two modes:

- **Center crop** (default): scales to fill 1080x1920 and crops the sides. The
  `Framing bias` slider shifts the crop from -100% (left) to +100% (right) so
  the action stays in frame.
- **Blurred background**: shows the full frame letterboxed over a blurred fill.

Frame rate can be 30 or 60 fps. The planner and per-segment encodes both use the
chosen rate so the final file has a constant frame rate.

## HDR sources

If FFprobe reports a PQ (SMPTE 2084) or HLG transfer, each segment is tonemapped
to BT.709 SDR before the look/scale filters. This avoids washed-out or
over-bright exports from HDR capture.

## Captions and hooks

Caption generation is optional and local-first:

1. For each planned segment, FFmpeg extracts a 16 kHz mono MP3.
2. The audio is sent to any OpenAI-compatible `POST /v1/audio/transcriptions`
   endpoint (hosted API, `faster-whisper-server`, `whisper.cpp` server, ...).
3. Word timings are offset onto the final timeline and grouped into 1-2 line
   cues.
4. An ASS track is burned into the video and an SRT sidecar is written next to
   the MP4.

You can also import an `.srt`, `.vtt`, or plain `.txt` transcript in the create
panel. Imported SRT/VTT timestamps are treated as final-timeline timestamps;
plain text is distributed evenly across the final duration. An imported
transcript takes precedence over transcription endpoints, so no AI endpoint is
needed. The draft records `captionSource: "imported"` and the source file name
when an imported track is used.

If no endpoint or transcript is configured, the FFmpeg build lacks the `ass`
filter, or the request fails, the render continues without captions and records
a notice on the draft. Captions never block a render.

Three caption styles are available: `Clean impact`, `Bold pop`, and `Minimal`.
An optional opening hook can be pinned to the first ~2 seconds. It uses its own
ASS track, so it burns in even when captions are off and no transcription
endpoint is configured. If the FFmpeg build lacks the `ass` filter, the render
still succeeds and records a notice. Caption and hook styles use 9% side margins
and 20-22% bottom margins so text stays clear of vertical-player UI controls.

## Review timeline addons

The highlight review workspace stays local and lightweight:

- The trim rail keeps the full source-clip range, while a zoomed strip around
  the active candidate overlays an RMS waveform decoded by FFmpeg from only
  that region. A missing audio stream only hides the waveform.
- Snap guides mark nearby confirmed moments and other candidate boundaries.
  Dragging a trim handle snaps within 0.35 seconds; holding Shift with the
  arrow keys on a handle nudges it by 0.5 seconds without snapping.
- The playhead line follows video playback or scrubbing.
- The queue supports plain click (select one), Ctrl/Cmd+click (toggle one), and
  Shift+click (select a range), plus batch agree/skip/reject actions.
- Review shortcuts: Space plays/stops, `A` agrees, `S` skips, `X` rejects, and
  left/right arrows move between candidates when focus is not in a control.

These are UI/review addons only. They do not change planner, renderer, or
export semantics.

## Publishing pack

When `Create publishing pack` is enabled (the default), each render also writes
three files beside the MP4 using the same `projectId-draftId` base name:

| File | Contents |
| --- | --- |
| `<base>-cover.jpg` | A cover frame from the highest-scoring segment, scaled and cropped to the export resolution |
| `<base>.json` | Machine-readable title, description, tags, hashtags, platform, and duration |
| `<base>.txt` | The same details formatted for copy/paste into an upload form |

Titles and hashtags adapt to the preset: Shorts use YouTube Shorts tags, Reels
use Instagram Reels tags, and `long` produces general YouTube details. The
`Copy post details` button on a completed video reads the `.txt` sidecar and
copies it to the clipboard. The app never uploads anything; creators still
review the copy and asset licenses before publishing.

Sidecars are retained while their MP4 is referenced by a project and removed by
managed-storage cleanup when the MP4 is no longer referenced. If cover or
metadata generation fails, the render still completes and records a notice on
the draft.

## Music beat alignment

For `Trailer` style renders with a soundtrack, `server/audio-beats.mjs` builds a
local beat grid:

1. FFmpeg emits 50 ms RMS frames; silence is kept as a low finite value.
2. Positive loudness changes form an onset envelope.
3. Autocorrelation estimates a period in the 70-180 BPM range.
4. The strongest phase across that period is beat 1; every fourth beat is a
   downbeat.

The planner prefers beat and downbeat positions for cut boundaries, with a
bonus for downbeats, while preserving each segment's `minDuration` payoff
protection and the 180-second cap. Loudness peaks remain as a fallback when no
stable grid can be detected. The detected tempo, phase, beat count, and
downbeat count are saved in `musicPlan.beatGrid`, and each planned segment gets
`beatAligned` / `downbeatCut` flags.

No audio is sent anywhere: beat detection uses the local FFmpeg binary.

## Long recordings (VOD workflow)

The planner samples only a handful of windows per file, which is the wrong shape
for a multi-hour recording. Split long VODs first:

```powershell
npm run split:vod -- "D:\captures\full-session.mp4" --out "D:\captures\session-parts"
```

What it does:

- detects scene changes, loud audio peaks, and video keyframes;
- cuts 60-120 s parts (configurable with `--min` / `--max`);
- snaps boundaries to the nearest scene change, then audio peak;
- starts every part on a video keyframe so stream-copy durations stay accurate;
- overlaps neighbouring parts by 2 s so no highlight is lost on a cut;
- stream-copies instead of re-encoding, so it is fast and lossless;
- writes `split-manifest.json` with every part's planned start/end, planned and
  actual duration, and cut reason.

Then import the output folder into HighlightAI like any other clip folder.

Useful flags:

```text
--min 60         minimum clip length in seconds
--max 120        maximum clip length in seconds
--overlap 2      shared seconds between neighbouring clips
--scene 0.3      scene-change threshold (0.05-0.9)
--max-clips 90   safety cap
--dry-run        print the plan without writing files
```

## Verifying an export

```powershell
npm run verify:export -- "data\exports\my-video.mp4" --preset shorts
```

The script uses FFprobe/FFmpeg to assert:

- container is MP4 and contains audio + video;
- codec matches the preset (H.264 High, or HEVC Main for `archive`);
- resolution is 1080x1920 or 1920x1080 as expected;
- frame rate matches 30/60 fps;
- pixel format is `yuv420p`;
- `moov` is written before `mdat` (faststart);
- AAC audio at 48 kHz stereo;
- duration is within the preset cap;
- integrated loudness is within ±1.5 LU of -14 LUFS.

Pass `--json` for machine-readable output, `--fps 60` to expect 60 fps, or
`--no-loudness` to skip the loudness pass on very long files. The command exits
non-zero when a check fails, so it can gate a release step.
