// End-to-end test of the packaged app against the real Supabase project,
// using two test accounts in two isolated app instances, driven over CDP.
// Credentials come from .env.local and are never printed.
//
// Usage (repo root, after `npm run package`):  npm run test:e2e
// Needs in .env.local: DTT_TEST_EMAIL_1/DTT_TEST_PASSWORD_1 (becomes the
// org admin) and DTT_TEST_EMAIL_2/DTT_TEST_PASSWORD_2, both confirmed users;
// SUPABASE_URL / SUPABASE_ANON_KEY come from .env. Creates and then deletes
// a session; account 2 ends up in a fresh personal org. Windows only; needs
// git and curl (a scratch repo and Connect Claude Code cover C2/C3).
import { spawn, execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import os from "os";
import path from "path";

const repo = process.argv[2] || process.cwd();
const work = process.argv[3] || path.join(os.tmpdir(), "dtt-e2e");
const exe = path.join(repo, "out", "dev-time-tracker-win32-x64", "dev-time-tracker.exe");

function readEnv(file) {
  const out = {};
  try {
    for (const line of readFileSync(path.join(repo, file), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return out;
}
const env = { ...readEnv(".env"), ...readEnv(".env.local") };
const creds = [
  { email: env.DTT_TEST_EMAIL_1, password: env.DTT_TEST_PASSWORD_1 },
  { email: env.DTT_TEST_EMAIL_2, password: env.DTT_TEST_PASSWORD_2 },
];
const SUPA = { url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY };
const redact = (s) =>
  [creds[0].email, creds[0].password, creds[1].email, creds[1].password, SUPA.key]
    .filter(Boolean)
    .reduce((t, v) => t.split(v).join("<redacted>"), String(s));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const results = [];
const check = (name, cond, extra = "") => {
  const line = `${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + redact(extra) : ""}`;
  console.log(line);
  results.push(line);
  if (!cond) failed++;
};

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

async function launch(name, port) {
  const dir = path.join(work, name);
  mkdirSync(path.join(dir, "profile"), { recursive: true });
  mkdirSync(path.join(dir, "home"), { recursive: true });
  // Keep painting while the window is covered by other windows; otherwise
  // Chromium stops producing frames and screenshots wait forever.
  const child = spawn(exe, [
    `--remote-debugging-port=${port}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ], {
    env: {
      ...process.env,
      DTT_USER_DATA_DIR: path.join(dir, "profile"),
      USERPROFILE: path.join(dir, "home"),
      SENTRY_DSN: "",
    },
    stdio: "ignore",
  });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error(`${name}: no window`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push("EXCEPTION " + (d.exception?.description || d.text || "").split("\n")[0]);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      errors.push("console.error " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const mid = ++id;
      pending.set(mid, r);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  const ev = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text);
    }
    return res.result?.result?.value;
  };
  const invoke = (channel, ...args) =>
    ev(`window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})
          .then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e && e.message || e) }))`);
  const waitFor = async (expression, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await ev(expression)) return true;
      } catch {}
      await sleep(300);
    }
    return false;
  };
  const shot = async (file) => {
    const s = await Promise.race([
      send("Page.captureScreenshot", { format: "png" }),
      sleep(10000).then(() => null),
    ]);
    if (s?.result?.data) writeFileSync(path.join(work, file), Buffer.from(s.result.data, "base64"));
    else console.log(`(screenshot ${file} skipped: no frame within 10s)`);
  };
  const kill = () => {
    try { ws.close(); } catch {}
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" }); } catch {}
  };
  return { name, ev, invoke, waitFor, shot, kill, errors };
}

async function login(app, { email, password }) {
  await app.waitFor(`!!document.getElementById("loginOption")`);
  await app.ev(`document.getElementById("loginOption").click()`);
  await app.waitFor(`!!document.getElementById("modal-password")`);
  await app.ev(`(() => {
    document.getElementById("modal-email").value = ${JSON.stringify(email)};
    document.getElementById("modal-password").value = ${JSON.stringify(password)};
    document.getElementById("customModalForm").requestSubmit();
  })()`);
  return app.waitFor(`document.getElementById("mainUI").style.display !== "none"`, 20000);
}

// Fill and submit the session-info modal that appears after Stop
async function answerSessionInfo(app, title) {
  const shown = await app.waitFor(`!!document.getElementById("sessionInfoForm")`, 10000);
  if (!shown) return false;
  await app.ev(`(() => {
    document.getElementById("session-title").value = ${JSON.stringify(title)};
    document.getElementById("session-description").value = "e2e";
    document.getElementById("session-billable-status").value = "true";
    document.getElementById("sessionInfoForm").requestSubmit();
  })()`);
  return true;
}

// Raw PostgREST call as one of the test users, from this script — what an
// attacker with a valid account could do outside the app. The app's page
// can't do this itself: it has no token and its CSP blocks Supabase.
const tokens = {};
async function tokenFor(app) {
  const i = app.name === "user2" ? 1 : 0;
  if (!tokens[i]) {
    const r = await fetch(`${SUPA.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPA.key, "Content-Type": "application/json" },
      body: JSON.stringify(creds[i]),
    });
    tokens[i] = (await r.json()).access_token;
  }
  return tokens[i];
}
async function rawApi(app, method, pathAndQuery, body) {
  const r = await fetch(`${SUPA.url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: SUPA.key,
      Authorization: `Bearer ${await tokenFor(app)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.text()).slice(0, 300) };
}

