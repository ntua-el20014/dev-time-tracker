import { describe, it, expect, beforeEach } from "vitest";
import {
  Segmenter,
  SEGMENT_GAP_SECONDS,
  PROJECT_SWITCH_SECONDS,
  type SegmentActivityInput,
  type SegmentEvent,
} from "../../src/tracking/segmenter";

const t = (seconds: number) =>
  new Date(Date.UTC(2026, 9, 18, 10, 0, 0) + seconds * 1000);

function input(
  now: number,
  idleSeconds: number,
  extra: Partial<SegmentActivityInput> = {},
): SegmentActivityInput {
  return {
    now: t(now),
    idleSeconds,
    idleTimeoutSeconds: 300,
    secondsSinceAgent: null,
    screenLocked: false,
    systemSuspended: false,
    ...extra,
  };
}

const closed = (events: SegmentEvent[]) =>
  events.flatMap((e) => (e.type === "closed" ? [e] : []));
const opened = (events: SegmentEvent[]) =>
  events.flatMap((e) => (e.type === "opened" ? [e] : []));

let links: Map<string, string>;
let seg: Segmenter;

beforeEach(() => {
  let n = 0;
  links = new Map([
    ["github.com/me/a", "P"],
    ["github.com/me/a2", "P"],
    ["github.com/me/c", "Q"],
  ]);
  seg = new Segmenter({
    newId: () => `id-${++n}`,
    projectOf: (key) => links.get(key) ?? null,
  });
});

/** Input every `step` seconds from `from` to `to` (inclusive). */
function workFrom(from: number, to: number, step = 2): SegmentEvent[] {
  const events: SegmentEvent[] = [];
  for (let s = from; s <= to; s += step) {
    events.push(...seg.observeActivity(input(s, 0)));
  }
  return events;
}

