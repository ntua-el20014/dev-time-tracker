import { supabase } from "./config";
import { Database } from "../types/database.types";

type UserPreferencesRow =
  Database["public"]["Tables"]["user_preferences"]["Row"];
type UserPreferencesInsert =
  Database["public"]["Tables"]["user_preferences"]["Insert"];
type UserPreferencesUpdate =
  Database["public"]["Tables"]["user_preferences"]["Update"];

export interface EditorColors {
  [editorName: string]: string;
}

export interface AccentColors {
  light: string;
  dark: string;
}

export interface NotificationSettings {
  enabled?: boolean;
  scheduledSessions?: boolean;
  dailyGoals?: boolean;
  [key: string]: any;
}

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  accent_color: AccentColors;
  editor_colors: EditorColors;
  notification_settings: NotificationSettings;
  idle_timeout_seconds: number;
}

/**
 * Get user preferences. If preferences don't exist, they will be created with defaults.
 */
export async function getUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) {
    // If preferences don't exist (PGRST116), create defaults
    if (error.code === "PGRST116") {
      return await createDefaultPreferences(userId);
    }
    throw error;
  }

  return parsePreferences(data);
}

/**
 * Update user preferences (partial update).
 */
export async function updateUserPreferences(
  userId: string,
  preferences: Partial<UserPreferences>,
) {
  const updateData: UserPreferencesUpdate = {
    updated_at: new Date().toISOString(),
  };

  if (preferences.theme !== undefined) {
    updateData.theme = preferences.theme;
  }
  if (preferences.accent_color !== undefined) {
    updateData.accent_color = preferences.accent_color as any;
  }
  if (preferences.editor_colors !== undefined) {
    updateData.editor_colors = preferences.editor_colors as any;
  }
  if (preferences.notification_settings !== undefined) {
    updateData.notification_settings = preferences.notification_settings as any;
  }
  if (preferences.idle_timeout_seconds !== undefined) {
    updateData.idle_timeout_seconds = preferences.idle_timeout_seconds;
  }

  const { data, error } = await (supabase as any)
    .from("user_preferences")
    .update(updateData)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return parsePreferences(data);
}

/**
 * Get editor colors (app name to color mapping).
 */
export async function getEditorColors(userId: string): Promise<EditorColors> {
  const prefs = await getUserPreferences(userId);
  return prefs.editor_colors;
}

/**
 * Set color for a specific editor.
 */
export async function setEditorColor(
  userId: string,
  editorName: string,
  color: string,
) {
  const editorColors = await getEditorColors(userId);
  editorColors[editorName] = color;

  await updateUserPreferences(userId, {
    editor_colors: editorColors,
  });
}

/**
 * Get current theme preference.
 */
export async function getTheme(
  userId: string,
): Promise<"light" | "dark" | "system"> {
  const prefs = await getUserPreferences(userId);
  return prefs.theme;
}

/**
 * Set theme preference.
 */
export async function setTheme(
  userId: string,
  theme: "light" | "dark" | "system",
) {
  await updateUserPreferences(userId, { theme });
}

/**
 * Get accent color for a specific theme mode.
 */
export async function getAccentColor(
  userId: string,
  themeMode: "light" | "dark",
): Promise<string> {
  const prefs = await getUserPreferences(userId);
  return prefs.accent_color[themeMode];
}

/**
 * Set accent color for a specific theme mode.
 */
export async function setAccentColor(
  userId: string,
  color: string,
  themeMode: "light" | "dark",
) {
  const prefs = await getUserPreferences(userId);
  const accentColors = { ...prefs.accent_color };
  accentColors[themeMode] = color;

  await updateUserPreferences(userId, {
    accent_color: accentColors,
  });
}

/**
 * Get notification settings.
 */
export async function getNotificationSettings(
  userId: string,
): Promise<NotificationSettings> {
  const prefs = await getUserPreferences(userId);
  return prefs.notification_settings;
}

/**
 * Update notification settings.
 */
export async function setNotificationSettings(
  userId: string,
  settings: NotificationSettings,
) {
  await updateUserPreferences(userId, {
    notification_settings: settings,
  });
}

/**
 * Get idle timeout in seconds.
 */
export async function getIdleTimeout(userId: string): Promise<number> {
  const prefs = await getUserPreferences(userId);
  return prefs.idle_timeout_seconds;
}

/**
 * Set idle timeout in seconds.
 */
export async function setIdleTimeout(userId: string, seconds: number) {
  await updateUserPreferences(userId, {
    idle_timeout_seconds: seconds,
  });
}

/**
 * Helper: Create default preferences for a new user.
 */
async function createDefaultPreferences(
  userId: string,
): Promise<UserPreferences> {
  const defaultPrefs: UserPreferencesInsert = {
    user_id: userId,
    theme: "dark",
    accent_color: {
      light: "#007acc",
      dark: "#f0db4f",
    } as any,
    editor_colors: {} as any,
    notification_settings: {
      enabled: true,
      scheduledSessions: true,
      dailyGoals: true,
    } as any,
    idle_timeout_seconds: 300,
  };

  const { data, error } = await (supabase as any)
    .from("user_preferences")
    .insert(defaultPrefs)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return parsePreferences(data);
}

/**
 * Helper: Parse database row to UserPreferences object.
 */
function parsePreferences(data: UserPreferencesRow): UserPreferences {
  return {
    theme: data.theme,
    accent_color: (data.accent_color as any) || {
      light: "#007acc",
      dark: "#f0db4f",
    },
    editor_colors: (data.editor_colors as any) || {},
    notification_settings: (data.notification_settings as any) || {
      enabled: true,
      scheduledSessions: true,
      dailyGoals: true,
    },
    idle_timeout_seconds: data.idle_timeout_seconds || 300,
  };
}
