import { ipcMain } from "electron";
import {
  getCurrentUser,
  getUserProfile,
  updateUserProfileData,
} from "../supabase/api";
import {
  getCurrentOrganization,
  getOrganizationMembers,
  updateUserRole,
  removeUserFromOrganization,
  getCurrentUserProfile,
} from "../supabase/organizations";
import type { UserRole } from "../../shared/types";

/**
 * Get or create default users (Supabase version)
 * In Supabase, users are created through signup, so this just returns the current user
 */
ipcMain.handle("get-or-create-default-users", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return [];

    const profile = await getCurrentUserProfile(user.id);
    if (!profile) return [];

    return [profile];
  } catch (err) {
    return [];
  }
});

/**
 * Create a new user
 * Note: In Supabase, user creation is handled through signUp in the auth flow
 * This handler is kept for backwards compatibility but doesn't create users
 */
ipcMain.handle("create-user", async (_event, _data: any) => {
  // User creation is handled through Supabase Auth signup
  // This handler is deprecated but kept for compatibility
  return null;
});

/**
 * Get all users in the current user's organization
 */
ipcMain.handle("get-all-users", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return [];

    const org = await getCurrentOrganization(user.id);
    if (!org) {
      // If no organization, just return current user
      const profile = await getCurrentUserProfile(user.id);
      return profile ? [profile] : [];
    }

    return await getOrganizationMembers(org.id);
  } catch (err) {
    return [];
  }
});

/**
 * Set current user (Supabase version)
 * In Supabase, the current user is always the authenticated user
 * This handler is kept for backwards compatibility but doesn't change the user
 */
ipcMain.handle("set-current-user", async (_event) => {
  // In Supabase, current user is determined by authentication
  // This handler is deprecated but kept for compatibility
  return true;
});

/**
 * Get the current authenticated user
 * Returns the user profile
 */
ipcMain.handle("get-current-user", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    return await getCurrentUserProfile(user.id);
  } catch (err) {
    return null;
  }
});

/**
 * Get current user ID
 * Returns just the user ID
 */
ipcMain.handle("get-current-user-id", async (_event) => {
  try {
    const user = await getCurrentUser();
    return user?.id || null;
  } catch (err) {
    return null;
  }
});

/**
 * Delete a user
 * In Supabase, this removes the user from the organization
 */
ipcMain.handle("delete-user", async (_event, userId: number | string) => {
  try {
    await removeUserFromOrganization(String(userId));
    return true;
  } catch (err) {
    return false;
  }
});

/**
 * Set user avatar
 */
ipcMain.handle("set-user-avatar", async (_event, avatar: string) => {
  try {
    await updateUserProfileData({ avatar });
    return true;
  } catch (err) {
    return false;
  }
});

/**
 * Set user role (in organization)
 */
ipcMain.handle(
  "set-user-role",
  async (_event, userId: number | string, role: UserRole) => {
    try {
      // Map UserRole to organization role
      let orgRole: "admin" | "manager" | "employee";
      if (role === "admin") {
        orgRole = "admin";
      } else if (role === "manager") {
        orgRole = "manager";
      } else {
        orgRole = "employee";
      }

      await updateUserRole(String(userId), orgRole);
      return true;
    } catch (err) {
      return false;
    }
  },
);

/**
 * Get user info by ID
 */
ipcMain.handle("get-user-info", async (_event, userId: number | string) => {
  try {
    return await getUserProfile(String(userId));
  } catch (err) {
    return null;
  }
});

/**
 * Check if user is an admin
 */
ipcMain.handle("is-user-admin", async (_event, userId: number | string) => {
  try {
    const profile = await getUserProfile(String(userId));
    return profile?.role === "admin";
  } catch (err) {
    return false;
  }
});

/**
 * Check if user is a manager or admin
 */
ipcMain.handle(
  "is-user-manager-or-admin",
  async (_event, userId: number | string) => {
    try {
      const profile = await getUserProfile(String(userId));
      return profile?.role === "admin" || profile?.role === "manager";
    } catch (err) {
      return false;
    }
  },
);

/**
 * Get user role
 */
ipcMain.handle("get-user-role", async (_event, userId: number | string) => {
  try {
    const profile = await getUserProfile(String(userId));
    return profile?.role || null;
  } catch (err) {
    return null;
  }
});
