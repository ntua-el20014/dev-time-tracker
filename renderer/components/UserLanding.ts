/**
 * User Landing Page UI (DEPRECATED)
 *
 * This component previously showed local user selection with add/delete functionality.
 * With the migration to Supabase, user management is handled through authentication:
 * - Users sign up / log in via LandingPage.ts (email, GitHub OAuth)
 * - Each authenticated Supabase user = one profile (no local multi-user switching)
 * - User creation happens through Supabase Auth signup flow
 *
 * This file is kept for backward compatibility but renderUserLanding() now
 * simply redirects to the Supabase auth landing page.
 */

import { renderLandingPage } from "./LandingPage";

/**
 * @deprecated Use renderLandingPage() from LandingPage.ts instead.
 * Users are now managed through Supabase authentication.
 */
export async function renderUserLanding(
  container: HTMLElement,
  onUserSelected?: (userId: number | string) => void,
) {
  // Redirect to the Supabase auth landing page
  renderLandingPage(container, (session: any) => {
    if (onUserSelected && session?.user?.id) {
      onUserSelected(session.user.id);
    }
  });
}
