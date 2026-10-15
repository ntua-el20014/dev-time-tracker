// End-to-end test of the packaged app against the real Supabase project,
// using two test accounts in two isolated app instances, driven over CDP.
// Credentials come from .env.local and are never printed.
//
// Usage (repo root, after `npm run package`):  npm run test:e2e
// Needs in .env.local: DTT_TEST_EMAIL_1/DTT_TEST_PASSWORD_1 (becomes the
// org admin) and DTT_TEST_EMAIL_2/DTT_TEST_PASSWORD_2, both confirmed users;
// SUPABASE_URL / SUPABASE_ANON_KEY come from .env. Creates and then deletes
// a session; account 2 ends up in a fresh personal org. Windows only.
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

// Raw PostgREST call with the page's own session token — what an attacker
// with a valid account could do outside the app
async function rawApi(app, method, pathAndQuery, body) {
  return app.ev(`(async () => {
    const key = Object.keys(localStorage).find(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
    const token = JSON.parse(localStorage.getItem(key)).access_token;
    const r = await fetch(${JSON.stringify(SUPA.url)} + "/rest/v1/" + ${JSON.stringify(pathAndQuery)}, {
      method: ${JSON.stringify(method)},
      headers: {
        apikey: ${JSON.stringify(SUPA.key)},
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: ${body ? JSON.stringify(JSON.stringify(body)) : "undefined"},
    });
    return { status: r.status, body: (await r.text()).slice(0, 300) };
  })()`);
}

const apps = [];
try {
  if (!creds[0].email || !creds[1].email || !SUPA.url || !SUPA.key) throw new Error("missing env");

  // ── User 1: sign in, tabs, record a session ─────────────────────
  const u1 = await launch("user1", 9341);
  apps.push(u1);
  check("user 1 signs in", await login(u1, creds[0]));
  await sleep(3000);
  // First login in a fresh profile shows the onboarding tour — skip it
  await u1.ev(`[...document.querySelectorAll("button, a")].find(b => b.textContent.trim() === "Skip Tour")?.click()`);
  await sleep(500);
  const p1 = (await u1.invoke("org:get-current-user-profile")).v;
  const org1 = (await u1.invoke("org:get-current")).v;
  check("user 1 has a profile and personal org (created by signup trigger)", !!p1?.id && !!org1?.id, `${p1?.username} / ${org1?.name}`);
  check("user 1 is admin of it", p1?.role === "admin");
  await u1.shot("u1-dashboard.png");

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

  const title = `E2E session ${new Date().toISOString().slice(11, 19)}`;
  await u1.ev(`document.getElementById("recordBtn").click()`);
  check("record button starts tracking", await u1.waitFor(`document.getElementById("recordBtn").title === "Finish Recording"`, 5000));
  await sleep(13000);
  const clock = await u1.ev(`document.getElementById("navTimerClock").textContent`);
  check("rail timer counts the session", /^0:00:1\d$/.test(clock), clock);
  await u1.ev(`document.getElementById("recordBtn").click()`);
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
  check("session date is the local day", saved?.date === new Date().toLocaleDateString("en-CA"), saved?.date);

  // The session is billable with no project: Billing must still show it
  await u1.ev(`document.querySelector('.nav-item[data-view="billing"]').click()`);
  check("Billing flags the billable session that has no project", await u1.waitFor(`/billable sessions? \(.*\) ha(s|ve) no project/.test(document.querySelector(".billable-unassigned")?.innerText || "")`, 10000));
  await u1.shot("u1-billing-unassigned.png");
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