describe("Segmenter: opening and gaps", () => {
  it("opens only on human input, at the time of the input", () => {
    expect(seg.observeActivity(input(0, 120))).toEqual([]);
    // An agent working alone doesn't open a segment
    expect(
      seg.observeActivity(input(2, 400, { secondsSinceAgent: 1 })),
    ).toEqual([]);
    expect(seg.isOpen).toBe(false);

    const events = seg.observeActivity(input(10, 2));
    expect(events).toEqual([{ type: "opened", clientId: "id-1", start: t(8) }]);
    expect(seg.isOpen).toBe(true);
  });

  it("leaves away time out and keeps the segment through a short break", () => {
    seg.observeActivity(input(0, 0));
    seg.observeActivity(input(50, 0));
    // Idle past the 5-min timeout: paused back at the last input
    expect(seg.observeActivity(input(400, 350))).toEqual([]);
    expect(seg.isPaused).toBe(true);
    expect(seg.current(t(400))).toMatchObject({ duration: 50, end: t(50) });

    // Back after 10 minutes (< gap): same segment, resumed at the input
    expect(seg.observeActivity(input(650, 1))).toEqual([]);
    expect(seg.isPaused).toBe(false);
    expect(seg.current(t(700))).toMatchObject({
      clientId: "id-1",
      start: t(0),
      duration: 50 + 51,
      isPaused: false,
    });
  });

  it("ends the segment at the last sign of work once the gap has passed", () => {
    seg.observeActivity(input(0, 0));
    seg.observeActivity(input(50, 0));
    seg.observeActivity(input(400, 350));
    expect(
      seg.observeActivity(input(48 + SEGMENT_GAP_SECONDS, SEGMENT_GAP_SECONDS - 2)),
    ).toEqual([]);

    const events = seg.observeActivity(
      input(50 + SEGMENT_GAP_SECONDS, SEGMENT_GAP_SECONDS),
    );
    expect(closed(events)).toEqual([
      {
        type: "closed",
        reason: "idle",
        segment: expect.objectContaining({
          clientId: "id-1",
          start: t(0),
          end: t(50),
          duration: 50,
        }),
      },
    ]);
    expect(seg.isOpen).toBe(false);

    // The next input opens a new segment
    expect(opened(seg.observeActivity(input(2000, 0)))).toEqual([
      { type: "opened", clientId: "id-2", start: t(2000) },
    ]);
  });

  it("uses the gap even when the idle timeout is longer", () => {
    const long = { idleTimeoutSeconds: 3600 };
    seg.observeActivity(input(0, 0, long));
    seg.observeActivity(input(100, 0, long));
    const events = seg.observeActivity(input(1100, 1000, long));
    expect(closed(events)[0]).toMatchObject({
      reason: "idle",
      segment: { end: t(100), duration: 100 },
    });
  });

  it("keeps going while an agent works, as supervising time", () => {
    seg.observeActivity(input(0, 0));
    seg.observeActivity(input(120, 120, { secondsSinceAgent: 5 }));
    seg.observeActivity(input(1200, 1200, { secondsSinceAgent: 10 }));
    expect(seg.current(t(1200))).toMatchObject({
      duration: 1200,
      supervisingSeconds: 1080,
      isPaused: false,
    });

    // The agent stopped at 1300: paused there, nothing after it counts
    seg.observeActivity(input(2000, 2000, { secondsSinceAgent: 700 }));
    expect(seg.current(t(2000))).toMatchObject({
      end: t(1300),
      duration: 1300,
      supervisingSeconds: 1180,
      supervisingSpans: [[t(120).toISOString(), t(1300).toISOString()]],
    });
  });

  it("pauses at a lock (not backdated) and ends after the gap", () => {
    seg.observeActivity(input(0, 0));
    seg.observeActivity(input(100, 30, { screenLocked: true }));
    expect(seg.current(t(100))).toMatchObject({ duration: 100, isPaused: true });
    // Input at the lock screen doesn't resume it
    seg.observeActivity(input(200, 0, { screenLocked: true }));
    expect(seg.isPaused).toBe(true);

    const events = seg.observeActivity(
      input(100 + SEGMENT_GAP_SECONDS, 0, { screenLocked: true }),
    );
    expect(closed(events)[0]).toMatchObject({ segment: { end: t(100) } });
    expect(opened(events)).toEqual([]);
  });

  it("after a long sleep, closes the old segment and opens a new one on input", () => {
    seg.observeActivity(input(0, 0));
    seg.observeActivity(input(60, 0, { systemSuspended: true }));
    const events = seg.observeActivity(input(5000, 1));
    expect(events.map((e) => e.type)).toEqual(["closed", "opened"]);
    expect(closed(events)[0].segment).toMatchObject({ end: t(60), duration: 60 });
    expect(opened(events)[0].start).toEqual(t(4999));
  });

  it("end() closes a running segment now, a paused one at its pause", () => {
    seg.observeActivity(input(0, 0));
    expect(closed(seg.end(t(30)))[0]).toMatchObject({
      reason: "ended",
      segment: { end: t(30), duration: 30 },
    });
    expect(seg.end(t(40))).toEqual([]);

    seg.observeActivity(input(100, 0));
    seg.observeActivity(input(500, 350)); // paused at 150
    expect(closed(seg.end(t(600)))[0].segment).toMatchObject({
      start: t(100),
      end: t(150),
      duration: 50,
    });
  });
});

