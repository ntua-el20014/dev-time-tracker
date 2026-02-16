import { supabase } from "./config";
import { Database } from "../types/database.types";

type DailyGoalInsert =
  Database["public"]["Tables"]["daily_work_goals"]["Insert"];

/**
 * Set or update a daily goal for a specific date.
 * If a goal already exists for that date, it will be updated.
 */
export async function setDailyGoal(
  userId: string,
  date: string,
  targetMinutes: number,
  description?: string | null,
) {
  const goalData: DailyGoalInsert = {
    user_id: userId,
    date: date,
    target_minutes: targetMinutes,
    description: description || null,
    is_completed: false,
  };

  // Use upsert to insert or update if exists
  // The unique constraint on (user_id, date) will handle conflicts
  const { data, error } = await (supabase as any)
    .from("daily_work_goals")
    .upsert(goalData, {
      onConflict: "user_id,date",
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Get the daily goal for a specific date.
 */
export async function getDailyGoal(userId: string, date: string) {
  const { data, error } = await supabase
    .from("daily_work_goals")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .single();

  if (error) {
    // Return null if not found (error code 'PGRST116')
    if (error.code === "PGRST116") {
      return null;
    }
    throw error;
  }

  return data;
}

/**
 * Mark a daily goal as completed.
 */
export async function completeDailyGoal(userId: string, date: string) {
  const { data, error } = await (supabase as any)
    .from("daily_work_goals")
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("date", date)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Delete a daily goal for a specific date.
 */
export async function deleteDailyGoal(userId: string, date: string) {
  const { error } = await supabase
    .from("daily_work_goals")
    .delete()
    .eq("user_id", userId)
    .eq("date", date);

  if (error) {
    throw error;
  }
}

/**
 * Get all daily goals for a user, ordered by date descending.
 */
export async function getAllDailyGoals(userId: string) {
  const { data, error } = await supabase
    .from("daily_work_goals")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

/**
 * Get the total time spent (in minutes) for a specific day.
 * Sums up all time_spent_seconds from daily_usage_summary for the given date.
 */
export async function getTotalTimeForDay(
  userId: string,
  date: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("daily_usage_summary")
    .select("time_spent_seconds")
    .eq("user_id", userId)
    .eq("date", date);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    return 0;
  }

  // Sum all time_spent_seconds and convert to minutes
  const totalSeconds = data.reduce(
    (sum, row) => sum + (row.time_spent_seconds || 0),
    0,
  );

  return totalSeconds / 60;
}
