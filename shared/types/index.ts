export interface DailySummaryRow {
  date: string;
  app: string;
  language?: string;
  lang_ext?: string;
  icon?: string;
  total_time: number;
}

export interface SessionRow {
  id: number;
  timestamp: string;
  start_time: string;
  duration: number;
  title: string;
  description: string | null;
  tags?: string[];
  date: string;
}

export interface LogEntry {
  icon: string;
  app: string;
  language: string;
  lang_ext?: string;
  time_spent: number;
}

export interface Tag {
  id: number;
  name: string;
  color?: string;
}

export interface SessionTag {
  session_id: number;
  tag_id: number;
}

export type DailySummaryFilters = {
  language?: string;
  app?: string;
  startDate?: string;
  endDate?: string;
};

export interface User {
  id: number;
  username: string;
  avatar: string;
  role: UserRole;
}

export enum UserRole {
  ADMIN = "admin",
  MANAGER = "manager",
  EMPLOYEE = "employee",
}

export interface DailyGoal {
  id: number;
  user_id: number;
  date: string;
  time: number;
  description: string;
  isCompleted: number;
}

export interface ScheduledSession {
  id?: number;
  user_id: number;
  title: string;
  description?: string;
  scheduled_datetime: string; // ISO datetime string
  estimated_duration?: number; // in minutes
  recurrence_type: "none" | "weekly";
  recurrence_data?: RecurrenceData;
  status: "pending" | "notified" | "completed" | "missed" | "cancelled";
  created_at?: string;
  last_notification_sent?: string;
  actual_session_id?: number;
  tags?: string[];
}

export interface RecurrenceData {
  dayOfWeek?: number; // 0-6, Sunday is 0
  endDate?: string; // ISO date string, when to stop recurring
  occurrences?: number; // number of times to repeat
}

export interface ScheduledSessionNotification {
  id: number;
  title: string;
  scheduled_datetime: string;
  estimated_duration?: number;
  type: "day_before" | "same_day" | "time_to_start";
  tags?: string[];
}
