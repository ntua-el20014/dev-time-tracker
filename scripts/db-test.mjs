// Runs database/schema.sql (and reset.sql) against PGlite with a minimal
// Supabase stub (auth schema, auth.uid(), anon/authenticated roles) and
// checks the security rules and main flows as different users.
//
// Usage (repo root):  npm run test:db
// No Supabase needed: PGlite runs real Postgres in-process.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const repo = process.argv[2] || process.cwd();
const schema = readFileSync(`${repo}/database/schema.sql`, "utf8");
const reset = readFileSync(`${repo}/database/reset.sql`, "utf8");

const db = new PGlite();
let failed = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const fails = async (sql, params) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
};

// Act as the API would: role "authenticated" with a JWT subject
const as = async (userId) => {
  await db.exec(`RESET ROLE`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.exec(`SET ROLE authenticated`);
};
const asAdminDb = async () => {
  await db.exec(`RESET ROLE`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
};

// ── Supabase stub ─────────────────────────────────────
await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id UUID PRIMARY KEY,
    email TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'
  );
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
`);

async function runScenario(label) {
  console.log(`\n── ${label} ──`);
  const A = "aaaaaaaa-0000-0000-0000-000000000001";
  const B = "bbbbbbbb-0000-0000-0000-000000000002";
  const C = "cccccccc-0000-0000-0000-000000000003";

  // Signup (Supabase inserts into auth.users as a privileged role)
  await asAdminDb();
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'john@a.com')`, [A]);
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'john@b.com')`, [B]);
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'c@c.com', '{"username":"carol"}')`,
    [C],
  );
  const profiles = await rows(`SELECT id, username, role, org_id FROM user_profiles ORDER BY id`);
  check("signup creates a profile per user", profiles.length === 3);
  check(
    "same email prefix doesn't break signup (unique usernames)",
    new Set(profiles.map((p) => p.username)).size === 3,
    profiles.map((p) => p.username).join(", "),
  );
  check("new users are admin of their own personal org", profiles.every((p) => p.role === "admin" && p.org_id));
  check("signup creates preferences", (await one(`SELECT count(*)::int n FROM user_preferences`)).n === 3);
  const orgA = profiles.find((p) => p.id === A).org_id;
  const orgB = profiles.find((p) => p.id === B).org_id;

  // ── Privilege escalation attempts by A ──
  await as(A);
  let err = await fails(`UPDATE user_profiles SET org_id = $1 WHERE id = $2`, [orgB, A]);
  check("cannot move yourself into another org", !!err, err ?? "");
  // Need a non-admin to test self-promotion: B joins A's org first (below)
  err = await fails(`SELECT create_personal_organization($1, 'hijack')`, [B]);
  check("create_personal_organization refuses other users", !!err, err ?? "");
  check(
    "get_user_profile_by_id hides users outside your org",
    (await rows(`SELECT * FROM get_user_profile_by_id($1)`, [B])).length === 0,
  );
  check(
    "get_organization_members_by_org_id hides other orgs",
    (await rows(`SELECT * FROM get_organization_members_by_org_id($1)`, [orgB])).length === 0,
  );
  check(
    "get_organization_by_user_id hides other users' orgs",
    (await rows(`SELECT * FROM get_organization_by_user_id($1)`, [B])).length === 0,
  );
  check(
    "own profile lookup still works",
    (await rows(`SELECT * FROM get_user_profile_by_id($1)`, [A])).length === 1,
  );
  check(
    "cannot see other users' profiles directly",
    (await rows(`SELECT * FROM user_profiles WHERE id = $1`, [B])).length === 0,
  );
  err = await fails(`UPDATE user_profiles SET avatar = 'cat.png' WHERE id = $1`, [A]);
  check("can edit own avatar", !err, err ?? "");

  // ── Org attribution can't be forged ──
  const s = await one(
    `INSERT INTO time_tracking_sessions (user_id, org_id, start_time, end_time, duration, title)
     VALUES ($1, $2, '2026-10-14T10:00:00Z', '2026-10-14T11:00:00Z', 1800, 'work')
     RETURNING id, org_id, duration`,
    [A, orgB],
  );
  check("session org_id comes from the user, not the client", s.org_id === orgA);
  check("app-supplied duration is kept (1800, not 3600)", s.duration === 1800);
  await db.query(`UPDATE time_tracking_sessions SET org_id = $1 WHERE id = $2`, [orgB, s.id]);
  check(
    "session org_id can't be changed later",
    (await one(`SELECT org_id FROM time_tracking_sessions WHERE id = $1`, [s.id])).org_id === orgA,
  );
  const s2 = await one(
    `INSERT INTO time_tracking_sessions (user_id, start_time, end_time) VALUES ($1, '2026-10-14T12:00:00Z', '2026-10-14T12:10:00Z') RETURNING duration`,
    [A],
  );
  check("missing duration is derived from end_time", s2.duration === 600);
  err = await fails(
    `INSERT INTO time_tracking_sessions (user_id, start_time) VALUES ($1, NOW())`,
    [B],
  );
  check("cannot insert sessions for another user", !!err, err ?? "");

  // ── Usage logs & daily summary ──
  const log = await one(
    `INSERT INTO usage_logs (user_id, org_id, app_name, timestamp) VALUES ($1, $2, 'Chrome', NOW()) RETURNING org_id`,
    [A, orgB],
  );
  check("usage log org_id comes from the user", log.org_id === orgA);
  for (let i = 0; i < 3; i++) {
    await db.query(
      `SELECT update_daily_usage_summary($1, '2026-10-14', 'Chrome', NULL, NULL, $2, 10)`,
      [A, i === 0 ? "icon" : null],
    );
  }
  const sum = await rows(`SELECT time_spent_seconds, icon_url, org_id FROM daily_usage_summary WHERE app_name = 'Chrome'`);
  check("NULL-language ticks merge into one summary row", sum.length === 1 && sum[0].time_spent_seconds === 30);
  check("summary keeps the icon and gets the org", sum[0]?.icon_url === "icon" && sum[0]?.org_id === orgA);
  err = await fails(
    `SELECT update_daily_usage_summary($1, '2026-10-14', 'Chrome', NULL, NULL, NULL, 10)`,
    [B],
  );
  check("cannot write another user's summary", !!err, err ?? "");

  // ── Invite flow: B joins A's org ──
  const invite = await one(`SELECT * FROM create_invite_code(5, 7)`);
  check("admin can create an invite code", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(invite.code), invite.code);
  await as(B);
  const joined = await one(`SELECT * FROM join_organization_with_code($1)`, [invite.code.toLowerCase()]);
  check("user joins with a code (case-insensitive)", joined.org_id === orgA);
  const bProfile = await one(`SELECT role, org_id FROM user_profiles WHERE id = $1`, [B]);
  check("joined as employee", bProfile.role === "employee" && bProfile.org_id === orgA);
  err = await fails(`UPDATE user_profiles SET role = 'admin' WHERE id = $1`, [B]);
  check("employee cannot promote themselves", !!err, err ?? "");
  check(
    "employee cannot create invite codes",
    !!(await fails(`SELECT * FROM create_invite_code()`)),
  );
  check(
    "employee cannot view team analytics",
    !!(await fails(`SELECT * FROM get_org_analytics_summary($1, '2026-01-01', '2026-12-31')`, [orgA])),
  );
  check(
    "employee cannot see the admin's sessions",
    (await rows(`SELECT * FROM time_tracking_sessions WHERE user_id = $1`, [A])).length === 0,
  );
  const upd = await rows(`UPDATE user_profiles SET role = 'employee' WHERE id = $1 RETURNING id`, [A]);
  check("employee cannot change the admin's role", upd.length === 0);
  await db.query(
    `INSERT INTO time_tracking_sessions (user_id, start_time, duration, title) VALUES ($1, '2026-10-14T09:00:00Z', 900, 'b work')`,
    [B],
  );

  // ── Admin manages B ──
  await as(A);
  check(
    "admin sees member sessions",
    (await rows(`SELECT * FROM time_tracking_sessions WHERE user_id = $1`, [B])).length === 1,
  );
  check(
    "org members lookup works for own org",
    (await rows(`SELECT * FROM get_organization_members_by_org_id($1)`, [orgA])).length === 2,
  );
  err = await fails(`UPDATE user_profiles SET role = 'manager' WHERE id = $1`, [B]);
  check("admin can promote a member", !err, err ?? "");
  err = await fails(`UPDATE user_profiles SET username = 'renamed' WHERE id = $1`, [B]);
  check("admin cannot rename a member", !!err, err ?? "");
  err = await fails(`UPDATE user_profiles SET org_id = $1 WHERE id = $2`, [orgB, B]);
  check("admin cannot move a member to another org", !!err, err ?? "");
  const summary = await one(`SELECT * FROM get_org_analytics_summary($1, '2026-01-01', '2026-12-31')`, [orgA]);
  check("team analytics summary", summary.total_sessions === 3 && summary.active_members === 2, JSON.stringify(summary));
  const members = await rows(`SELECT * FROM get_org_member_activity($1, '2026-01-01', '2026-12-31')`, [orgA]);
  check("team member activity", members.length === 2);
  check(
    "admin cannot remove themselves via remove_org_member",
    !!(await fails(`SELECT remove_org_member($1)`, [A])),
  );
  check(
    "admin cannot remove someone outside the org",
    !!(await fails(`SELECT remove_org_member($1)`, [C])),
  );
  err = await fails(`SELECT remove_org_member($1)`, [B]);
  check("admin can remove a member", !err, err ?? "");
  await asAdminDb();
  const removed = await one(`SELECT org_id, role FROM user_profiles WHERE id = $1`, [B]);
  check("removed member has no org and is employee", removed.org_id === null && removed.role === "employee");
  await as(B);
  check(
    "removed member can no longer read the org's projects/sessions",
    (await rows(`SELECT * FROM time_tracking_sessions WHERE user_id = $1`, [A])).length === 0,
  );
  check(
    "non-admin cannot call remove_org_member",
    !!(await fails(`SELECT remove_org_member($1)`, [A])),
  );
  await as(A);

  // ── Projects ──
  const proj = await one(
    `INSERT INTO cloud_projects (name, scope, org_id, manager_id, hourly_rate) VALUES ('Site', 'organization', $1, $2, 50) RETURNING id`,
    [orgA, A],
  );
  check("admin creates an org project with an hourly rate", !!proj.id);
  err = await fails(`UPDATE cloud_projects SET org_id = $1 WHERE id = $2`, [orgB, proj.id]);
  check("project can't be moved to another org", !!err, err ?? "");
  await as(C);
  check(
    "outsider cannot archive the project",
    !!(await fails(`SELECT archive_project($1)`, [proj.id])),
  );
  check(
    "outsider cannot see the project",
    (await rows(`SELECT * FROM cloud_projects WHERE id = $1`, [proj.id])).length === 0,
  );
  err = await fails(
    `INSERT INTO cloud_projects (name, scope, org_id, manager_id) VALUES ('x', 'organization', $1, $2)`,
    [orgA, C],
  );
  check("outsider cannot add projects to another org", !!err, err ?? "");
  await as(A);
  err = await fails(`SELECT archive_project($1)`, [proj.id]);
  check("manager can archive own project", !err, err ?? "");
  const stats = await one(`SELECT * FROM get_project_stats($1)`, [proj.id]);
  check("project stats run", stats !== undefined);

  // ── Team analytics: local days and billed time ──
  await db.query(
    `INSERT INTO time_tracking_sessions (user_id, project_id, start_time, duration, is_billable, supervising_seconds)
     VALUES ($1, $2, '2026-11-14T22:30:00Z', 3600, true, 1800)`,
    [A, proj.id],
  );
  const dayIn = async (tz) =>
    Number((await one(`SELECT * FROM get_org_analytics_summary($1, '2026-11-15', '2026-11-15', false, $2)`, [orgA, tz])).total_sessions);
  check("analytics buckets sessions by the viewer's local day", (await dayIn("Europe/Athens")) === 1 && (await dayIn("UTC")) === 0);
  const billed = async () =>
    Number((await one(`SELECT * FROM get_org_analytics_summary($1, '2026-11-15', '2026-11-15', true, 'Europe/Athens')`, [orgA])).total_hours_tracked);
  check("billable hours include supervising by default", (await billed()) === 1);
  await db.query(`UPDATE cloud_projects SET bill_supervising = false WHERE id = $1`, [proj.id]);
  check("billable hours leave out unbilled supervising", (await billed()) === 0.5);
  const top = await one(`SELECT * FROM get_org_top_projects($1, '2026-11-15', '2026-11-15', NULL, true, 10, 'Europe/Athens')`, [orgA]);
  const member = await one(`SELECT * FROM get_org_member_activity($1, '2026-11-15', '2026-11-15', NULL, NULL, true, 'Europe/Athens')`, [orgA]);
  check("top projects and member activity agree", Number(top?.total_hours) === 0.5 && Number(member?.total_hours) === 0.5, JSON.stringify({ top: top?.total_hours, member: member?.total_hours }));
  await db.query(`UPDATE cloud_projects SET bill_supervising = true WHERE id = $1`, [proj.id]);

  // ── Supervising time ──
  check(
    "projects bill supervising time by default",
    (await one(`SELECT bill_supervising FROM cloud_projects WHERE id = $1`, [proj.id])).bill_supervising === true,
  );
  const sup = await one(
    `INSERT INTO time_tracking_sessions (user_id, start_time, duration, supervising_seconds, supervising_spans)
     VALUES ($1, NOW(), 600, 120, '[["2026-10-15T10:00:00Z","2026-10-15T10:02:00Z"]]') RETURNING supervising_seconds, supervising_spans`,
    [A],
  );
  check("session stores supervising time and spans", sup.supervising_seconds === 120 && sup.supervising_spans.length === 1);
  const plain = await one(
    `INSERT INTO time_tracking_sessions (user_id, start_time, duration) VALUES ($1, NOW(), 60) RETURNING supervising_seconds, supervising_spans`,
    [A],
  );
  check("supervising defaults to none", plain.supervising_seconds === 0 && plain.supervising_spans.length === 0);
  err = await fails(
    `INSERT INTO time_tracking_sessions (user_id, start_time, duration, supervising_spans) VALUES ($1, NOW(), 60, '{}')`,
    [A],
  );
  check("supervising_spans must be an array", !!err, err ?? "");
  err = await fails(
    `INSERT INTO time_tracking_sessions (user_id, start_time, duration, supervising_seconds) VALUES ($1, NOW(), 60, -1)`,
    [A],
  );
  check("supervising_seconds can't be negative", !!err, err ?? "");

  // ── Repository links ──
  err = await fails(
    `INSERT INTO project_repositories (user_id, project_id, repo_key, repo_name) VALUES ($1, $2, 'github.com/a/site', 'site')`,
    [A, proj.id],
  );
  check("user links a repo to a project they can see", !err, err ?? "");
  err = await fails(
    `INSERT INTO project_repositories (user_id, project_id, repo_key, repo_name)
     VALUES ($1, $2, 'github.com/a/site', 'site')
     ON CONFLICT (user_id, repo_key) DO UPDATE SET project_id = EXCLUDED.project_id`,
    [A, proj.id],
  );
  check("relinking the same repo upserts", !err, err ?? "");
  await as(C);
  err = await fails(
    `INSERT INTO project_repositories (user_id, project_id, repo_key, repo_name) VALUES ($1, $2, 'path:c:/x', 'x')`,
    [C, proj.id],
  );
  check("cannot link a repo to a project you can't see", !!err, err ?? "");
  err = await fails(
    `INSERT INTO project_repositories (user_id, project_id, repo_key, repo_name) VALUES ($1, $2, 'path:c:/x', 'x')`,
    [A, proj.id],
  );
  check("cannot create links for someone else", !!err, err ?? "");
  check(
    "other users' repo links are invisible",
    (await rows(`SELECT * FROM project_repositories`)).length === 0,
  );
  await as(A);

  // ── Agent sessions ──
  const agentRow = `INSERT INTO agent_sessions (user_id, source, external_id, project_id, org_id, started_at, ended_at, active_seconds, prompts, input_tokens, models, cost_usd)
     VALUES ($1, 'claude-code', $2, $3, $4, '2026-10-15T10:00:00Z', '2026-10-15T10:30:00Z', 1500, 4, 1000, '{"claude-opus-5-5":{"input":1000}}', 1.25)`;
  err = await fails(agentRow, [A, "cc-1", proj.id, orgB]);
  check("user records an agent session for a visible project", !err, err ?? "");
  check(
    "agent session org_id comes from the server, not the client",
    (await one(`SELECT org_id FROM agent_sessions WHERE external_id = 'cc-1'`)).org_id === orgA,
  );
  err = await fails(
    `INSERT INTO agent_sessions (user_id, source, external_id, started_at, ended_at, prompts)
     VALUES ($1, 'claude-code', 'cc-1', '2026-10-15T10:00:00Z', '2026-10-15T10:45:00Z', 6)
     ON CONFLICT (user_id, source, external_id) DO UPDATE SET ended_at = EXCLUDED.ended_at, prompts = EXCLUDED.prompts`,
    [A],
  );
  check("re-ingesting an agent session upserts it", !err && (await one(`SELECT prompts FROM agent_sessions WHERE external_id = 'cc-1'`)).prompts === 6, err ?? "");
  err = await fails(
    `INSERT INTO agent_sessions (user_id, source, external_id, started_at, ended_at) VALUES ($1, 'cursor', 'x', NOW(), NOW())`,
    [A],
  );
  check("unknown agent sources are rejected", !!err, err ?? "");
  err = await fails(
    `INSERT INTO agent_sessions (user_id, source, external_id, started_at, ended_at) VALUES ($1, 'codex', 'x', NOW(), NOW() - interval '1 hour')`,
    [A],
  );
  check("agent session can't end before it starts", !!err, err ?? "");
  await as(C);
  check("outsiders can't see agent sessions", (await rows(`SELECT * FROM agent_sessions`)).length === 0);
  err = await fails(agentRow, [C, "cc-2", proj.id, null]);
  check("can't attribute an agent session to an invisible project", !!err, err ?? "");
  err = await fails(agentRow, [A, "cc-3", null, null]);
  check("can't record agent sessions for someone else", !!err, err ?? "");
  await as(A);

  // ── Leaving an org ──
  await as(C);
  err = await fails(`UPDATE user_profiles SET org_id = NULL, role = 'employee' WHERE id = $1`, [C]);
  check("user can leave their org", !err, err ?? "");
  err = await fails(`SELECT create_personal_organization($1, 'Carol Co')`, [C]);
  check("user can create a personal org for themselves", !err, err ?? "");
  check(
    "and is its admin",
    (await one(`SELECT role FROM user_profiles WHERE id = $1`, [C])).role === "admin",
  );

  // ── Tags / goals / scheduled / preferences basics ──
  const tag = await one(`INSERT INTO user_tags (user_id, name) VALUES ($1, 'deep') RETURNING id`, [C]);
  const cs = await one(
    `INSERT INTO time_tracking_sessions (user_id, start_time, duration) VALUES ($1, NOW(), 60) RETURNING id`,
    [C],
  );
  err = await fails(`INSERT INTO session_tags (session_id, tag_id) VALUES ($1, $2)`, [cs.id, tag.id]);
  check("tagging own session with own tag", !err, err ?? "");
  await as(A);
  err = await fails(`INSERT INTO session_tags (session_id, tag_id) VALUES ($1, $2)`, [s.id, tag.id]);
  check("cannot use someone else's tag", !!err, err ?? "");
  err = await fails(`INSERT INTO daily_work_goals (user_id, date, target_minutes) VALUES ($1, '2026-10-14', 120)`, [A]);
  check("daily goal insert", !err, err ?? "");
  err = await fails(
    `INSERT INTO scheduled_work_sessions (user_id, title, scheduled_datetime) VALUES ($1, 'plan', NOW() + interval '1 day')`,
    [A],
  );
  check("scheduled session insert", !err, err ?? "");
  const prefs = await one(`SELECT tracking_interval_seconds, idle_timeout_seconds FROM user_preferences WHERE user_id = $1`, [A]);
  check("preferences have defaults", prefs.tracking_interval_seconds === 10 && prefs.idle_timeout_seconds === 300);

  await asAdminDb();
}

// ── Run: fresh build → scenario → reset → rebuild → scenario ──
await db.exec(schema);
console.log("schema.sql applied");
await runScenario("fresh database");

await db.exec(reset);
const left = await one(`SELECT
  (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables,
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS funcs,
  (SELECT count(*)::int FROM auth.users) AS users,
  (SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal) AS auth_triggers`);
check("reset.sql removes everything", left.tables === 0 && left.funcs === 0 && left.users === 0 && left.auth_triggers === 0, JSON.stringify(left));

await db.exec(schema);
console.log("schema.sql re-applied after reset");
await runScenario("after reset + rebuild");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
