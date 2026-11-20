// Lightweight helpers for the highlight review timeline.
//
// These stay dependency-free so the trim rail can offer snapping, zoomed
// regions, multi-select, and keyboard nudges without changing the planner or
// renderer.

export type TrimRange = { start: number; end: number };
export type ReviewWindow = TrimRange & { duration: number };

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function reviewTimelineWindow(
  item: { start: number; end: number },
  fileDuration: number,
  padding = 8
): ReviewWindow {
  const duration = Math.max(0, Number(fileDuration) || 0);
  if (!duration) return { start: 0, end: 0, duration: 0 };
  const startPoint = clamp(Number(item.start) || 0, 0, duration);
  const endPoint = clamp(Number(item.end) || startPoint, startPoint, duration);
  const pad = Math.max(0, Number(padding) || 0);
  let start = Math.max(0, startPoint - pad);
  let end = Math.min(duration, endPoint + pad);
  if (end - start > 60) {
    const center = (startPoint + endPoint) / 2;
    start = Math.max(0, center - 30);
    end = Math.min(duration, center + 30);
  }
  return { start: round(start), end: round(end), duration: round(end - start) };
}

export function timelinePercent(time: number, window: ReviewWindow) {
  if (!(window.duration > 0)) return 0;
  return round(clamp(((Number(time) || 0) - window.start) / window.duration, 0, 1) * 100, 3);
}

export function snapTrimValue({
  value,
  part,
  current,
  window,
  cues = [],
  threshold = 0.35
}: {
  value: number;
  part: "start" | "end";
  current: TrimRange;
  window: ReviewWindow;
  cues?: number[];
  threshold?: number;
}): number {
  const min = part === "start" ? window.start : window.start + 1;
  const max = part === "start" ? window.end - 1 : window.end;
  const bounded = clamp(Number(value) || 0, min, max);
  let best = bounded;
  let bestDistance = threshold;
  for (const cue of cues) {
    const candidate = Number(cue);
    if (!Number.isFinite(candidate) || candidate < window.start || candidate > window.end) continue;
    const distance = Math.abs(candidate - bounded);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return round(clamp(best, window.start, window.end));
}

export function nudgeTrimValue({
  value,
  direction,
  window,
  current,
  part,
  step = 0.5
}: {
  value: number;
  direction: -1 | 1;
  window: ReviewWindow;
  current: TrimRange;
  part: "start" | "end";
  step?: number;
}): number {
  const next = (Number(value) || 0) + direction * step;
  return snapTrimValue({ value: next, part, current, window, cues: [], threshold: 0 });
}

export type MultiSelectAction = {
  selected: string[];
  anchor: string;
};

export function updateMultiSelection({
  selected,
  anchor,
  id,
  ids,
  shiftKey = false,
  additive = false
}: {
  selected: string[];
  anchor: string;
  id: string;
  ids: string[];
  shiftKey?: boolean;
  additive?: boolean;
}): MultiSelectAction {
  const known = ids.includes(id);
  if (!known) return { selected, anchor };
  if (shiftKey) {
    const anchorIndex = Math.max(0, ids.indexOf(anchor || id));
    const idIndex = ids.indexOf(id);
    const from = Math.min(anchorIndex, idIndex);
    const to = Math.max(anchorIndex, idIndex);
    const range = ids.slice(from, to + 1);
    return { selected: [...new Set([...selected, ...range])], anchor: anchor || id };
  }
  if (additive) {
    const exists = selected.includes(id);
    return {
      selected: exists ? selected.filter((item) => item !== id) : [...selected, id],
      anchor: id
    };
  }
  return { selected: [id], anchor: id };
}
