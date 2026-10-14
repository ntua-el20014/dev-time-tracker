import { getEnv } from "../buildEnv";

// Supabase configuration
export const SUPABASE_CONFIG = {
  URL: getEnv("SUPABASE_URL") || "https://bgrqsrpvznsdjpzhyhov.supabase.co",
  ANON_KEY:
    getEnv("SUPABASE_ANON_KEY") ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJncnFzcnB2em5zZGpwemh5aG92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzA3NzksImV4cCI6MjA4NjgwNjc3OX0.UCFQ2O-vOyt6l-n1DUeB6_pTB1o5Y0EDtvuafmELzNA",
};
