import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockResult,
  resetMockState,
  getCallsFor,
} from "../helpers/supabaseMock";

vi.mock("../../src/supabase/config", async () => {
  const { mockSupabase } = await import("../helpers/supabaseMock");
  return { supabase: mockSupabase };
});

import { mockSupabase } from "../helpers/supabaseMock";

import {
  getCurrentSession,
  getCurrentUser,
  signInWithEmail,
  signUpWithEmail,
  resetPasswordForEmail,
  resendVerificationEmail,
  updatePassword,
  createUserProfile,
  getUserProfile,
  updateUserProfileData,
  updateUserProfile,
  checkAuthStatus,
  onAuthStateChange,
} from "../../src/supabase/api";

describe("supabase api", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", {
      removeItem: vi.fn(),
    } as any);
  });

  it("returns the current session", async () => {
    const session = { user: { id: "user-1" } };
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session },
      error: null,
    });

    await expect(getCurrentSession()).resolves.toEqual(session);
  });

  it("falls back to the cached session when getUser fails", async () => {
    mockSupabase.auth.getUser.mockRejectedValueOnce(new Error("network"));
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: "fallback-user" } } },
      error: null,
    });

    await expect(getCurrentUser()).resolves.toEqual({ id: "fallback-user" });
  });

  it("signs in with email and password", async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });

    await expect(signInWithEmail("a@b.com", "secret")).resolves.toEqual({
      user: { id: "user-1" },
    });

    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "secret",
    });
  });

  it("signs up with username metadata and redirect", async () => {
    mockSupabase.auth.signUp = vi.fn().mockResolvedValueOnce({
      data: { user: { id: "new-user" } },
      error: null,
    });

    await expect(
      signUpWithEmail("a@b.com", "secret", "alice"),
    ).resolves.toEqual({ user: { id: "new-user" } });

    expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "secret",
      options: {
        data: { username: "alice" },
        emailRedirectTo: "dev-time-tracker://oauth-callback",
      },
    });
  });

  it("requests password reset and verification emails with the app redirect", async () => {
    mockSupabase.auth.resetPasswordForEmail.mockResolvedValueOnce({
      error: null,
    });
    mockSupabase.auth.resend.mockResolvedValueOnce({ error: null });

    await expect(resetPasswordForEmail("a@b.com")).resolves.toBeUndefined();
    await expect(resendVerificationEmail("a@b.com")).resolves.toBeUndefined();

    expect(mockSupabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "a@b.com",
      { redirectTo: "dev-time-tracker://oauth-callback" },
    );
    expect(mockSupabase.auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "a@b.com",
      options: { emailRedirectTo: "dev-time-tracker://oauth-callback" },
    });
  });

  it("updates the password and returns auth data", async () => {
    mockSupabase.auth.updateUser.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });

    await expect(updatePassword("new-secret")).resolves.toEqual({
      user: { id: "user-1" },
    });
  });

  it("creates and fetches user profiles", async () => {
    mockResult({
      data: { id: "user-1", username: "alice" },
      error: null,
    });

    await expect(
      createUserProfile({ id: "user-1", username: "alice" }),
    ).resolves.toEqual({ id: "user-1", username: "alice" });

    mockResult({
      data: { id: "user-1", username: "alice" },
      error: null,
    });

    await expect(getUserProfile("user-1")).resolves.toEqual({
      id: "user-1",
      username: "alice",
    });
  });

  it("updates the current user's profile data", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockResult({
      data: { id: "user-1", username: "updated" },
      error: null,
    });

    await expect(
      updateUserProfileData({ username: "updated" }),
    ).resolves.toEqual({ id: "user-1", username: "updated" });

    const eqCalls = getCallsFor("eq");
    expect(eqCalls.some((call) => call.args[1] === "user-1")).toBe(true);
  });

  it("updates the auth user profile metadata", async () => {
    mockSupabase.auth.updateUser.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });

    await expect(
      updateUserProfile({ username: "alice", avatar_url: "avatar.png" }),
    ).resolves.toEqual({ user: { id: "user-1" } });

    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({
      data: { username: "alice", avatar_url: "avatar.png" },
    });
  });

  it("checks auth status and auth state changes", async () => {
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });

    await expect(checkAuthStatus()).resolves.toBe(true);

    const callback = vi.fn();
    const refreshed = vi.fn();
    onAuthStateChange(callback, refreshed);

    const authCallback = mockSupabase.auth.onAuthStateChange.mock.calls[0][0];
    authCallback("SIGNED_OUT", null);
    expect(localStorage.removeItem as any).toHaveBeenCalledWith(
      "currentUserId",
    );
    expect(callback).toHaveBeenCalledWith(null);

    authCallback("TOKEN_REFRESHED", { user: { id: "user-1" } });
    expect(refreshed).toHaveBeenCalledWith({ user: { id: "user-1" } });
  });
});
