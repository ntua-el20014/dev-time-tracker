import { ipcMain } from "electron";
import * as userPreferences from "../../supabase/userPreferences";
import { getCurrentUser } from "../../supabase/api";
import { updateIdleTimeout } from "../../index";

/**
 * Get all user preferences
 */
ipcMain.handle("get-user-preferences", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await userPreferences.getUserPreferences(user.id);
  } catch (err) {
    // Error getting preferences - return defaults
    return {
      theme: "dark",
      accent_color: { light: "#007acc", dark: "#f0db4f" },
      editor_colors: {},
      notification_settings: {
        enabled: true,
        scheduledSessions: true,
        dailyGoals: true,
      },
      idle_timeout_seconds: 300,
    };
  }
});

/**
 * Update user preferences (partial update)
 */
ipcMain.handle(
  "update-user-preferences",
  async (_event, preferences: Partial<userPreferences.UserPreferences>) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await userPreferences.updateUserPreferences(user.id, preferences);
      return true;
    } catch (err) {
      // Error updating preferences
      return false;
    }
  },
);

/**
 * Get editor colors (app name to color mapping)
 */
ipcMain.handle("get-editor-colors", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await userPreferences.getEditorColors(user.id);
  } catch (err) {
    // Error getting editor colors
    return {};
  }
});

/**
 * Set color for a specific editor
 */
ipcMain.handle(
  "set-editor-color",
  async (_event, appName: string, color: string) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await userPreferences.setEditorColor(user.id, appName, color);
      return true;
    } catch (err) {
      // Error setting editor color
      return false;
    }
  },
);

/**
 * Get current theme preference
 */
ipcMain.handle("get-user-theme", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await userPreferences.getTheme(user.id);
  } catch (err) {
    // Error getting theme - return default
    return "dark";
  }
});

/**
 * Set theme preference
 */
ipcMain.handle(
  "set-user-theme",
  async (_event, theme: "light" | "dark" | "system") => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await userPreferences.setTheme(user.id, theme);
      return true;
    } catch (err) {
      // Error setting theme
      return false;
    }
  },
);

/**
 * Get accent color for a specific theme mode
 */
ipcMain.handle(
  "get-accent-color",
  async (_event, themeMode: "light" | "dark") => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      return await userPreferences.getAccentColor(user.id, themeMode);
    } catch (err) {
      // Error getting accent color - return default
      return themeMode === "dark" ? "#f0db4f" : "#007acc";
    }
  },
);

/**
 * Set accent color for a specific theme mode
 */
ipcMain.handle(
  "set-accent-color",
  async (_event, color: string, themeMode: "light" | "dark") => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await userPreferences.setAccentColor(user.id, color, themeMode);
      return true;
    } catch (err) {
      // Error setting accent color
      return false;
    }
  },
);

/**
 * Get notification settings
 */
ipcMain.handle("get-notification-settings", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await userPreferences.getNotificationSettings(user.id);
  } catch (err) {
    // Error getting notification settings - return defaults
    return {
      enabled: true,
      scheduledSessions: true,
      dailyGoals: true,
    };
  }
});

/**
 * Update notification settings
 */
ipcMain.handle(
  "set-notification-settings",
  async (_event, settings: userPreferences.NotificationSettings) => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      await userPreferences.setNotificationSettings(user.id, settings);
      return true;
    } catch (err) {
      // Error updating notification settings
      return false;
    }
  },
);

/**
 * Get idle timeout in seconds
 */
ipcMain.handle("get-idle-timeout", async (_event) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    return await userPreferences.getIdleTimeout(user.id);
  } catch (err) {
    // Error getting idle timeout - return default
    return 300; // 5 minutes
  }
});

/**
 * Set idle timeout in seconds
 */
ipcMain.handle("set-idle-timeout", async (_event, seconds: number) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }

    await userPreferences.setIdleTimeout(user.id, seconds);

    // Update the main process's idle timeout value immediately
    updateIdleTimeout(seconds);

    return true;
  } catch (err) {
    // Error setting idle timeout
    return false;
  }
});
