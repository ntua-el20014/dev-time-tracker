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
          id?: string;
          name?: string;
          updated_at?: TimestampString;
        };
      };
      app_settings: {
        Row: {
          key: string;
          value: string | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          key: string;
          value?: string | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          value?: string | null;
          updated_at?: TimestampString;
        };
      };
      user_profiles: {
        Row: {
          id: string;
          local_id: string | null;
          username: string;
          avatar: string | null;
          role: "admin" | "manager" | "employee";
          org_id: string | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id: string;
          local_id?: string | null;
          username: string;
          avatar?: string | null;
          role?: "admin" | "manager" | "employee";
          org_id?: string | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          username?: string;
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
          }
        ];
      };
      tags: {
        Row: {
          id: string;
          local_id: string | null;
          name: string;
          user_id: string;
          color: string | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          local_id?: string | null;
          name: string;
          user_id: string;
          color?: string | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          name?: string;
          color?: string | null;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "tags_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      projects: {
        Row: {
          id: string;
          local_id: string | null;
          name: string;
          description: string | null;
          color: string | null;
          is_active: boolean;
          manager_id: string;
          org_id: string;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          local_id?: string | null;
          name: string;
          description?: string | null;
          color?: string | null;
          is_active?: boolean;
          manager_id: string;
          org_id: string;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          name?: string;
          description?: string | null;
          color?: string | null;
          is_active?: boolean;
          manager_id?: string;
          org_id?: string;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "projects_manager_id_fkey";
            columns: ["manager_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      project_members: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          role: "manager" | "employee";
          joined_at: TimestampString;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          role?: "manager" | "employee";
          joined_at?: TimestampString;
        };
        Update: {
          role?: "manager" | "employee";
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      usage_tracking: {
        Row: {
          id: string;
          local_id: string | null;
          user_id: string;
          app: string;
          title: string;
          language: string | null;
          timestamp: TimestampString;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          local_id?: string | null;
          user_id: string;
          app: string;
          title: string;
          language?: string | null;
          timestamp: TimestampString;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          app?: string;
          title?: string;
          language?: string | null;
          timestamp?: TimestampString;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "usage_tracking_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      usage_summary: {
        Row: {
          id: string;
          local_id: string | null;
          user_id: string;
          app: string;
          language: string | null;
          lang_ext: string | null;
          date: string; // YYYY-MM-DD format
          icon: string | null;
          time_spent: number;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          local_id?: string | null;
          user_id: string;
          app: string;
          language?: string | null;
          lang_ext?: string | null;
          date: string;
          icon?: string | null;
          time_spent?: number;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          app?: string;
          language?: string | null;
          lang_ext?: string | null;
          icon?: string | null;
          time_spent?: number;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "usage_summary_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      sessions: {
        Row: {
          id: string;
          local_id: string | null;
          timestamp: TimestampString;
          start_time: TimestampString;
          duration: number;
          title: string;
          description: string | null;
          project_id: string | null;
          is_billable: boolean;
          user_id: string;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          local_id?: string | null;
          timestamp: TimestampString;
          start_time: TimestampString;
          duration: number;
          title: string;
          description?: string | null;
          project_id?: string | null;
          is_billable?: boolean;
          user_id: string;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          timestamp?: TimestampString;
          start_time?: TimestampString;
          duration?: number;
          title?: string;
          description?: string | null;
          project_id?: string | null;
          is_billable?: boolean;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      session_tags: {
        Row: {
          session_id: string;
          tag_id: string;
        };
        Insert: {
          session_id: string;
          tag_id: string;
        };
        Update: {
          session_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_tags_session_id_fkey";
            columns: ["session_id"];
            referencedRelation: "sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_tags_tag_id_fkey";
            columns: ["tag_id"];
            referencedRelation: "tags";
            referencedColumns: ["id"];
          }
        ];
      };
      daily_goals: {
        Row: {
          id: string;
          local_id: string | null;
          user_id: string;
          date: string; // YYYY-MM-DD format
          time: number;
          description: string | null;
          is_completed: boolean;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          local_id?: string | null;
          user_id: string;
          date: string;
          time: number;
          description?: string | null;
          is_completed?: boolean;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          time?: number;
          description?: string | null;
          is_completed?: boolean;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "daily_goals_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      scheduled_sessions: {
        Row: {
          id: string;
          local_id: string | null;
          user_id: string;
          title: string;
          description: string | null;
          scheduled_datetime: TimestampString;
          estimated_duration: number | null;
          recurrence_type: "none" | "weekly";
          recurrence_data: Json | null;
          status: "pending" | "notified" | "completed" | "missed" | "cancelled";
          last_notification_sent: TimestampString | null;
          created_at: TimestampString;
          updated_at: TimestampString;
        };
        Insert: {
          id?: string;
          local_id?: string | null;
          user_id: string;
          title: string;
          description?: string | null;
          scheduled_datetime: TimestampString;
          estimated_duration?: number | null;
          recurrence_type?: "none" | "weekly";
          recurrence_data?: Json | null;
          status?:
            | "pending"
            | "notified"
            | "completed"
            | "missed"
            | "cancelled";
          last_notification_sent?: TimestampString | null;
          created_at?: TimestampString;
          updated_at?: TimestampString;
        };
        Update: {
          local_id?: string | null;
          title?: string;
          description?: string | null;
          scheduled_datetime?: TimestampString;
          estimated_duration?: number | null;
          recurrence_type?: "none" | "weekly";
          recurrence_data?: Json | null;
          status?:
            | "pending"
            | "notified"
            | "completed"
            | "missed"
            | "cancelled";
          last_notification_sent?: TimestampString | null;
          updated_at?: TimestampString;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_sessions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "user_profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      scheduled_session_tags: {
        Row: {
          scheduled_session_id: string;
          tag_id: string;
        };
        Insert: {
          scheduled_session_id: string;
          tag_id: string;
        };
        Update: {
          scheduled_session_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_session_tags_scheduled_session_id_fkey";
            columns: ["scheduled_session_id"];
            referencedRelation: "scheduled_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scheduled_session_tags_tag_id_fkey";
            columns: ["tag_id"];
            referencedRelation: "tags";
            referencedColumns: ["id"];
          }
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
