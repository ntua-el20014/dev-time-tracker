import { supabase } from "./config";

/**
 * Get all tags for a user
 */
export async function getAllTags(userId: string) {
  const { data, error } = await supabase
    .from("user_tags")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }
  return data || [];
}

/**
 * Create a new tag for a user
 * If tag with same name exists, returns the existing tag
 */
export async function createTag(userId: string, name: string, color?: string) {
  const tagColor = color || "#f0db4f";

  // Try to insert the tag
  const { data, error } = await (supabase as any)
    .from("user_tags")
    .insert({
      user_id: userId,
      name: name,
      color: tagColor,
    })
    .select()
    .single();

  if (error) {
    // Check if it's a unique constraint violation (tag already exists)
    if (error.code === "23505") {
      // Tag already exists, fetch and return it
      const { data: existingTag, error: fetchError } = await supabase
        .from("user_tags")
        .select("*")
        .eq("user_id", userId)
        .eq("name", name)
        .single();

      if (fetchError) {
        throw fetchError;
      }
      return existingTag;
    }
    throw error;
  }

  return data;
}

/**
 * Update a tag's properties
 */
export async function updateTag(
  tagId: string,
  updates: {
    name?: string;
    color?: string;
  },
) {
  const { data, error } = await (supabase as any)
    .from("user_tags")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tagId)
    .select()
    .single();

  if (error) {
    throw error;
  }
  return data;
}

/**
 * Delete a tag and all its session associations
 */
export async function deleteTag(tagId: string) {
  // Session tags will be deleted automatically via CASCADE
  const { error } = await supabase.from("user_tags").delete().eq("id", tagId);

  if (error) {
    throw error;
  }
}

/**
 * Get all tags for a specific session
 * Returns an array of tag objects
 */
export async function getSessionTags(sessionId: string) {
  const { data, error } = await supabase
    .from("session_tags")
    .select(
      `
      tag_id,
      user_tags (
        id,
        name,
        color
      )
    `,
    )
    .eq("session_id", sessionId);

  if (error) {
    throw error;
  }

  // Transform the data to return tag objects
  return (data || []).map((item: any) => item.user_tags).filter(Boolean);
}

/**
 * Set tags for a session
 * Replaces all existing tags with the provided tag IDs
 */
export async function setSessionTags(sessionId: string, tagIds: string[]) {
  // First, delete all existing tags for this session
  const { error: deleteError } = await supabase
    .from("session_tags")
    .delete()
    .eq("session_id", sessionId);

  if (deleteError) {
    throw deleteError;
  }

  // If no tags to add, we're done
  if (tagIds.length === 0) {
    return;
  }

  // Insert new tag associations
  const sessionTagsData = tagIds.map((tagId) => ({
    session_id: sessionId,
    tag_id: tagId,
  }));

  const { error: insertError } = await (supabase as any)
    .from("session_tags")
    .insert(sessionTagsData);

  if (insertError) {
    throw insertError;
  }
}

/**
 * Helper function: Set session tags by tag names instead of IDs
 * Creates tags if they don't exist
 * This matches the SQLite behavior more closely
 */
export async function setSessionTagsByNames(
  userId: string,
  sessionId: string,
  tagNames: string[],
) {
  // Get or create tags
  const tagIds: string[] = [];

  for (const name of tagNames) {
    const tag = await createTag(userId, name);
    if (tag && (tag as any).id) {
      tagIds.push((tag as any).id);
    }
  }

  // Set the tags
  await setSessionTags(sessionId, tagIds);
}

/**
 * Get tag by name for a user
 */
export async function getTagByName(userId: string, name: string) {
  const { data, error } = await supabase
    .from("user_tags")
    .select("*")
    .eq("user_id", userId)
    .eq("name", name)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null; // Not found
    }
    throw error;
  }
  return data;
}
