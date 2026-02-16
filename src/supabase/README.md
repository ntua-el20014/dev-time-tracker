# Supabase API Reference

This directory contains all Supabase integration modules for the Dev Time Tracker application. Each module provides functions for interacting with specific features of the cloud database.

## Table of Contents

- [Authentication & User Management (api.ts)](#authentication--user-management-apits)
- [Supabase Client (client.ts)](#supabase-client-clientts)
- [Configuration (config.ts)](#configuration-configts)
- [Cloud Projects (cloudProjects.ts)](#cloud-projects-cloudprojectsts)
- [Daily Goals (goals.ts)](#daily-goals-goalsts)
- [Organizations (organizations.ts)](#organizations-organizationsts)
- [Organization Join Requests (orgRequests.ts)](#organization-join-requests-orgrequeststs)
- [Scheduled Sessions (scheduledSessions.ts)](#scheduled-sessions-scheduledsessionsts)
- [Tags (tags.ts)](#tags-tagsts)
- [Time Tracking (timeTracking.ts)](#time-tracking-timetrackingts)
- [Usage Logs (usageLogs.ts)](#usage-logs-usagelogsts)
- [User Preferences (userPreferences.ts)](#user-preferences-userpreferencests)

---

## Authentication & User Management (api.ts)

### `getCurrentSession()`

Gets the current auth session.

### `getCurrentUser()`

Gets the current authenticated user.

### `signOut()`

Signs out the current user.

### `signInWithEmail(email: string, password: string)`

Signs in a user with email and password credentials.

### `signUpWithEmail(email: string, password: string, username: string)`

Creates a new user account with email, password, and username. Includes email redirect configuration for OAuth callback.

### `signInWithGitHub()`

Initiates GitHub OAuth authentication. Opens the OAuth URL in the system's default browser using Electron's shell.

### `resetPasswordForEmail(email: string)`

Sends a password reset email to the specified address. The reset link redirects back to the app using a custom protocol.

### `updatePassword(newPassword: string)`

Updates the current user's password.

### `createUserProfile(profile: { id: string; username: string; org_id?: string })`

Creates a user profile in the database with the specified details.

### `getUserProfile(userId: string)`

Retrieves a user profile by user ID.

### `updateUserProfileData(profile: { username?: string; avatar?: string; role?: string })`

Updates the current user's profile data in the database.

### `updateUserProfile(profile: { username?: string; avatar_url?: string })`

Updates the current user's profile in Supabase auth.

### `checkAuthStatus(): Promise<boolean>`

Checks if a user is currently authenticated.

### `onAuthStateChange(callback: (session: any) => void)`

Listens for auth state changes and executes a callback when sign-in or sign-out events occur. Clears local storage on sign out.

---

## Supabase Client (client.ts)

### `createSupabaseClient()`

Creates and configures the Supabase client with custom storage adapter for Electron, PKCE flow for security, and appropriate headers.

### `supabase`

The singleton Supabase client instance used throughout the application.

---

## Configuration (config.ts)

### `SUPABASE_CONFIG`

Configuration object containing Supabase URL and anonymous key, with environment variable fallbacks.

---

## Cloud Projects (cloudProjects.ts)

Cloud Projects Management API for Supabase. Manages organization projects and supports both personal and organization-scoped projects.

### `getOrganizationProjects(userId?: string): Promise<CloudProjectWithManager[]>`

Gets all cloud projects for the current user's organization. Only returns projects with `scope="organization"`.

### `getPersonalProjects(userId?: string): Promise<CloudProjectWithManager[]>`

Gets all personal projects for a specific user. Returns projects with `scope="personal"`.

### `getCloudProjectById(projectId: string): Promise<CloudProjectWithManager | null>`

Gets a cloud project by ID including manager information.

### `createCloudProject(data: CreateCloudProjectData, userId?: string): Promise<CloudProject>`

Creates a cloud project. Admin/manager only for org projects, any user for personal projects. Default scope is "organization" if org_id is provided, otherwise "personal".

### `updateCloudProject(projectId: string, updates: UpdateCloudProjectData): Promise<CloudProject>`

Updates a cloud project. Admin/manager only.

### `getProjectMembers(projectId: string): Promise<ProjectMemberWithUser[]>`

Gets all members assigned to a project including their user profile information.

### `assignMemberToProject(data: AssignProjectMemberData): Promise<ProjectMember>`

Assigns a user to a project. Checks for existing assignment to prevent duplicates.

### `removeMemberFromProject(projectId: string, userId: string): Promise<void>`

Removes a user from a project.

### `updateProjectMemberRole(projectId: string, userId: string, role: "manager" | "member"): Promise<ProjectMember>`

Updates a project member's role.

### `archiveProject(projectId: string): Promise<void>`

Archives a project (soft delete). Marks the project as archived and sets is_active to false. Admin/manager/project manager only.

### `restoreProject(projectId: string): Promise<void>`

Restores an archived project. Sets archived to false and is_active to true. Admin/manager/project manager only.

### `getArchivedProjects(userId?: string): Promise<CloudProjectWithManager[]>`

Gets all archived projects for the current user. Returns both organization and personal archived projects.

### `getProjectStats(projectId: string): Promise<{ total_sessions: number; total_time_seconds: number; total_members: number; last_activity: string | null }>`

Gets project statistics including total sessions, total time spent (in seconds), number of members, and timestamp of last activity. Uses the database function for efficient aggregation.

---

## Daily Goals (goals.ts)

### `setDailyGoal(userId: string, date: string, targetMinutes: number, description?: string | null)`

Sets or updates a daily goal for a specific date. If a goal already exists for that date, it will be updated.

### `getDailyGoal(userId: string, date: string)`

Gets the daily goal for a specific date. Returns null if not found.

### `completeDailyGoal(userId: string, date: string)`

Marks a daily goal as completed.

### `deleteDailyGoal(userId: string, date: string)`

Deletes a daily goal for a specific date.

### `getAllDailyGoals(userId: string)`

Gets all daily goals for a user, ordered by date descending.

### `getTotalTimeForDay(userId: string, date: string): Promise<number>`

Gets the total time spent (in minutes) for a specific day. Sums up all time_spent_seconds from daily_usage_summary for the given date.

---

## Organizations (organizations.ts)

Organization Management API for Supabase. All organization operations talk directly to Supabase.

### `getCurrentOrganization(userId?: string): Promise<Organization | null>`

Gets the current user's active organization using a SECURITY DEFINER function to bypass RLS.

### `getOrganizationById(orgId: string): Promise<OrganizationWithStats>`

Gets an organization by ID with statistics including member counts and project count.

### `getOrganizationMembers(orgId: string): Promise<UserProfile[]>`

Gets all members of an organization using a SECURITY DEFINER function to bypass RLS.

### `createTeamOrganization(data: CreateOrganizationData): Promise<{ org_id: string }>`

Creates a team organization using the database function for proper permissions.

### `updateOrganization(orgId: string, updates: Partial<CreateOrganizationData>): Promise<Organization>`

Updates organization details. Admin only.

### `updateUserRole(userId: string, role: "admin" | "manager" | "employee"): Promise<void>`

Updates a user's role in the organization. Admin only.

### `removeUserFromOrganization(userId: string): Promise<void>`

Removes a user from the organization. Admin only.

### `getCurrentUserProfile(userId?: string): Promise<UserProfile | null>`

Gets the current user's profile from Supabase using a SECURITY DEFINER function to bypass RLS.

---

## Organization Join Requests (orgRequests.ts)

Organization Join Requests API for Supabase. Handles requests to join organizations.

### `requestToJoinOrganization(orgId: string, userId?: string): Promise<OrgJoinRequest>`

Creates a request to join an organization. Checks for existing pending requests to prevent duplicates.

### `getMyJoinRequests(userId?: string): Promise<OrgJoinRequest[]>`

Gets all join requests for the current user.

### `getPendingJoinRequests(userId?: string): Promise<OrgJoinRequestWithUser[]>`

Gets pending join requests for the current user's organization. Admin only.

### `approveJoinRequest(requestId: string): Promise<void>`

Approves a join request. Admin only. Uses the database function for proper permissions.

### `rejectJoinRequest(requestId: string): Promise<void>`

Rejects a join request. Admin only. Uses the database function for proper permissions.

### `cancelJoinRequest(requestId: string, userId?: string): Promise<void>`

Cancels own join request.

---

## Scheduled Sessions (scheduledSessions.ts)

### `createScheduledSession(userId: string, sessionData: ScheduledSessionData)`

Creates a new scheduled session. Handles tags if provided.

### `getScheduledSessions(userId: string, filters?: { startDate?: string; endDate?: string; status?: Array<...>; projectId?: string })`

Gets scheduled sessions with optional filters. Returns sessions with tag names included.

### `updateScheduledSession(sessionId: string, updates: Partial<...>)`

Updates a scheduled session. Can update tags if provided.

### `deleteScheduledSession(sessionId: string)`

Deletes a scheduled session.

### `markScheduledSessionCompleted(sessionId: string, actualSessionId: string)`

Marks a scheduled session as completed and links it to the actual session.

### `getUpcomingSessionNotifications(userId: string): Promise<ScheduledSessionNotification[]>`

Gets upcoming sessions that need notifications. Returns sessions that are:

- Day before: scheduled for tomorrow (more than 2 hours away)
- Same day: scheduled within next 2 hours (not notified in last 30 min)
- Time to start: scheduled within next 5 minutes (not notified in last 2 min)

### `markNotificationSent(sessionId: string)`

Marks that a notification has been sent for a scheduled session.

### `setScheduledSessionTags(userId: string, sessionId: string, tagNames: string[])` (Helper)

Helper function to set tags for a scheduled session. Creates tags if they don't exist.

---

## Tags (tags.ts)

### `getAllTags(userId: string)`

Gets all tags for a user, ordered by name ascending.

### `createTag(userId: string, name: string, color?: string)`

Creates a new tag for a user. If tag with same name exists, returns the existing tag.

### `updateTag(tagId: string, updates: { name?: string; color?: string })`

Updates a tag's properties.

### `deleteTag(tagId: string)`

Deletes a tag and all its session associations (CASCADE).

### `getSessionTags(sessionId: string)`

Gets all tags for a specific session. Returns an array of tag objects.

### `setSessionTags(sessionId: string, tagIds: string[])`

Sets tags for a session. Replaces all existing tags with the provided tag IDs.

### `setSessionTagsByNames(userId: string, sessionId: string, tagNames: string[])`

Helper function: Sets session tags by tag names instead of IDs. Creates tags if they don't exist. Matches SQLite behavior more closely.

### `getTagByName(userId: string, name: string)`

Gets a tag by name for a user. Returns null if not found.

---

## Time Tracking (timeTracking.ts)

### `startSession(userId: string, projectId?: string, description?: string)`

Starts a new tracking session.

### `endSession(sessionId: string)`

Ends a tracking session by calculating and updating its duration.

### `addSession(userId: string, startTime: string, duration: number, title: string, description?: string, tags?: string[], projectId?: string, isBillable?: boolean)`

Adds a retrospective session with a known duration. Used for manually adding past work sessions. Automatically assigns tags if provided.

### `getSmallSessions(userId: string, maxDurationSeconds: number)`

Gets sessions with duration less than or equal to specified threshold. Useful for reviewing and cleaning up short/incomplete sessions.

### `deleteSessions(sessionIds: string[])`

Deletes multiple sessions by IDs. Used for batch cleanup from review panel.

### `getAllSessions(userId: string, filters?: { projectId?: string; startDate?: string; endDate?: string; isBillable?: boolean; tag?: string; limit?: number; offset?: number })`

Gets all sessions for a user with optional filters including tag filtering.

### `getSessionById(sessionId: string)`

Gets a specific session by ID. Returns null if not found.

### `updateSession(sessionId: string, updates: { title?: string; description?: string; project_id?: string | null; is_billable?: boolean; duration?: number })`

Updates a session.

### `deleteSession(sessionId: string)`

Deletes a single session.

### `getSessionsInDateRange(userId: string, startDate: string, endDate: string)`

Gets sessions within a date range.

---

## Usage Logs (usageLogs.ts)

### `logUsage(userId: string, appName: string, windowTitle: string, language?: string | null, languageExtension?: string | null, iconUrl?: string | null, intervalSeconds: number = 1, timestamp?: string)`

Logs usage activity for an application. Inserts usage log and updates daily summary using database function.

### `getUsageSummary(userId: string, date: string)`

Gets usage summary for a specific date, ordered by time spent descending.

### `getUsageLogs(userId: string, date: string, filters?: { app?: string; language?: string; limit?: number; offset?: number })`

Gets raw usage logs for a specific date with optional filters.

### `getDailySummary(userId: string, filters?: { startDate?: string; endDate?: string; app?: string; language?: string })`

Gets daily summaries across date range with optional filters.

### `getEditorUsage(userId: string)`

Gets editor usage statistics.

### `getLanguageUsage(userId: string)`

Gets language usage statistics aggregated across all apps. Returns aggregated data with total time and app count per language.

### `getUsageDetailsForAppDate(userId: string, app: string, date: string)`

Gets detailed usage for a specific app on a specific date.

### `getUsageDetailsForSession(userId: string, sessionId: string)`

Gets detailed usage for a specific session. Returns usage logs within session time range.

### `getLoggedDaysOfMonth(userId: string, year: number, month: number)`

Gets all days with logged usage for a specific month. Returns unique dates.

---

## User Preferences (userPreferences.ts)

### `getUserPreferences(userId: string): Promise<UserPreferences>`

Gets user preferences. If preferences don't exist, they will be created with defaults.

### `updateUserPreferences(userId: string, preferences: Partial<UserPreferences>)`

Updates user preferences (partial update).

### `getEditorColors(userId: string): Promise<EditorColors>`

Gets editor colors (app name to color mapping).

### `setEditorColor(userId: string, editorName: string, color: string)`

Sets color for a specific editor.

### `getTheme(userId: string): Promise<"light" | "dark" | "system">`

Gets current theme preference.

### `setTheme(userId: string, theme: "light" | "dark" | "system")`

Sets theme preference.

### `getAccentColor(userId: string, themeMode: "light" | "dark"): Promise<string>`

Gets accent color for a specific theme mode.

### `setAccentColor(userId: string, color: string, themeMode: "light" | "dark")`

Sets accent color for a specific theme mode.

### `getNotificationSettings(userId: string): Promise<NotificationSettings>`

Gets notification settings.

### `setNotificationSettings(userId: string, settings: NotificationSettings)`

Updates notification settings.

### `createDefaultPreferences(userId: string): Promise<UserPreferences>` (Helper)

Helper: Creates default preferences for a new user.

### `parsePreferences(data: UserPreferencesRow): UserPreferences` (Helper)

Helper: Parses database row to UserPreferences object.

---

## Types and Interfaces

All functions use TypeScript types imported from:

- `../types/database.types` - Generated Supabase database types
- `../types/organization.types` - Organization-related types

Common patterns:

- Functions accept optional `userId` parameter and fall back to authenticated user
- Most functions throw errors on failure
- RLS (Row Level Security) policies are bypassed using SECURITY DEFINER functions where needed
- Type assertions (`as any`) are used where Supabase RLS typing causes limitations

## Environment Configuration

Supabase configuration is managed through environment variables with fallbacks defined in `config.ts`:

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key

## Notes

- The Supabase client uses a custom Electron storage adapter for session persistence
- PKCE flow is used for enhanced OAuth security
- Many organization-related functions use RPC calls to SECURITY DEFINER functions to bypass RLS