const apps = [];
try {
  if (!creds[0].email || !creds[1].email || !SUPA.url || !SUPA.key) throw new Error("missing env");

  // ── User 1: sign in, tabs, record a session ─────────────────────
  const u1 = await launch("user1", 9341);
  apps.push(u1);
  check("user 1 signs in", await login(u1, creds[0]));
  await sleep(3000);
  // Main owns the session: the page holds no token and can't reach Supabase
  check(
    "renderer keeps no Supabase session",
    await u1.ev(`!Object.keys(localStorage).some(k => k.startsWith("sb-"))`),
  );
  check(
    "renderer can't reach Supabase (CSP)",
    (await u1.ev(`fetch(${JSON.stringify(SUPA.url + "/rest/v1/")}).then(() => "reached", () => "blocked")`)) === "blocked",
  );
  check(
    "handlers outside the IPC allowlist are unreachable",
    (await u1.invoke("delete-user", "x")).ok === false,
  );
  check(
    "main knows who is signed in",
    (await u1.invoke("auth:get-user")).v?.email?.toLowerCase() === creds[0].email.toLowerCase(),
  );
  // First login in a fresh profile shows the onboarding tour — skip it
  await u1.ev(`[...document.querySelectorAll("button, a")].find(b => b.textContent.trim() === "Skip Tour")?.click()`);
  await sleep(500);
  const p1 = (await u1.invoke("org:get-current-user-profile")).v;
  const org1 = (await u1.invoke("org:get-current")).v;
  check("user 1 has a profile and personal org (created by signup trigger)", !!p1?.id && !!org1?.id, `${p1?.username} / ${org1?.name}`);
  check("user 1 is admin of it", p1?.role === "admin");
  await u1.shot("u1-dashboard.png");

  // ── C2/C3 setup: a scratch repo, and Connect Claude Code (hooks) ──
  // The hook events below put the repo into the session (an agent working
  // in it), so the session's code stats come from this repo.
  const gitRepo = path.join(work, "dtt-e2e-repo");
  const git = (...args) => execSync(`git ${args.map((a) => JSON.stringify(a)).join(" ")}`, { cwd: gitRepo, stdio: "pipe" }).toString();
  const lines = (...l) => l.map((x) => x + "\n").join("");
  mkdirSync(gitRepo, { recursive: true });
  git("init", "-q");
  git("config", "user.email", "e2e@example.invalid");
  git("config", "user.name", "E2E");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("remote", "add", "origin", "https://github.com/dtt-e2e/dtt-e2e-repo.git");
  writeFileSync(path.join(gitRepo, "app.ts"), lines("const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;", "const e = 5;"));
  git("add", "app.ts");
  git("commit", "-q", "-m", "initial");
  // Untracked before the session: must not count
  writeFileSync(path.join(gitRepo, "old.txt"), lines("old", "old"));
  mkdirSync(path.join(work, "user1", "home", ".claude"), { recursive: true });
  const preview = (await u1.invoke("preview-claude-hooks", "connect")).v;
  check("Connect Claude Code: preview offered", preview?.ok === true && preview?.changed === true, preview?.error || "");
  const applied = (await u1.invoke("apply-claude-hooks", { action: "connect", baseHash: preview?.baseHash })).v;
  check("Connect Claude Code: applied", applied?.ok === true, applied?.error || "");
  let hookEp = null;
  try {
    hookEp = JSON.parse(readFileSync(path.join(work, "user1", "profile", "claude-hooks.json"), "utf8"));
  } catch {}
  const hook = (event) =>
    fetch(`http://127.0.0.1:${hookEp?.port}/dev-time-tracker/claude-hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${hookEp?.token}` },
      body: JSON.stringify({ session_id: "e2e-agent-session", cwd: gitRepo, ...event }),
    }).then((r) => r.status, () => 0);

  // Sidebar: every visible view, and every visible sub-view inside it
  const navVisible = (view) => u1.ev(`!document.querySelector('.nav-item[data-view="${view}"]').hidden`);
  check("solo user: Team is not in the sidebar", !(await navVisible("team")));
  const views = await u1.ev(`[...document.querySelectorAll(".nav-item[data-view]")].filter(n => !n.hidden).map(n => n.dataset.view)`);
  for (const view of views) {
    await u1.ev(`document.querySelector('.nav-item[data-view="${view}"]').click()`);
    await sleep(2500);
    const subs = await u1.ev(`[...document.querySelectorAll('#view-${view} .subnav-btn')].filter(b => !b.hidden).map(b => b.dataset.sub)`);
    for (const sub of subs.length ? subs : [null]) {
      if (sub) {
        await u1.ev(`document.querySelector('#view-${view} .subnav-btn[data-sub="${sub}"]').click()`);
        await sleep(2500);
      }
      const name = sub ? `${view}/${sub}` : view;
      const len = await u1.ev(`(document.querySelector('#view-${view} ${sub ? `.subview[data-sub="${sub}"]` : ""}')?.innerText || "").trim().length`);
      check(`view "${name}" renders`, len > 0, `${len} chars`);
      await u1.shot(`u1-view-${name.replace("/", "-")}.png`);
    }
  }
  await u1.ev(`document.querySelector('.nav-item[data-view="billing"]').click()`);
  check("Billing shows the monthly summary", await u1.waitFor(`/Billable Hours/.test(document.getElementById("billingContent")?.innerText || "")`, 8000));
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);
  const timerIdle = await u1.ev(`document.getElementById("navTimerStatus").textContent`);
  check("rail timer says not recording", timerIdle === "Not recording", timerIdle);

  // ── Projects: create through the form, archive, restore ─────────
  const projName = `E2E Project ${new Date().toISOString().slice(11, 19)}`;
  await u1.ev(`document.querySelector('.nav-item[data-view="projects"]').click()`);
  await u1.waitFor(`!!document.getElementById("newProjectBtn")`, 8000);
  await u1.ev(`document.getElementById("newProjectBtn").click()`);
  check("New Project form opens", await u1.waitFor(`!!document.getElementById("projectForm")`, 5000));
  check("solo user is not offered an organization project", !(await u1.ev(`!!document.querySelector('#projectForm input[name="scope"]')`)));
  await u1.ev(`(() => {
    document.getElementById("project-name").value = ${JSON.stringify(projName)};
    document.getElementById("project-hourly-rate").value = "80";
    document.getElementById("projectForm").requestSubmit();
  })()`);
  check("created project appears on the Projects page", await u1.waitFor(`[...document.querySelectorAll("#projectsContent .project-name")].some(e => e.textContent === ${JSON.stringify(projName)})`, 10000));
  const findProj = async () => ((await u1.invoke("get-all-projects-with-members")).v || []).find((p) => p.name === projName);
  const proj = await findProj();
  check("project saved as personal with the rate", proj?.scope === "personal" && Number(proj?.hourly_rate) === 80, JSON.stringify(proj && { scope: proj.scope, rate: proj.hourly_rate }));
  await u1.invoke("delete-project", proj?.id);
  const archivedProj = await findProj();
  check("archived project is still listed (was lost before)", !!archivedProj && archivedProj.archived === true && archivedProj.is_active === false);
  await u1.invoke("restore-project", proj?.id);
  check("restored project is active again", (await findProj())?.is_active === true);
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);

  // ── Record: pick the project on Home, start there, stop from the rail ──
  const title = `E2E session ${new Date().toISOString().slice(11, 19)}`;
  check("Home offers the new project before Start", await u1.waitFor(`!!document.querySelector('#homeProjectSelect option[value=${JSON.stringify(String(proj?.id))}]')`, 10000));
  await u1.ev(`(() => {
    const sel = document.getElementById("homeProjectSelect");
    sel.value = ${JSON.stringify(String(proj?.id))};
    sel.dispatchEvent(new Event("change"));
  })()`);
  check("choosing a project tells main", await u1.waitFor(`true`, 1) && (await u1.invoke("get-tracking-state")).v?.projectId === proj?.id);
  await u1.ev(`document.getElementById("homeStartBtn").click()`);
  check("Home Start starts tracking (rail button agrees)", await u1.waitFor(`document.getElementById("recordBtn").title === "Finish Recording"`, 5000));
  check("Home timer shows the project", await u1.waitFor(`(document.getElementById("homeTimerStatus")?.textContent || "").includes(${JSON.stringify(projName)})`, 5000));
  const startedAt = Date.now();
  // An agent starts working in the scratch repo (the repo is snapshotted)
  check("hook receiver accepts an event", (await hook({ hook_event_name: "UserPromptSubmit" })) === 200);
  check("Home shows the agent as working in the repo", await u1.waitFor(`(document.getElementById("view-home")?.innerText || "").includes("dtt-e2e-repo")`, 5000));
  const agents = (await u1.invoke("get-tracking-state")).v?.liveAgents || [];
  check("tracking state lists the live agent", agents.some((a) => a.status === "working" && a.repoName === "dtt-e2e-repo"), JSON.stringify(agents));
  await sleep(2000);
  // During the session: one commit (+4), an uncommitted edit (+3 −1) and a
  // new untracked file (+2) → +9 −1 · 3 files · 1 commit
  writeFileSync(path.join(gitRepo, "feature.ts"), lines("export function f() {", "  return 42;", "}", "export const g = f();"));
  git("add", "feature.ts");
  git("commit", "-q", "-m", "feature");
  writeFileSync(path.join(gitRepo, "app.ts"), lines("const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;", "const e = 50;", "const f = 6;", "const g = 7;"));
  writeFileSync(path.join(gitRepo, "util.py"), lines("def util():", "    return 1"));
  check("hook receiver accepts the Stop event", (await hook({ hook_event_name: "Stop" })) === 200);
  await sleep(Math.max(0, startedAt + 13000 - Date.now()));
  const clock = await u1.ev(`document.getElementById("navTimerClock").textContent`);
  check("rail timer counts the session", /^0:00:1\d$/.test(clock), clock);
  const homeClock = await u1.ev(`document.getElementById("homeTimerClock").textContent`);
  check("Home timer counts the same session", /^0:00:1\d$/.test(homeClock), homeClock);
  check("timeline shows the running session", await u1.ev(`!!document.querySelector("#homeTimeline .today-bar.running")`));
  const totalsText = await u1.ev(`document.querySelector("#homeTimeline .timeline-totals")?.textContent || ""`);
  check("timeline totals count the running session", /tracked/.test(totalsText), totalsText);
  await u1.shot("u1-home-recording.png");
  await u1.ev(`document.getElementById("recordBtn").click()`);
  const modalShown = await u1.waitFor(`!!document.getElementById("sessionInfoForm")`, 10000);
  const billingDefault = await u1.ev(`document.getElementById("session-billable-status")?.value`);
  check("Stop dialog preselects Billable for a project with a rate", modalShown && billingDefault === "true", billingDefault);
  check("stop shows the session-info modal", await answerSessionInfo(u1, title));
  let saved;
  for (let i = 0; i < 20 && !saved; i++) {
    await sleep(500);
    const sessions = (await u1.invoke("get-sessions", { limit: 5 })).v || [];
    saved = sessions.find((s) => s.title === title);
  }
  check("session saved to Supabase", !!saved);
  check("saved with active duration ≥ 10s", (saved?.duration ?? 0) >= 10, `duration=${saved?.duration}`);
  check("saved with end_time (needs new schema trigger)", !!saved?.end_time);
  check("saved as billable", saved?.is_billable === true);
  check("saved with the project chosen before Start", saved?.project_id === proj?.id, String(saved?.project_id));
  check("session date is the local day", saved?.date === new Date().toLocaleDateString("en-CA"), saved?.date);

  // ── C2: code stats of the session, from the scratch repo ────────
  const repoStats = (saved?.code_stats || []).find((s) => s.repo_key === "github.com/dtt-e2e/dtt-e2e-repo");
  check("code_stats has the repo the agent worked in", !!repoStats, JSON.stringify(saved?.code_stats));
  check(
    "code stats: 1 commit, 3 files, +9 −1",
    repoStats?.commits === 1 && repoStats?.files_changed === 3 && repoStats?.lines_added === 9 && repoStats?.lines_removed === 1,
    JSON.stringify(repoStats),
  );
  check(
    "code stats per language: TypeScript +7 −1, Python +2",
    repoStats?.languages?.TypeScript?.added === 7 && repoStats?.languages?.TypeScript?.removed === 1 && repoStats?.languages?.Python?.added === 2,
    JSON.stringify(repoStats?.languages),
  );
  check("code stats keep no paths or file names", !/feature\.ts|util\.py|app\.ts|\\/.test(JSON.stringify(saved?.code_stats || [])));
  const contains = encodeURIComponent(JSON.stringify([{ repo_key: "github.com/dtt-e2e/dtt-e2e-repo", commits: 1, lines_added: 9 }]));
  const rawStats = await rawApi(u1, "GET", `time_tracking_sessions?id=eq.${saved?.id}&code_stats=cs.${contains}&select=id`);
  check("code_stats stored in the database (JSONB query)", rawStats.status === 200 && rawStats.body.includes(String(saved?.id)), `HTTP ${rawStats.status} ${rawStats.body}`);
  const badStats = await rawApi(u1, "PATCH", `time_tracking_sessions?id=eq.${saved?.id}`, { code_stats: { not: "an array" } });
  check("database rejects code_stats that isn't an array", badStats.status >= 400, `HTTP ${badStats.status}`);
  // App usage travels with the session; nothing per tick is uploaded
  const details = (await u1.invoke("get-usage-details-for-session", saved?.id)).v;
  check("session details carry app_usage", Array.isArray(details?.session?.app_usage), JSON.stringify(details?.session?.app_usage));
  check("session is a confirmed manual one", saved?.status === undefined || saved?.status === "confirmed");
  const noLogs = await rawApi(u1, "GET", "usage_logs?select=id&limit=1");
  check("there is no usage_logs table", noLogs.status === 404, `HTTP ${noLogs.status}`);
  await u1.ev(`document.querySelector('.nav-item[data-view="sessions"]').click()`);
  await u1.ev(`document.querySelector('#view-sessions .subnav-btn[data-sub="list"]').click()`);
  await u1.waitFor(`[...document.querySelectorAll(".summary-filter-btn")].some(b => b.textContent === "Summary by Session")`, 8000);
  await u1.ev(`[...document.querySelectorAll(".summary-filter-btn")].find(b => b.textContent === "Summary by Session").click()`);
  check("Sessions list shows the code line", await u1.waitFor(`[...document.querySelectorAll(".session-code")].some(e => e.textContent === "+9 −1 · 3 files · 1 commit")`, 10000));
  await u1.shot("u1-sessions-code.png");
  await u1.ev(`document.querySelector('#view-sessions .subnav-btn[data-sub="insights"]').click()`);
  check("Insights shows Code changed with the repo and languages", await u1.waitFor(`(() => {
    const t = document.querySelector('#view-sessions .subview[data-sub="insights"]')?.innerText || "";
    return /Code changed/.test(t) && t.includes("dtt-e2e-repo") && t.includes("TypeScript") && t.includes("Python");
  })()`, 10000));
  await u1.shot("u1-insights-code.png");
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);

  check("Home timeline shows the saved session", await u1.waitFor(`[...document.querySelectorAll("#homeTimeline .today-bar")].some(b => b.getAttribute("aria-label").includes(${JSON.stringify(title)}))`, 10000));
  await u1.shot("u1-home-after.png");

  // The session is billed under its project
  await u1.ev(`document.querySelector('.nav-item[data-view="billing"]').click()`);
  check("Billing lists the project's billable session", await u1.waitFor(`(document.querySelector(".billable-projects-table")?.innerText || "").includes(${JSON.stringify(projName)})`, 10000));

  // ── C6: per-project activity, agent cost in Billing and invoices ──
  // An agent session in the project, as the transcript ingest uploads it
  const agentRow = await rawApi(u1, "POST", "agent_sessions", {
    user_id: p1.id, source: "claude-code", external_id: `e2e-${Date.now()}`,
    repo_key: "github.com/dtt-e2e/dtt-e2e-repo", repo_name: "dtt-e2e-repo", project_id: proj?.id,
    started_at: new Date(startedAt).toISOString(), ended_at: new Date().toISOString(),
    active_seconds: 600, cost_usd: 1.25,
  });
  check("agent session in the project uploaded", agentRow.status === 201, `HTTP ${agentRow.status} ${agentRow.body}`);
  const localDay = new Date().toLocaleDateString("en-CA");
  const activity = ((await u1.invoke("get-project-activity", { startDate: localDay, endDate: localDay })).v || []).find((a) => a.projectId === proj?.id);
  check(
    "project activity: your time, agent time and cost, code",
    activity?.sessions === 1 && activity.humanSeconds + activity.supervisingSeconds === saved?.duration &&
      activity.agent?.activeSeconds === 600 && activity.agent?.costUsd === 1.25 && activity.code?.linesAdded === 9,
    JSON.stringify(activity),
  );
  // The agent row came from outside the app: re-render on the next visit
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);
  await u1.ev(`window.markTabsDirty("projects", "billing")`);
  await u1.ev(`document.querySelector('.nav-item[data-view="projects"]').click()`);
  const cardText = `([...document.querySelectorAll(".project-card")].find(c => c.querySelector(".project-name")?.textContent === ${JSON.stringify(projName)})?.innerText || "")`;
  check(
    "Projects card shows your time, AI agents with cost, and code",
    await u1.waitFor(`(() => { const t = ${cardText}; return /your time/i.test(t) && t.includes("10m · $1.25 · 1 session") && t.includes("+9 −1 · 3 files · 1 commit"); })()`, 10000),
    await u1.ev(`${cardText}.slice(0, 600)`),
  );
  await u1.shot("u1-projects-activity.png");
  await u1.ev(`document.querySelector('.nav-item[data-view="billing"]').click()`);
  check(
    "Billing shows the AI agent cost apart from earnings",
    await u1.waitFor(`(() => { const t = document.getElementById("billingContent")?.innerText || ""; return /AI Agent Cost/i.test(t) && t.includes("$1.25"); })()`, 10000),
  );
  await u1.shot("u1-billing-agent-cost.png");
  await u1.ev(`document.querySelector('.billable-invoice-btn[data-project-id=${JSON.stringify(String(proj?.id))}]').click()`);
  check(
    "invoice offers the agent cost as a line item",
    await u1.waitFor(`(() => { const r = document.getElementById("invoice-agent-cost-row"); return !!r && !r.hidden && r.textContent.includes("$1.25"); })()`, 10000),
  );
  await u1.ev(`(() => { const b = document.getElementById("invoice-include-agent-cost"); b.checked = true; b.dispatchEvent(new Event("change")); })()`);
  check(
    "invoice summary adds the agent cost when ticked",
    await u1.waitFor(`(document.getElementById("invoice-summary")?.textContent || "").includes("+ $1.25 AI agents")`, 5000),
  );
  await u1.shot("u1-invoice-agent-cost.png");
  await u1.ev(`document.getElementById("cancel-invoice-modal")?.click()`);
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);

  // Server-side org attribution of the session
  const raw = await rawApi(u1, "GET", `time_tracking_sessions?id=eq.${saved?.id}&select=org_id`);
  check("session org_id set by the server", raw.status === 200 && raw.body.includes(org1?.id ?? "x"));

  // Usage summary write path (what the batcher uses), via raw RPC as user 1
  const today = new Date().toLocaleDateString("en-CA");
  for (let i = 0; i < 2; i++) {
    await rawApi(u1, "POST", "rpc/update_daily_usage_summary", {
      p_user_id: p1.id, p_date: today, p_app_name: "E2E Browser", p_language: null,
      p_language_extension: null, p_icon_url: null, p_time_spent_seconds: 10,
    });
  }
  const dus = await rawApi(u1, "GET", `daily_usage_summary?app_name=eq.E2E%20Browser&date=eq.${today}&select=time_spent_seconds,org_id`);
  check("NULL-language usage upserts into one row", dus.status === 200 && /^\[\{"time_spent_seconds":20,/.test(dus.body), dus.body);
  const todayTab = (await u1.invoke("get-logs", today)).v || [];
  check("Today data includes the usage row", todayTab.some((r) => r.app === "E2E Browser"));

  // ── C5: browser time by category (what the batcher writes for a browser) ──
  const browserRows = [["code-review", 10], ["code-review", 10], ["docs", 10], [null, 10]];
  for (const [category, seconds] of browserRows) {
    await rawApi(u1, "POST", "rpc/update_daily_usage_summary", {
      p_user_id: p1.id, p_date: today, p_app_name: "Chrome", p_language: null,
      p_language_extension: null, p_icon_url: null, p_time_spent_seconds: seconds, p_category: category,
    });
  }
  const catRows = await rawApi(u1, "GET", `daily_usage_summary?app_name=eq.Chrome&date=eq.${today}&select=category,time_spent_seconds&order=category.asc.nullslast`);
  check(
    "one summary row per browser category, NULL category upserts too",
    catRows.status === 200 &&
      JSON.stringify(JSON.parse(catRows.body)) ===
        JSON.stringify([
          { category: "code-review", time_spent_seconds: 20 },
          { category: "docs", time_spent_seconds: 10 },
          { category: null, time_spent_seconds: 10 },
        ]),
    catRows.body,
  );
  const chromeToday = ((await u1.invoke("get-logs", today)).v || []).find((r) => r.app === "Chrome");
  check(
    "Today's Chrome row breaks down by category",
    JSON.stringify(chromeToday?.categories) === JSON.stringify([{ category: "code-review", seconds: 20 }, { category: "docs", seconds: 10 }, { category: null, seconds: 10 }]),
    JSON.stringify(chromeToday?.categories),
  );
  const browserUsage = (await u1.invoke("get-browser-usage", { startDate: today, endDate: today })).v || [];
  check("browser usage per category for a range", browserUsage[0]?.category === "code-review" && browserUsage[0]?.seconds === 20, JSON.stringify(browserUsage));
  await u1.ev(`localStorage.removeItem("cached_today_logs")`);
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);
  await u1.ev(`document.getElementById("appActivity").open = true`);
  check(
    "App activity shows the browser categories",
    await u1.waitFor(`(document.querySelector("#logTable")?.innerText || "").includes("Code review 20s")`, 10000),
    await u1.ev(`(document.querySelector("#logTable")?.innerText || "").slice(0, 300)`),
  );
  await u1.ev(`document.getElementById("appActivity").scrollIntoView()`);
  await u1.shot("u1-app-activity-browser.png");
  await u1.ev(`document.getElementById("appActivity").open = false`);
  await u1.ev(`window.markTabsDirty("insights")`);
  await u1.ev(`document.querySelector('.nav-item[data-view="sessions"]').click()`);
  await u1.ev(`document.querySelector('#view-sessions .subnav-btn[data-sub="insights"]').click()`);
  check(
    "Insights shows browser time by category",
    await u1.waitFor(`(() => { const t = document.getElementById("insights-browser")?.innerText || ""; return /Browser time/.test(t) && t.includes("Code review") && t.includes("Other browsing"); })()`, 10000),
  );
  await u1.ev(`document.getElementById("insights-browser").scrollIntoView()`);
  await u1.shot("u1-insights-browser.png");
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);
  await rawApi(u1, "DELETE", `daily_usage_summary?app_name=eq.Chrome&date=eq.${today}`);

  // Invite code
  const inv = await u1.invoke("org:generate-invite-code", { max_uses: 1, expires_in_days: 1 });
  check("admin generates an invite code", inv.ok && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(inv.v?.code ?? ""), inv.e);

  // ── User 2: sign in, escalation attempts, join with code ────────
  const u2 = await launch("user2", 9342);
  apps.push(u2);
  check("user 2 signs in", await login(u2, creds[1]));
  await sleep(2500);
  const p2 = (await u2.invoke("org:get-current-user-profile")).v;
  const org2before = (await u2.invoke("org:get-current")).v;
  check("user 2 has their own org", !!org2before?.id && org2before.id !== org1?.id);

  let r = await rawApi(u2, "PATCH", `user_profiles?id=eq.${p2.id}`, { org_id: org1.id, role: "admin" });
  check("ATTACK blocked: user 2 moves self into user 1's org as admin", r.status >= 400, `HTTP ${r.status}`);
  r = await rawApi(u2, "POST", "rpc/get_user_profile_by_id", { p_user_id: p1.id });
  check("ATTACK blocked: user 2 reads user 1's profile", r.status === 200 && r.body === "[]", r.body);
  r = await rawApi(u2, "POST", "rpc/get_organization_members_by_org_id", { p_org_id: org1.id });
  check("ATTACK blocked: user 2 lists user 1's org members", r.status === 200 && r.body === "[]", r.body);
  r = await rawApi(u2, "POST", "rpc/create_personal_organization", { user_id: p1.id, org_name: "hijack" });
  check("ATTACK blocked: user 2 moves user 1 into a new org", r.status >= 400, `HTTP ${r.status}`);
  r = await rawApi(u2, "GET", `time_tracking_sessions?user_id=eq.${p1.id}&select=id`);
  check("ATTACK blocked: user 2 reads user 1's sessions", r.status === 200 && r.body === "[]", r.body);
  r = await rawApi(u2, "POST", "time_tracking_sessions", {
    user_id: p2.id, org_id: org1.id, start_time: new Date().toISOString(), duration: 60, title: "forged org", is_billable: false,
  });
  check("ATTACK neutralised: forged org_id on a session is replaced", r.status === 201 && !r.body.includes(org1.id), `HTTP ${r.status}`);
  const forgedId = (r.body.match(/"id":"([0-9a-f-]{36})"/) || [])[1];
  if (forgedId) await rawApi(u2, "DELETE", `time_tracking_sessions?id=eq.${forgedId}`);

  const join = await u2.invoke("org:join-with-code", inv.v.code.toLowerCase());
  check("user 2 joins with the code", join.ok, join.e);
  const org2after = (await u2.invoke("org:get-current")).v;
  check("user 2 is now in user 1's org", org2after?.id === org1.id);
  const p2after = (await u2.invoke("org:get-current-user-profile")).v;
  check("as employee", p2after?.role === "employee");
  r = await rawApi(u2, "PATCH", `user_profiles?id=eq.${p2.id}`, { role: "admin" });
  check("ATTACK blocked: employee promotes self", r.status >= 400, `HTTP ${r.status}`);

  // ── User 1 manages user 2 ───────────────────────────────────────
  const members = (await u1.invoke("org:get-members", org1.id)).v || [];
  check("admin sees both members", members.length === 2, `${members.length}`);
  const promote = await u1.invoke("org:update-user-role", p2.id, "manager");
  check("admin promotes user 2 to manager", promote.v === true);
  const p2role = (await u2.invoke("org:get-current-user-profile")).v;
  check("user 2 is manager", p2role?.role === "manager");

  // Team appears for user 1 now that the org has two members. The join
  // happened in user 2's app, so user 1 re-checks on organization:changed
  // (in real use: window focus, or an org change made in this window).
  await u1.ev(`window.dispatchEvent(new Event("organization:changed"))`);
  check("Team appears once the org has another member", await u1.waitFor(`!document.querySelector('.nav-item[data-view="team"]').hidden`, 8000));

  // Team → Analytics as admin
  await u1.ev(`document.querySelector('.nav-item[data-view="team"]').click()`);
  await u1.ev(`document.querySelector('#view-team .subnav-btn[data-sub="analytics"]').click()`);
  // The analytics queries can take a few seconds; wait for the KPIs
  await u1.waitFor(`/TOTAL SESSIONS\s*\d+/i.test(document.getElementById("teamAnalyticsContent")?.innerText || "")`, 20000);
  const taText = await u1.ev(`document.getElementById("teamAnalyticsContent")?.innerText || ""`);
  check("team analytics renders for admin", taText.trim().length > 0);
  const range = { start: new Date(Date.now() - 86400000).toLocaleDateString("en-CA"), end: new Date(Date.now() + 86400000).toLocaleDateString("en-CA") };
  const ras = await rawApi(u1, "POST", "rpc/get_org_analytics_summary", { p_org_id: org1.id, p_start_date: range.start, p_end_date: range.end });
  check("analytics RPC counts the session", ras.status === 200 && /"total_sessions":[1-9]/.test(ras.body), ras.body);
  const shownSessions = Number((taText.match(/TOTAL SESSIONS\s*(\d+)/i) || [])[1] ?? -1);
  check("Team Analytics refreshed after the session was saved (was stale)", shownSessions >= 1, `shows ${shownSessions}`);
  await u1.shot("u1-team-analytics.png");

  // Organization project with user 2 as a member (role "member" — the old
  // Projects tab sent "employee", which the CHECK constraint rejected)
  const orgProjName = `E2E Org Project ${new Date().toISOString().slice(11, 19)}`;
  const orgProj = (await u1.invoke("create-project", orgProjName, "", "#22aa88", 100, "organization")).v;
  check("admin creates an organization project", orgProj?.scope === "organization" && orgProj?.org_id === org1.id, JSON.stringify(orgProj && { scope: orgProj.scope, org: orgProj.org_id }));
  const added = await u1.invoke("add-project-member", orgProj?.id, p2.id, "member");
  check("project manager adds user 2 as a member", !!added.v, JSON.stringify(added));
  const listed = ((await u1.invoke("get-all-projects-with-members")).v || []).find((p) => p.id === orgProj?.id);
  check("org project lists its member", (listed?.members || []).some((m) => m.user_id === p2.id));
  const seenByU2 = ((await u2.invoke("get-projects-for-user")).v || []).some((p) => p.id === orgProj?.id);
  check("org member can pick the org project (Stop dialog list)", seenByU2);
  if (orgProj?.id) await rawApi(u1, "DELETE", `cloud_projects?id=eq.${orgProj.id}`);

  const remove = await u1.invoke("org:remove-user", p2.id);
  check("admin removes user 2 (remove_org_member)", remove.v === true || remove.ok, JSON.stringify(remove));
  const membersAfter = (await u1.invoke("org:get-members", org1.id)).v || [];
  check("org back to one member", membersAfter.length === 1);
  const org2final = (await u2.invoke("org:get-current")).v;
  check("user 2 has no org after removal", !org2final);

  // Restore user 2 to a personal org so the accounts are reusable
  const restore = await u2.invoke("org:create-personal", "E2E Test Org");
  check("user 2 creates a personal org again", restore.ok && !!restore.v);

  // ── Phase D: always-on, drafts and the review inbox ─────────────
  // Segments open on real OS input, which this script can't produce, so the
  // drafts are inserted the way the tracker saves them (draft, auto, client_id)
  const onRes = await u1.invoke("set-always-on", true);
  check("always-on can be turned on", onRes.v === true && (await u1.invoke("get-always-on")).v === true);
  check("tracking state reports always-on", (await u1.invoke("get-tracking-state")).v?.alwaysOn === true);
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const draftSpec = [
    { from: 180, to: 150, project_id: proj?.id ?? null, app_usage: [{ app: "VS Code", language: "TypeScript", category: null, seconds: 1500 }] },
    { from: 140, to: 120, project_id: proj?.id ?? null, app_usage: [{ app: "VS Code", language: "TypeScript", category: null, seconds: 900 }] },
    { from: 100, to: 90, project_id: null, app_usage: [] },
  ].map((d) => ({
    user_id: p1.id, status: "draft", source: "auto", is_billable: false,
    client_id: crypto.randomUUID(), title: "dtt-e2e-repo",
    start_time: ago(d.from), end_time: ago(d.to), duration: (d.from - d.to) * 60,
    project_id: d.project_id, app_usage: d.app_usage,
  }));
  const draftIds = [];
  for (const row of draftSpec) {
    const r = await rawApi(u1, "POST", "time_tracking_sessions?select=id", row);
    try { draftIds.push(JSON.parse(r.body)[0].id); } catch { console.log(`draft insert: HTTP ${r.status} ${r.body}`); }
  }
  check("drafts saved as the tracker saves them", draftIds.length === 3);
  const billableDraft = await rawApi(u1, "POST", "time_tracking_sessions?select=id", { ...draftSpec[2], client_id: crypto.randomUUID(), is_billable: true });
  check("a billable draft is rejected (DB CHECK)", billableDraft.status >= 400, `HTTP ${billableDraft.status}`);
  const listed1 = (await u1.invoke("get-sessions")).v || [];
  check("drafts are not in the session list", !listed1.some((s) => draftIds.includes(s.id)));
  check("draft count", (await u1.invoke("get-draft-count")).v === 3);
  // Drafts are edited only through the inbox
  check("edit-session leaves a draft alone", (await u1.invoke("edit-session", { id: draftIds[2], title: "edited", tags: ["e2e"] })).v === false);
  await u1.invoke("delete-session", draftIds[2]);
  check(
    "delete-session leaves a draft alone",
    (await rawApi(u1, "GET", `time_tracking_sessions?id=eq.${draftIds[2]}&select=title`)).body === `[{"title":"dtt-e2e-repo"}]`,
  );
  // The drafts start 3 h ago or later; just after midnight they are yesterday's
  const draftsToday = new Date(draftSpec[0].start_time).toDateString() === new Date().toDateString();

  await u1.ev(`document.querySelector('.nav-item[data-view="sessions"]').click()`);
  await u1.ev(`document.querySelector('#view-sessions .subnav-btn[data-sub="list"]').click()`);
  check("inbox lists the drafts", await u1.waitFor(`document.querySelectorAll(".draft-item").length === 3`, 10000));
  check("Sessions rail item shows the count", await u1.waitFor(`(() => {
    const b = document.querySelector('.nav-item[data-view="sessions"] .nav-badge');
    return b && !b.hidden && b.textContent === "3";
  })()`, 8000));
  await u1.shot("u1-draft-inbox.png");

  // Home's timeline: drafts drawn unfilled, counted apart, linking to the inbox
  if (draftsToday) {
    await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);
    check("Home timeline draws the drafts", await u1.waitFor(`document.querySelectorAll("#homeTimeline .today-bar.draft").length === 3`, 10000));
    check(
      "Home timeline counts drafts as unconfirmed, not tracked",
      await u1.waitFor(`(document.querySelector("#homeTimeline .timeline-totals")?.textContent || "").includes("1h 00m unconfirmed")`, 5000),
      await u1.ev(`document.querySelector("#homeTimeline .timeline-totals")?.textContent`),
    );
    await u1.shot("u1-home-drafts.png");
    await u1.ev(`document.querySelector("#homeTimeline .today-bar.draft")?.click()`);
    check("clicking a draft bar opens the inbox", await u1.waitFor(`document.querySelector(".draft-item")?.offsetParent !== null`, 8000));
  } else {
    console.log("  (skipped Home timeline draft checks: the drafts started yesterday)");
  }
  await u1.ev(`document.querySelector('.nav-item[data-view="sessions"]').click()`);
  await u1.ev(`document.querySelector('#view-sessions .subnav-btn[data-sub="list"]').click()`);

  // Merge the two older ones through the UI
  await u1.ev(`(() => {
    for (const id of ${JSON.stringify(draftIds.slice(0, 2))}) {
      const box = document.querySelector('.draft-check[data-id="' + id + '"]');
      if (!box) continue;
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    }
    document.getElementById("draftMergeBtn")?.click();
  })()`);
  await u1.waitFor(`!!document.getElementById("confirmModalOkBtn")`, 5000);
  await sleep(300);
  await u1.ev(`document.getElementById("confirmModalOkBtn")?.click()`);
  check("merge leaves two drafts", await u1.waitFor(`document.querySelectorAll(".draft-item").length === 2`, 10000));
  const afterMerge = ((await u1.invoke("get-draft-sessions")).v || []).find((d) => d.id === draftIds[0]);
  check(
    "merged draft keeps the earliest, adds up the time and app usage",
    afterMerge?.duration === 3000 && afterMerge?.start_time && Date.parse(afterMerge.end_time) === Date.parse(draftSpec[1].end_time) && afterMerge?.app_usage?.[0]?.seconds === 2400,
    JSON.stringify(afterMerge && { d: afterMerge.duration, usage: afterMerge.app_usage }),
  );

  // Confirm it through the UI: the project has a rate, so Billable is preselected
  await u1.ev(`document.querySelector('.draft-confirm-btn[data-id="${draftIds[0]}"]')?.click()`);
  check("confirm form opens with the draft's project", await u1.waitFor(`document.getElementById("draftProject")?.value === ${JSON.stringify(proj?.id ?? "")}`, 8000));
  check("Billable preselected for a project with a rate", await u1.ev(`document.getElementById("draftBillable")?.checked === true`));
  const draftTitle = `E2E confirmed draft ${new Date().toISOString().slice(11, 19)}`;
  await u1.ev(`(() => {
    const t = document.getElementById("draftTitle");
    if (!t) return;
    t.value = ${JSON.stringify(draftTitle)};
    document.getElementById("customModalForm").requestSubmit();
  })()`);
  check("confirming removes it from the inbox", await u1.waitFor(`document.querySelectorAll(".draft-item").length === 1`, 10000));
  const confirmed = ((await u1.invoke("get-sessions")).v || []).find((s) => s.id === draftIds[0]);
  check(
    "confirmed draft is a billable session in the project",
    confirmed?.title === draftTitle && confirmed?.is_billable === true && confirmed?.project_id === proj?.id && confirmed?.duration === 3000,
    JSON.stringify(confirmed && { t: confirmed.title, b: confirmed.is_billable, p: confirmed.project_id, d: confirmed.duration }),
  );
  check("the merged-away draft is gone", (await rawApi(u1, "GET", `time_tracking_sessions?id=eq.${draftIds[1]}&select=id`)).body === "[]");
  // What saveDraftSession relies on: a confirmed row is never updated as a
  // draft, and inserting its client_id again is a unique violation
  const staleUpdate = await rawApi(u1, "PATCH", `time_tracking_sessions?client_id=eq.${draftSpec[0].client_id}&status=eq.draft&select=id`, { duration: 1 });
  check("a late draft save doesn't touch a confirmed session", staleUpdate.status === 200 && staleUpdate.body === "[]", `HTTP ${staleUpdate.status} ${staleUpdate.body}`);
  const staleInsert = await rawApi(u1, "POST", "time_tracking_sessions?select=id", { ...draftSpec[0], duration: 1 });
  check("re-inserting a confirmed draft's client_id conflicts (23505)", staleInsert.status === 409 && staleInsert.body.includes("23505"), `HTTP ${staleInsert.status}`);

  // Discard the last one through the UI
  await u1.ev(`(() => {
    const box = document.querySelector('.draft-check[data-id="${draftIds[2]}"]');
    if (!box) return;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    document.getElementById("draftDiscardBtn")?.click();
  })()`);
  await u1.waitFor(`!!document.getElementById("confirmModalOkBtn")`, 5000);
  await sleep(300);
  await u1.ev(`document.getElementById("confirmModalOkBtn")?.click()`);
  check("discarding empties the inbox", await u1.waitFor(`document.querySelectorAll(".draft-item").length === 0`, 10000));
  check("discarded draft deleted", (await rawApi(u1, "GET", `time_tracking_sessions?id=eq.${draftIds[2]}&select=id`)).body === "[]");
  check("rail badge hidden with no drafts", await u1.waitFor(`document.querySelector('.nav-item[data-view="sessions"] .nav-badge')?.hidden === true`, 8000));
  await u1.ev(`document.querySelector('.nav-item[data-view="home"]').click()`);
  check("Home has no drafts line", await u1.waitFor(`document.getElementById("homeDrafts")?.hidden === true`, 8000));
  if (draftsToday) {
    check("Home timeline has no draft bars left", await u1.waitFor(`document.querySelectorAll("#homeTimeline .today-bar.draft").length === 0`, 8000));
    check(
      "the confirmed draft is a tracked bar on Home",
      await u1.waitFor(`[...document.querySelectorAll("#homeTimeline .today-bar:not(.draft)")].some((b) => b.title.includes(${JSON.stringify(draftTitle)}))`, 8000),
    );
  }
  check("always-on can be turned off", (await u1.invoke("set-always-on", false)).v === false);
  // Whatever is left of this block's rows, even after a failed check
  for (const id of draftIds) await rawApi(u1, "DELETE", `time_tracking_sessions?id=eq.${id}`);

  const delAgents = await rawApi(u1, "DELETE", "agent_sessions?external_id=like.e2e-*");
  check("delete the e2e agent session", delAgents.status === 200, `HTTP ${delAgents.status}`);
  if (proj?.id) {
    const delProj = await rawApi(u1, "DELETE", `cloud_projects?id=eq.${proj.id}`);
    check("delete the e2e project", delProj.status === 200, `HTTP ${delProj.status}`);
  }

  // Cleanup the session created by this run
  const del = await u1.invoke("delete-session", saved?.id);
  check("delete the e2e session", del.v === true);
  await rawApi(u1, "DELETE", `daily_usage_summary?app_name=eq.E2E%20Browser`);

  for (const app of apps) {
    check(`${app.name}: no renderer exceptions or console errors`, app.errors.length === 0, app.errors.slice(0, 5).join(" || "));
  }
} catch (err) {
  check("e2e run completed", false, String(err?.stack || err));
} finally {
  for (const app of apps) app.kill();
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
