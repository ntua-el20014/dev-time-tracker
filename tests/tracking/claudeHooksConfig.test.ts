import { describe, expect, it } from "vitest";
import {
  HOOK_EVENTS,
  hookEntry,
  hookStatus,
  hookUrl,
  isOurHook,
  lineDiff,
  parseSettings,
  planInstall,
  planUninstall,
} from "../../src/tracking/claudeHooksConfig";

const EP = { port: 47651, token: "t".repeat(43) };
const OTHER = { port: 50000, token: "o".repeat(43) };

/** A user's file with their own hooks and other settings. */
const USER_FILE = `{
    "theme": "dark",
    "hooks": {
        "PostToolUse": [
            {
                "matcher": "Write|Edit",
                "hooks": [{ "type": "command", "command": "prettier --write" }]
            }
        ],
        "PreToolUse": [
            { "matcher": "Bash", "hooks": [{ "type": "command", "command": "./guard.sh" }] }
        ]
    },
    "permissions": { "allow": ["Bash(npm test)"] }
}
`;

function installed(text: string | null, ep = EP): string {
  const plan = planInstall(text, ep);
  if (!plan.ok) throw new Error(plan.error);
  return plan.after;
}

describe("claudeHooksConfig", () => {
  it("recognises only its own hooks", () => {
    expect(isOurHook(hookEntry(EP))).toBe(true);
    expect(isOurHook({ type: "command", command: "curl.exe", args: ["-s", "http://localhost:9/dev-time-tracker/claude-hook"] })).toBe(true);
    expect(isOurHook({ type: "http", url: hookUrl(1234) })).toBe(true);
    expect(isOurHook({ type: "command", command: "curl", args: ["http://127.0.0.1:9/other"] })).toBe(false);
    expect(isOurHook({ type: "command", command: "curl", args: ["https://evil.example/dev-time-tracker/claude-hook"] })).toBe(false);
    // Someone else's script that happens to mention the URL
    expect(isOurHook({ type: "command", command: `./log.sh ${hookUrl(1234)}` })).toBe(false);
    expect(isOurHook({ type: "command", command: "wget", args: [hookUrl(1234)] })).toBe(false);
    expect(isOurHook(null)).toBe(false);
  });

  it("writes a background curl that posts stdin to the receiver, no shell involved", () => {
    expect(hookEntry(EP)).toEqual({
      type: "command",
      command: "curl",
      args: [
        "-s",
        "-m",
        "2",
        "-H",
        "Content-Type: application/json",
        "-H",
        `Authorization: Bearer ${EP.token}`,
        "--data-binary",
        "@-",
        "http://127.0.0.1:47651/dev-time-tracker/claude-hook",
      ],
      async: true,
    });
  });

  it("creates the settings when there is no file", () => {
    const plan = planInstall(null, EP);
    expect(plan.ok && plan.creates).toBe(true);
    const settings = JSON.parse(installed(null));
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS]);
    expect(settings.hooks.Stop).toEqual([{ hooks: [hookEntry(EP)] }]);
  });

  it("merges with existing hooks and settings, keeping their order and format", () => {
    const after = installed(USER_FILE);
    const settings = JSON.parse(after);
    expect(settings.theme).toBe("dark");
    expect(settings.permissions).toEqual({ allow: ["Bash(npm test)"] });
    // The user's PostToolUse group stays first, ours is appended
    expect(settings.hooks.PostToolUse).toHaveLength(2);
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Write|Edit");
    expect(isOurHook(settings.hooks.PostToolUse[1].hooks[0])).toBe(true);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    // 4-space indentation and the final newline are kept
    expect(after).toMatch(/\n {4}"theme"/);
    expect(after.endsWith("}\n")).toBe(true);
  });

  it("keeps CRLF line endings", () => {
    const crlf = USER_FILE.replace(/\n/g, "\r\n");
    const after = installed(crlf);
    expect(after.includes("\r\n")).toBe(true);
    expect(after.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("is idempotent and replaces an older endpoint instead of adding a second hook", () => {
    const once = installed(USER_FILE);
    expect(installed(once)).toBe(once);
    const plan = planInstall(once, EP);
    expect(plan.ok && plan.changed).toBe(false);

    const moved = JSON.parse(installed(installed(USER_FILE, OTHER), EP));
    for (const event of HOOK_EVENTS) {
      const ours = moved.hooks[event].flatMap((g: { hooks: unknown[] }) => g.hooks).filter(isOurHook);
      expect(ours).toHaveLength(1);
      expect(ours[0]).toEqual(hookEntry(EP));
    }
  });

  it("uninstalls to exactly the original settings", () => {
    const plan = planUninstall(installed(USER_FILE));
    expect(plan.ok && plan.changed).toBe(true);
    expect(plan.ok && JSON.parse(plan.after)).toEqual(JSON.parse(USER_FILE));
    expect(plan.ok && plan.after).toBe(USER_FILE);

    // A one-line file stays one line, and comes back byte for byte
    const compact = `{"theme":"dark","hooks":{"Stop":[{"hooks":[{"type":"command","command":"x"}]}]}}`;
    const added = installed(compact);
    expect(added.includes("\n")).toBe(false);
    expect(JSON.parse(added).hooks.Stop).toHaveLength(2);
    const removed = planUninstall(added);
    expect(removed.ok && removed.after).toBe(compact);
  });

  it("only adds lines: the user's own lines are kept byte for byte", () => {
    const diff = lineDiff(USER_FILE, installed(USER_FILE));
    expect(diff.filter((l) => l.op === "-")).toEqual([]);
  });

  it("removes the hooks object it created, and leaves a file without our hooks untouched", () => {
    const plain = `{\n  "theme": "dark"\n}\n`;
    const plan = planUninstall(installed(plain));
    expect(plan.ok && plan.after).toBe(plain);

    const untouched = planUninstall(USER_FILE);
    expect(untouched.ok && untouched.changed).toBe(false);
    expect(untouched.ok && untouched.after).toBe(USER_FILE);
  });

  it("only removes our hook from a group the user shares with it", () => {
    const shared = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "say done" },
              hookEntry(EP),
            ],
          },
        ],
      },
    });
    const plan = planUninstall(shared);
    expect(plan.ok && JSON.parse(plan.after)).toEqual({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
    });
  });

  it("refuses files it can't safely change", () => {
    expect(planInstall("{ not json", EP).ok).toBe(false);
    expect(planInstall("[1, 2]", EP).ok).toBe(false);
    expect(planInstall(`{"hooks": "nope"}`, EP).ok).toBe(false);
    expect(planInstall(`{"hooks": {"Stop": {}}}`, EP).ok).toBe(false);
    expect(planUninstall("{ not json").ok).toBe(false);
    // An empty file or a BOM is fine
    expect(planInstall("", EP).ok).toBe(true);
    expect(parseSettings('\uFEFF{"a":1}').ok).toBe(true);
  });

  it("warns about settings that would stop the hooks", () => {
    const plan = planInstall(JSON.stringify({ disableAllHooks: true, allowedHttpHookUrls: ["https://x/*"] }), EP);
    expect(plan.ok && plan.warnings).toHaveLength(2);
    const allowed = planInstall(JSON.stringify({ allowedHttpHookUrls: ["http://127.0.0.1:*"] }), EP);
    expect(allowed.ok && allowed.warnings).toEqual([]);
  });

  it("reports whether this endpoint is connected", () => {
    expect(hookStatus(null, null).state).toBe("not-connected");
    expect(hookStatus(USER_FILE, EP).state).toBe("not-connected");
    const after = installed(USER_FILE);
    expect(hookStatus(after, EP)).toMatchObject({ state: "connected", port: EP.port, events: [...HOOK_EVENTS] });
    // Someone else's token or port, or no saved connection: outdated
    expect(hookStatus(after, OTHER).state).toBe("outdated");
    expect(hookStatus(after, null).state).toBe("outdated");
    // One event's hook removed by hand
    const partial = JSON.parse(after);
    delete partial.hooks.Stop;
    expect(hookStatus(JSON.stringify(partial), EP).state).toBe("outdated");
    expect(hookStatus("{", EP).state).toBe("invalid");
  });

  it("diffs lines, folding unchanged ones", () => {
    const before = ["{", ...Array.from({ length: 10 }, (_, i) => `  "k${i}": ${i},`), '  "z": 0', "}"].join("\n");
    const after = before.replace('"k9": 9', '"k9": 99');
    const diff = lineDiff(before, after, 2);
    expect(diff.filter((l) => l.op === "-")).toEqual([{ op: "-", text: '  "k9": 9,' }]);
    expect(diff.filter((l) => l.op === "+")).toEqual([{ op: "+", text: '  "k9": 99,' }]);
    expect(diff[0]).toEqual({ op: "…", text: "8 unchanged lines" });
    expect(lineDiff("", "a\nb")).toEqual([
      { op: "+", text: "a" },
      { op: "+", text: "b" },
    ]);
    expect(lineDiff("a\r\nb\r\n", "a\nb\n")).toEqual([{ op: "…", text: "2 unchanged lines" }]);
  });
});
