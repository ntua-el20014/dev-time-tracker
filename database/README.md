# Database

Everything the app needs in Supabase is in one file:

| File | What it does |
|---|---|
| [`schema.sql`](./schema.sql) | Complete setup: tables → functions → triggers → row level security → indexes. Run once on an empty project. |
| [`reset.sql`](./reset.sql) | **Destructive.** Drops every table, function and type in `public`, the signup trigger, and **all auth users**. Use it to start over on the same project, then run `schema.sql`. |

There are no migrations, patches or upgrade scripts — **at least until Phases C and D of the roadmap are finished.** Change `schema.sql` directly, and reset and rebuild the database to apply it (`reset.sql`, then `schema.sql`). After C and D we'll decide whether to switch to numbered migrations (for example with the Supabase CLI).

Requires Postgres 15+ (all Supabase projects created since 2023).

## Setting up or starting over

1. Supabase Dashboard → your project → **SQL Editor** → **New query**.
2. *(Starting over only)* Paste the whole of `reset.sql` and **Run**.
3. Paste the whole of `schema.sql` and **Run**. The result should say "Success. No rows returned".
4. **Authentication → Sign In / Providers**: enable **Email**. **GitHub** is optional; its callback URL is `https://<project>.supabase.co/auth/v1/callback`.
5. **Authentication → URL Configuration → Redirect URLs**: add `dev-time-tracker://oauth-callback`. GitHub sign-in, email confirmation and password reset all return to the app through it.

The project URL and anon key are unchanged by a reset, so `.env` stays as it is. A reset deletes every auth user, so after starting over sign up again in the app, including the two e2e test accounts from `.env.local` (`DTT_TEST_EMAIL_1/2`, `DTT_TEST_PASSWORD_1/2`), and confirm their emails before running `npm run test:e2e`. Sessions saved by the app for deleted users just end in a sign-in screen.

## Security model

All tables have RLS enabled. Policies use `auth.uid()` and these `SECURITY DEFINER` helpers, which read `user_profiles` without recursing into its own policies:

- `get_current_user_org_id()`
- `get_current_user_role()`
- `is_user_admin()` / `is_user_admin_or_manager()`
- `is_self_or_same_org(user_id)`

Rules that go beyond plain policies:

- **Signup.** `handle_new_user()` creates the profile, a personal organization (the user is its admin) and default preferences. If the username is taken it gets a short suffix, so the signup never fails.
- **Profiles can't be self-promoted.** The trigger `guard_user_profile_change()` applies to updates made through the API:
  - **You** can edit your username, avatar and email, and you can leave your organization (`org_id` → NULL, `role` → employee). You can't join an organization or change your role directly.
  - **An admin** can change a non-admin member's role, nothing else. Removing a member goes through `remove_org_member()`.
  - **Joining** an organization goes through `join_organization_with_code()` or `approve_join_request()`.
- **Org attribution is server-side.** `set_org_id_from_user()` fills `org_id` on sessions, usage logs and the daily summary from the user's profile at insert, and keeps it fixed afterwards.
- **Lookup functions are scoped.** `get_user_profile_by_id()`, `get_organization_by_user_id()` and `get_organization_members_by_org_id()` only return data for yourself or your own organization.
- **Team analytics** (`get_org_*`) are for admins and managers of that organization only.

| Table | Who can read | Who can write |
|---|---|---|
| `organizations` | members; users with a join request to it | admins update their own org; created only by functions |
| `user_profiles` | yourself; members of your org | yourself, and admins for roles (see the guard above); created only on signup |
| `org_join_requests` | requester; admins of the target org | requester creates or cancels a pending request; admins decide via functions |
| `org_invite_codes` | admins/managers of the org | created and used via functions; admins/managers can deactivate or delete |
| `cloud_projects` | owner (personal); org members (organization) | owner; admins/managers create org projects; admins update them; projects can't be moved to another org |
| `project_members` | members of projects you can see | project manager |
| `project_repositories` | owner | owner, and only to projects they can see |
| `agent_sessions` | owner; admins/managers of the org | owner, project only if visible; `org_id` set by the server |
| `time_tracking_sessions`, `usage_logs` | owner; admins/managers of the org | owner |
| `daily_usage_summary` | owner; admins/managers of the org | owner (via `update_daily_usage_summary()`) |
| `user_tags`, `session_tags`, `daily_work_goals`, `scheduled_*`, `user_preferences` | owner (admins can also read the team's goals) | owner; tags only on your own sessions with your own tags |
