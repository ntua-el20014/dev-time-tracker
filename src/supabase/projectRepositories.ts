import { supabase } from "./config";

/** A git repository the user has linked to one of their projects. */
export interface RepoLink {
  repo_key: string;
  repo_name: string;
  project_id: string;
}

/** All of the user's repo → project links. */
export async function getRepoLinks(userId: string): Promise<RepoLink[]> {
  const { data, error } = await supabase
    .from("project_repositories")
    .select("repo_key, repo_name, project_id")
    .eq("user_id", userId)
    .order("repo_name", { ascending: true });

  if (error) throw error;
  return (data as RepoLink[] | null) || [];
}

/** Link a repo to a project, replacing the repo's previous link. */
export async function linkRepoToProject(
  userId: string,
  link: RepoLink,
): Promise<void> {
  const { error } = await (supabase as any).from("project_repositories").upsert(
    {
      user_id: userId,
      repo_key: link.repo_key,
      repo_name: link.repo_name,
      project_id: link.project_id,
    },
    { onConflict: "user_id,repo_key" },
  );
  if (error) throw error;
}

export async function unlinkRepo(
  userId: string,
  repoKey: string,
): Promise<void> {
  const { error } = await supabase
    .from("project_repositories")
    .delete()
    .eq("user_id", userId)
    .eq("repo_key", repoKey);
  if (error) throw error;
}
