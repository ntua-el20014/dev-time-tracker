import { supabase } from "./config";

export async function getCurrentSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return session;
}

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    throw error;
  }
  return user;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw error;
  }
  return data;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  username: string
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
      },
    },
  });
  if (error) {
    throw error;
  }
  return data;
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    throw error;
  }
}

// User profile management
export async function createUserProfile(profile: {
  id: string;
  username: string;
  org_id?: string;
}) {
  const { data, error } = await supabase
    .from("user_profiles")
    .insert(profile as any)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function getUserProfile(userId: string) {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function updateUserProfileData(profile: {
  username?: string;
  avatar?: string;
  role?: string;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("No user logged in");

  const { data, error } = await (supabase as any)
    .from("user_profiles")
    .update(profile)
    .eq("id", user.id)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function updateUserProfile(profile: {
  username?: string;
  avatar_url?: string;
}) {
  const { data, error } = await supabase.auth.updateUser({
    data: profile,
  });
  if (error) {
    throw error;
  }
  return data;
}

// Check if user is authenticated
export async function checkAuthStatus(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return !!session;
}

// Listen for auth state changes
export function onAuthStateChange(callback: (session: any) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) {
      callback(session);
    } else if (event === "SIGNED_OUT") {
      // Clear local storage on sign out
      localStorage.removeItem("currentUserId");
      callback(null);
    }
  });
}
