import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const handlers: Record<string, Function> = {};
const openExternal = vi.fn();
vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/dtt-test" },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers[channel] = handler;
    }),
  },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: (url: string) => openExternal(url) },
}));

vi.mock("../../src/supabase/authStorage", () => ({ initAuthStorage: vi.fn(async () => {}) }));
vi.mock("../../src/utils/errorHandler", () => ({ logError: vi.fn() }));

let authListener: ((event: string, session: any) => void) | null = null;
const auth = {
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  updateUser: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  onAuthStateChange: vi.fn((cb) => {
    authListener = cb;
    return { data: { subscription: { unsubscribe() {} } } };
  }),
};
vi.mock("../../src/supabase/config", () => ({
  supabase: {
    auth,
    from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ error: null }) }) }) }),
  },
}));

const sent: Array<[string, unknown]> = [];
const win = {
  isDestroyed: () => false,
  webContents: {
    isLoading: () => false,
    send: (channel: string, payload: unknown) => sent.push([channel, payload]),
    once: vi.fn(),
  },
};
const onUserChange = vi.fn();
let mod: typeof import("../../src/ipc/authHandlers");

beforeAll(async () => {
  mod = await import("../../src/ipc/authHandlers");
  await mod.initAuth({ getWindow: () => win as any, onUserChange });
});

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
});

const user = { id: "u1", email: "a@b.c", aud: "authenticated" };
const session = { access_token: "AT", refresh_token: "RT", user };
const flush = () => new Promise((r) => setTimeout(r, 5));

describe("auth handlers", () => {
  it("reports the signed-in user without tokens", async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    const result = await handlers["auth:get-user"]({});
    expect(result).toEqual({ id: "u1", email: "a@b.c" });
    expect(JSON.stringify(result)).not.toContain("RT");
  });

  it("signs in and returns only the user; errors come back as a message", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user, session }, error: null });
    const ok = await handlers["auth:sign-in"]({}, "a@b.c", "pw");
    expect(ok).toEqual({ ok: true, value: { user: { id: "u1", email: "a@b.c" } } });
    expect(JSON.stringify(ok)).not.toContain("AT");

    auth.signInWithPassword.mockResolvedValue({ data: {}, error: new Error("Invalid login credentials") });
    expect(await handlers["auth:sign-in"]({}, "a@b.c", "bad")).toEqual({
      ok: false,
      error: "Invalid login credentials",
    });
    expect(await handlers["auth:sign-in"]({}, { email: 1 }, "pw")).toMatchObject({ ok: false });
  });

  it("sign-up returns no user until the email is confirmed", async () => {
    auth.signUp.mockResolvedValue({ data: { user, session: null }, error: null });
    expect(await handlers["auth:sign-up"]({}, "a@b.c", "pw", "al")).toEqual({ ok: true, value: { user: null } });
    expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe("dev-time-tracker://oauth-callback");
  });

  it("opens only an https GitHub URL", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://github.com/login/oauth" }, error: null });
    expect(await handlers["auth:sign-in-github"]({})).toEqual({ ok: true, value: true });
    expect(openExternal).toHaveBeenCalledWith("https://github.com/login/oauth");
    auth.signInWithOAuth.mockResolvedValue({ data: { url: "file:///calc.exe" }, error: null });
    expect(await handlers["auth:sign-in-github"]({})).toMatchObject({ ok: false });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("publishes sign-in and sign-out once per user change, to tracker and renderer", async () => {
    authListener!("INITIAL_SESSION", session);
    authListener!("TOKEN_REFRESHED", session);
    await flush();
    expect(onUserChange.mock.calls).toEqual([["u1"]]);
    expect(sent).toEqual([["auth-state", { user: { id: "u1", email: "a@b.c" } }]]);

    authListener!("SIGNED_OUT", null);
    await flush();
    expect(onUserChange).toHaveBeenLastCalledWith(null);
    expect(sent.at(-1)).toEqual(["auth-state", null]);
  });

  it("imports a legacy renderer login only when main has no session", async () => {
    auth.getSession.mockResolvedValue({ data: { session } });
    expect(await handlers["auth:import-legacy-session"]({}, "old-rt")).toEqual({ ok: true, value: false });
    expect(auth.refreshSession).not.toHaveBeenCalled();
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.refreshSession.mockResolvedValue({ data: { session }, error: null });
    expect(await handlers["auth:import-legacy-session"]({}, "old-rt")).toEqual({ ok: true, value: true });
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: "old-rt" });
  });

  it("finishes OAuth and email links in main", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session }, error: null });
    await mod.handleAuthCallbackUrl("dev-time-tracker://oauth-callback?code=abc");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(sent).toContainEqual(["auth-notice", { message: "Signed in!", type: "info" }]);

    sent.length = 0;
    auth.setSession.mockResolvedValue({ data: { session }, error: null });
    await mod.handleAuthCallbackUrl("dev-time-tracker://oauth-callback#access_token=a&refresh_token=r&type=recovery");
    expect(sent).toContainEqual(["auth-password-recovery", undefined]);

    sent.length = 0;
    await mod.handleAuthCallbackUrl("dev-time-tracker://oauth-callback#error=access_denied&error_description=Denied");
    expect(sent).toEqual([["auth-notice", { message: "Denied", type: "error" }]]);
  });

  it("signs out locally when the server can't be reached", async () => {
    auth.signOut.mockResolvedValueOnce({ error: new Error("offline") }).mockResolvedValueOnce({ error: null });
    await mod.signOutEverywhere();
    expect(auth.signOut).toHaveBeenLastCalledWith({ scope: "local" });
  });
});
