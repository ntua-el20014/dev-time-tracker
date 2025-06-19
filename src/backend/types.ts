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