describe("Segmenter: projects", () => {
  it("starts in the last repo seen and adopts the first repo otherwise", () => {
    seg.observeRepo(t(0), "github.com/me/a");
    seg.observeActivity(input(1, 0));
    expect(seg.current(t(1))?.repoKey).toBe("github.com/me/a");
    seg.end(t(2));

    seg.reset();
    seg.observeActivity(input(10, 0));
    expect(seg.current(t(10))?.repoKey).toBeNull();
    expect(seg.observeRepo(t(15), "github.com/me/c")).toEqual([]);
    expect(seg.current(t(15))?.repoKey).toBe("github.com/me/c");
  });

  it("doesn't split between repos of the same project", () => {
    seg.observeRepo(t(0), "github.com/me/a");
    workFrom(0, 600);
    for (let s = 10; s <= 600; s += 5) {
      expect(seg.observeRepo(t(s), "github.com/me/a2")).toEqual([]);
    }
    expect(seg.current(t(600))?.clientId).toBe("id-1");
  });

  it("doesn't split for a short look at another project", () => {
    seg.observeRepo(t(0), "github.com/me/a");
    workFrom(0, 1000);
    seg.observeRepo(t(100), "github.com/me/c");
    seg.observeRepo(t(100 + PROJECT_SWITCH_SECONDS - 5), "github.com/me/c");
    seg.observeRepo(t(300), "github.com/me/a"); // back
    expect(seg.observeRepo(t(400), "github.com/me/c")).toEqual([]);
    expect(seg.observeRepo(t(400 + PROJECT_SWITCH_SECONDS - 5), "github.com/me/c")).toEqual([]);
    expect(seg.current(t(1000))?.clientId).toBe("id-1");
  });

  it("splits at the move once work stays in another project", () => {
    seg.observeRepo(t(0), "github.com/me/a");
    workFrom(0, 520);
    // Supervising from 580 across the move is split too
    seg.observeActivity(input(580, 60, { secondsSinceAgent: 1 }));
    expect(seg.observeRepo(t(600), "github.com/me/c")).toEqual([]);
    workFrom(602, 600 + PROJECT_SWITCH_SECONDS);

    const events = seg.observeRepo(t(600 + PROJECT_SWITCH_SECONDS), "github.com/me/c");
    expect(events).toEqual([
      {
        type: "closed",
        reason: "project",
        segment: expect.objectContaining({
          clientId: "id-1",
          start: t(0),
          end: t(600),
          duration: 600,
          supervisingSeconds: 20,
          repoKey: "github.com/me/a",
        }),
      },
      { type: "opened", clientId: "id-2", start: t(600) },
    ]);
    expect(seg.current(t(600 + PROJECT_SWITCH_SECONDS))).toMatchObject({
      clientId: "id-2",
      start: t(600),
      duration: PROJECT_SWITCH_SECONDS,
      supervisingSeconds: 2,
      repoKey: "github.com/me/c",
      isPaused: false,
    });
  });

  it("treats an unlinked repo as its own work, and linking it doesn't split", () => {
    seg.observeRepo(t(0), "github.com/me/b");
    workFrom(0, 400);
    expect(seg.current(t(400))?.repoKey).toBe("github.com/me/b");

    // The user links b to P; moving on to a (also P) is the same work
    links.set("github.com/me/b", "P");
    seg.observeRepo(t(200), "github.com/me/a");
    expect(seg.observeRepo(t(400), "github.com/me/a")).toEqual([]);

    // Unlinked repo d is different work from P
    seg.observeRepo(t(400), "github.com/me/d");
    workFrom(402, 400 + PROJECT_SWITCH_SECONDS);
    const events = seg.observeRepo(t(400 + PROJECT_SWITCH_SECONDS), "github.com/me/d");
    expect(closed(events)[0].segment.repoKey).toBe("github.com/me/b");
    expect(seg.current(t(600))?.repoKey).toBe("github.com/me/d");
  });

  it("ignores repos while paused, and relabels instead of splitting off nothing", () => {
    seg.observeRepo(t(0), "github.com/me/a");
    seg.observeActivity(input(0, 0));
    seg.observeActivity(input(400, 400)); // paused at 0: nothing counted
    expect(seg.observeRepo(t(500), "github.com/me/c")).toEqual([]);

    seg.observeActivity(input(600, 0));
    seg.observeRepo(t(600), "github.com/me/c");
    workFrom(602, 600 + PROJECT_SWITCH_SECONDS);
    // Nothing counted in a before the move: the segment becomes c's
    expect(seg.observeRepo(t(600 + PROJECT_SWITCH_SECONDS), "github.com/me/c")).toEqual([]);
    expect(seg.current(t(800))).toMatchObject({
      clientId: "id-1",
      repoKey: "github.com/me/c",
    });
  });
});
