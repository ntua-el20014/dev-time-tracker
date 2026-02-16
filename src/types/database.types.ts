export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TimestampString = string;

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          name?: string;
          updated_at?: TimestampString;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          username: string;
          email: string | null;
          avatar: string | null;
          role: "admin" | "manager" | "employee";
          org_id: string | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id: string;
          username: string;
          email?: string | null;
          avatar?: string | null;
          role?: "admin" | "manager" | "employee";
          org_id?: string | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          username?: string;
          email?: string | null;
          avatar?: string | null;
          role?: "admin" | "manager" | "employee";
          org_id?: string | null;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "user_profiles_id_fkey";
            columns: ["id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_profiles_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_join_requests: {
        Row: {
          id: string;
          user_id: string;
          org_id: string;
          status: "pending" | "approved" | "rejected";
          requested_at: TimestampString;
          reviewed_at: TimestampString | null;
          reviewed_by: string | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          org_id: string;
          status?: "pending" | "approved" | "rejected";
          requested_at?: TimestampString;
          reviewed_at?: TimestampString | null;
          reviewed_by?: string | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          status?: "pending" | "approved" | "rejected";
          reviewed_at?: TimestampString | null;
          reviewed_by?: string | null;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "org_join_requests_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_join_requests_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_join_requests_reviewed_by_fkey";
            columns: ["reviewed_by"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      cloud_projects: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          color: string;
          scope: "personal" | "organization";
          is_active: boolean;
          manager_id: string;
          org_id: string | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          color?: string;
          scope?: "personal" | "organization";
          is_active?: boolean;
          manager_id: string;
          org_id?: string | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          name?: string;
          description?: string | null;
          color?: string;
          scope?: "personal" | "organization";
          is_active?: boolean;
          manager_id?: string;
          org_id?: string | null;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "cloud_projects_manager_id_fkey";
            columns: ["manager_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cloud_projects_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          role: "manager" | "member";
          assigned_at: TimestampString;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          role?: "manager" | "member";
          assigned_at?: TimestampString;
        };
        Update: {
          role?: "manager" | "member";
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "cloud_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      time_tracking_sessions: {
        Row: {
          id: string;
          user_id: string;
          org_id: string | null;
          project_id: string | null;
          title: string | null;
          description: string | null;
          start_time: TimestampString;
          end_time: TimestampString | null;
          duration: number | null;
          is_billable: boolean;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          org_id?: string | null;
          project_id?: string | null;
          title?: string | null;
          description?: string | null;
          start_time: TimestampString;
          end_time?: TimestampString | null;
          duration?: number | null;
          is_billable?: boolean;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          org_id?: string | null;
          project_id?: string | null;
          title?: string | null;
          description?: string | null;
          start_time?: TimestampString;
          end_time?: TimestampString | null;
          duration?: number | null;
          is_billable?: boolean;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "time_tracking_sessions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_tracking_sessions_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_tracking_sessions_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "cloud_projects";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_logs: {
        Row: {
          id: string;
          user_id: string;
          org_id: string | null;
          session_id: string | null;
          app_name: string;
          window_title: string | null;
          language: string | null;
          language_extension: string | null;
          icon_url: string | null;
          timestamp: TimestampString;
          created_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          org_id?: string | null;
          session_id?: string | null;
          app_name: string;
          window_title?: string | null;
          language?: string | null;
          language_extension?: string | null;
          icon_url?: string | null;
          timestamp: TimestampString;
          created_at?: TimestampString;
        };
        Update: {
          org_id?: string | null;
          session_id?: string | null;
          app_name?: string;
          window_title?: string | null;
          language?: string | null;
          language_extension?: string | null;
          icon_url?: string | null;
          timestamp?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "usage_logs_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_logs_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "usage_logs_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "time_tracking_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_usage_summary: {
        Row: {
          id: string;
          user_id: string;
          org_id: string | null;
          date: string;
          app_name: string;
          language: string | null;
          language_extension: string | null;
          icon_url: string | null;
          time_spent_seconds: number;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          org_id?: string | null;
          date: string;
          app_name: string;
          language?: string | null;
          language_extension?: string | null;
          icon_url?: string | null;
          time_spent_seconds?: number;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          org_id?: string | null;
          app_name?: string;
          language?: string | null;
          language_extension?: string | null;
          icon_url?: string | null;
          time_spent_seconds?: number;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "daily_usage_summary_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_usage_summary_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_tags: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color?: string;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          name?: string;
          color?: string;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "user_tags_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      session_tags: {
        Row: {
          session_id: string;
          tag_id: string;
          created_at: TimestampString;
        };
        Insert: {
          session_id: string;
          tag_id: string;
          created_at?: TimestampString;
        };
        Update: {
          session_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_tags_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "time_tracking_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_tags_tag_id_fkey";
            columns: ["tag_id"];
            referencedRelation: "user_tags";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_work_goals: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          target_minutes: number;
          description: string | null;
          is_completed: boolean;
          completed_at: TimestampString | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          date: string;
          target_minutes: number;
          description?: string | null;
          is_completed?: boolean;
          completed_at?: TimestampString | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          target_minutes?: number;
          description?: string | null;
          is_completed?: boolean;
          completed_at?: TimestampString | null;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "daily_work_goals_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_work_sessions: {
        Row: {
          id: string;
          user_id: string;
          org_id: string | null;
          project_id: string | null;
          title: string;
          description: string | null;
          scheduled_datetime: TimestampString;
          estimated_duration_minutes: number | null;
          recurrence_type: "none" | "weekly";
          recurrence_data: Json | null;
          status: "pending" | "notified" | "completed" | "missed" | "cancelled";
          actual_session_id: string | null;
          last_notification_sent: TimestampString | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          org_id?: string | null;
          project_id?: string | null;
          title: string;
          description?: string | null;
          scheduled_datetime: TimestampString;
          estimated_duration_minutes?: number | null;
          recurrence_type?: "none" | "weekly";
          recurrence_data?: Json | null;
          status?:
            | "pending"
            | "notified"
            | "completed"
            | "missed"
            | "cancelled";
          actual_session_id?: string | null;
          last_notification_sent?: TimestampString | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          org_id?: string | null;
          project_id?: string | null;
          title?: string;
          description?: string | null;
          scheduled_datetime?: TimestampString;
          estimated_duration_minutes?: number | null;
          recurrence_type?: "none" | "weekly";
          recurrence_data?: Json | null;
          status?:
            | "pending"
            | "notified"
            | "completed"
            | "missed"
            | "cancelled";
          actual_session_id?: string | null;
          last_notification_sent?: TimestampString | null;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_work_sessions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_work_sessions_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_work_sessions_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "cloud_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_work_sessions_actual_session_id_fkey";
            columns: ["actual_session_id"];
            referencedRelation: "time_tracking_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_session_tags: {
        Row: {
          scheduled_session_id: string;
          tag_id: string;
          created_at: TimestampString;
        };
        Insert: {
          scheduled_session_id: string;
          tag_id: string;
          created_at?: TimestampString;
        };
        Update: {
          scheduled_session_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_session_tags_scheduled_session_id_fkey";
            columns: ["scheduled_session_id"];
            referencedRelation: "scheduled_work_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_session_tags_tag_id_fkey";
            columns: ["tag_id"];
            referencedRelation: "user_tags";
            referencedColumns: ["id"];
          },
        ];
      };
      user_preferences: {
        Row: {
          id: string;
          user_id: string;
          theme: "light" | "dark" | "system";
          accent_color: string;
          editor_colors: Json;
          notification_settings: Json;
          idle_timeout_seconds: number;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          user_id: string;
          theme?: "light" | "dark" | "system";
          accent_color?: string;
          editor_colors?: Json;
          notification_settings?: Json;
          idle_timeout_seconds?: number;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          theme?: "light" | "dark" | "system";
          accent_color?: string;
          editor_colors?: Json;
          notification_settings?: Json;
          idle_timeout_seconds?: number;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}
