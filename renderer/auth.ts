/**
 * Renderer side of authentication. The main process owns the Supabase
 * session (src/ipc/authHandlers.ts); this module only asks it over IPC and
 * hears about sign-in/out on "auth-state". It never sees a token.
 */
import { ipcRenderer } from "./ipc";

export interface AuthUser {
  id: string;
  email: string | null;
}

/** What callers used to get as a Supabase session: just the user. */
export interface AuthSession {
  user: AuthUser;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as Result<T>;
  if (!result || !result.ok)
    throw new Error(result?.error || "Authentication failed");
  return result.value;
}

/** The signed-in user, or null. */
export async function getAuthUser(): Promise<AuthUser | null> {
  return (await ipcRenderer.invoke("auth:get-user")) as AuthUser | null;
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthSession> {
  const { user } = await call<{ user: AuthUser }>(
    "auth:sign-in",
    email,
    password,
  );
  return { user };
}

/** Session is null until the email is confirmed (if confirmation is on). */
export async function signUpWithEmail(
  email: string,
  password: string,
  username: string,
): Promise<{ session: AuthSession | null }> {
  const { user } = await call<{ user: AuthUser | null }>(
    "auth:sign-up",
    email,
    password,
    username,
  );
  return { session: user ? { user } : null };
}

export async function resetPasswordForEmail(email: string): Promise<void> {
  await call("auth:reset-password", email);
}

export async function resendVerificationEmail(email: string): Promise<void> {
  await call("auth:resend-verification", email);
}

export async function updatePassword(password: string): Promise<void> {
  await call("auth:update-password", password);
}

/** Opens GitHub in the browser; sign-in completes through "auth-state". */
export async function signInWithGitHub(): Promise<void> {
  await call("auth:sign-in-github");
}

export async function signOut(): Promise<void> {
  await ipcRenderer.invoke("auth:sign-out");
}

/** Called with the session on sign-in and null on sign-out (or expiry). */
export function onAuthState(listener: (session: AuthSession | null) => void) {
  return ipcRenderer.on(
    "auth-state",
    (_event: unknown, session: AuthSession | null) => listener(session),
  );
}

/**
 * Before main owned the session, the renderer kept it in localStorage
 * ("sb-<project>-auth-token"). Hand that login to main once, then delete it
 * so no token stays in the renderer.
 */
export async function importLegacySession(): Promise<void> {
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) =>
      /^sb-.+-auth-token$/.test(k),
    );
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      const refreshToken =
        stored?.refresh_token ?? stored?.currentSession?.refresh_token;
      if (typeof refreshToken === "string") {
        await ipcRenderer.invoke("auth:import-legacy-session", refreshToken);
      }
    } catch {
      // Unusable: the user signs in again
    }
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}-code-verifier`);
    } catch {
      // ignore
    }
  }
}
