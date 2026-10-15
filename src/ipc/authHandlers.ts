/**
 * Authentication, owned by the main process. Main has the only Supabase
 * client: it signs in, finishes OAuth / email-link callbacks, keeps the
 * session (encrypted on disk, authStorage.ts) and refreshes it. The renderer
 * asks over IPC and only ever sees { id, email } — never a token.
 *
 * Sign-in state changes are pushed to the renderer on "auth-state"
 * ({ user } or null) and to the tracker through the onUserChange callback.
 */
import { app, ipcMain, safeStorage, shell, type BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import { supabase } from "../supabase/config";
import { initAuthStorage } from "../supabase/authStorage";
import { logError } from "../utils/errorHandler";

export interface AuthUser {
  id: string;
  email: string | null;
}

/** IPC results: errors travel as data so the renderer gets a clean message. */
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const REDIRECT = "dev-time-tracker://oauth-callback";

let getWindow: () => BrowserWindow | null = () => null;
let onUserChange: (userId: string | null) => void = () => {};
/** undefined until the first auth event, so the first one always publishes */
let lastUserId: string | null | undefined;

const toUser = (
  u: { id: string; email?: string | null } | null | undefined,
): AuthUser | null => (u ? { id: u.id, email: u.email ?? null } : null);

/** Send to the renderer, waiting for the page if it is still loading. */
function send(channel: string, payload?: unknown) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () =>
      win.webContents.send(channel, payload),
    );
  } else {
    win.webContents.send(channel, payload);
  }
}

function notice(message: string, type: "info" | "error" = "info") {
  send("auth-notice", { message, type });
}

function publish(user: AuthUser | null) {
  const id = user?.id ?? null;
  if (id === lastUserId) return;
  lastUserId = id;
  onUserChange(id);
  send("auth-state", user ? { user } : null);
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String((err as any)?.message ?? err);
    return { ok: false, error: message || "Authentication failed" };
  }
}

const isText = (v: unknown, max = 1000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

/** The session file and the OS encryption for it. */
async function initStorage() {
  const file = path.join(app.getPath("userData"), "auth-session.bin");
  const encryption = safeStorage.isEncryptionAvailable();
  await initAuthStorage({
    read: () => fs.promises.readFile(file).catch(() => null),
    async write(data) {
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, data, { mode: 0o600 });
      await fs.promises.rename(tmp, file);
    },
    remove: () => fs.promises.rm(file, { force: true }),
    encrypt: encryption ? (text) => safeStorage.encryptString(text) : null,
    decrypt: encryption ? (data) => safeStorage.decryptString(data) : null,
  });
}

/**
 * Call once the app is ready (safeStorage needs it) and before the window
 * loads. `onUserChange` gets the signed-in user id, or null.
 */
export async function initAuth(options: {
  getWindow: () => BrowserWindow | null;
  onUserChange: (userId: string | null) => void;
}) {
  getWindow = options.getWindow;
  onUserChange = options.onUserChange;
  await initStorage();
  supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase warns against awaiting its own calls inside this callback
    setTimeout(() => publish(toUser(session?.user)), 0);
  });
}

/**
 * dev-time-tracker://oauth-callback#… or ?… from GitHub sign-in, email
 * confirmation or password reset. Never logs the URL: it carries tokens.
 */
export async function handleAuthCallbackUrl(url: string) {
  const hash = url.indexOf("#");
  const query = url.indexOf("?");
  const raw =
    hash !== -1
      ? url.slice(hash + 1)
      : query !== -1
        ? url.slice(query + 1)
        : "";
  const params = new URLSearchParams(raw);

  if (params.get("error")) {
    notice(params.get("error_description") || "Sign-in failed", "error");
    return;
  }
  const code = params.get("code");
  const accessToken = params.get("access_token");
  const type = params.get("type");
  try {
    const { data, error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : accessToken
        ? await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: params.get("refresh_token") || "",
          })
        : { data: { session: null }, error: null };
    if (error) throw error;
    const user = data.session?.user;
    if (!user) return;

    const isRecovery =
      type === "recovery" ||
      !!(user as { recovery_sent_at?: string }).recovery_sent_at;
    if (isRecovery) {
      send("auth-password-recovery");
    } else if (type === "signup" || type === "email") {
      notice("Email confirmed! Welcome!");
    } else {
      notice("Signed in!");
    }
  } catch (err) {
    logError("handleAuthCallbackUrl", err);
    notice(
      `Sign-in failed: ${(err as Error)?.message ?? "unknown error"}`,
      "error",
    );
  }
}

// ── IPC ──────────────────────────────────────────────────────────────

ipcMain.handle("auth:get-user", async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return toUser(session?.user);
});

ipcMain.handle("auth:sign-in", (_event, email: unknown, password: unknown) =>
  wrap(async () => {
    if (!isText(email) || !isText(password))
      throw new Error("Email and password are required");
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return { user: toUser(data.user) };
  }),
);

ipcMain.handle(
  "auth:sign-up",
  (_event, email: unknown, password: unknown, username: unknown) =>
    wrap(async () => {
      if (!isText(email) || !isText(password))
        throw new Error("Email and password are required");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username: isText(username, 100) ? username : undefined },
          emailRedirectTo: REDIRECT,
        },
      });
      if (error) throw error;
      // No session until the email is confirmed (when confirmation is on)
      return { user: data.session ? toUser(data.user) : null };
    }),
);

ipcMain.handle("auth:reset-password", (_event, email: unknown) =>
  wrap(async () => {
    if (!isText(email)) throw new Error("Email is required");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: REDIRECT,
    });
    if (error) throw error;
    return true;
  }),
);

ipcMain.handle("auth:resend-verification", (_event, email: unknown) =>
  wrap(async () => {
    if (!isText(email)) throw new Error("Email is required");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: REDIRECT },
    });
    if (error) throw error;
    return true;
  }),
);

ipcMain.handle("auth:update-password", (_event, password: unknown) =>
  wrap(async () => {
    if (!isText(password)) throw new Error("Password is required");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    return true;
  }),
);

/** Opens GitHub in the browser; the result comes back on the deep link. */
ipcMain.handle("auth:sign-in-github", () =>
  wrap(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url || !/^https:\/\//.test(data.url))
      throw new Error("No sign-in URL");
    await shell.openExternal(data.url);
    return true;
  }),
);

/** Signs out everywhere; if the server can't be reached, at least here. */
export async function signOutEverywhere() {
  const { error } = await supabase.auth.signOut();
  if (error) await supabase.auth.signOut({ scope: "local" });
}

/**
 * One-time move from versions where the renderer kept the session in
 * localStorage: main takes over that login with its refresh token.
 */
ipcMain.handle("auth:import-legacy-session", (_event, refreshToken: unknown) =>
  wrap(async () => {
    if (!isText(refreshToken, 2000)) return false;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) return false;
    const { error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return true;
  }),
);

/** Can we reach Supabase? (The renderer has no network access to it.) */
ipcMain.handle("check-connection", async () => {
  try {
    const { error } = await supabase
      .from("user_profiles")
      .select("id")
      .limit(1)
      .maybeSingle();
    return !error;
  } catch {
    return false;
  }
});
