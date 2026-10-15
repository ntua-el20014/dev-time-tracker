/**
 * One ticking clock for every place that shows the session's active time
 * (sidebar rail, Home). Counts up locally from the activeSeconds main last
 * reported, and resyncs on every tracking-state broadcast.
 */
import { onTrackingState, type TrackingState } from "./trackingControls";

type Listener = (activeSeconds: number, state: TrackingState) => void;

const listeners = new Set<Listener>();
let state: TrackingState | null = null;
let baseSeconds = 0;
let baseAt = 0;
let ticker: ReturnType<typeof setInterval> | null = null;

export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function running(): boolean {
  return !!state?.isRecording && !state.isPaused;
}

/** Active seconds of the current session right now (0 when idle). */
export function currentSeconds(): number {
  const extra = running() ? Math.floor((Date.now() - baseAt) / 1000) : 0;
  return baseSeconds + extra;
}

function emit() {
  if (!state) return;
  const seconds = currentSeconds();
  for (const listener of listeners) listener(seconds, state);
}

onTrackingState((next) => {
  state = next;
  baseSeconds = next.isRecording ? next.activeSeconds ?? 0 : 0;
  baseAt = Date.now();
  if (ticker) clearInterval(ticker);
  ticker = running() ? setInterval(emit, 1000) : null;
  emit();
});

/** Calls `listener` now and every second while a session runs. */
export function onClockTick(listener: Listener) {
  listeners.add(listener);
  if (state) listener(currentSeconds(), state);
  return () => listeners.delete(listener);
}
