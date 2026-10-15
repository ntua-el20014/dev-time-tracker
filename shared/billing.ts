/**
 * Billable seconds of a (billable) session. Supervising time — no input
 * while an AI agent worked — is part of `duration` and is billed unless the
 * project turned that off (cloud_projects.bill_supervising = false).
 */
export function billableSecondsOf(
  session: { duration?: number | null; supervising_seconds?: number | null },
  billSupervising: boolean | null | undefined = true,
): number {
  const duration = session.duration || 0;
  if (billSupervising !== false) return duration;
  return Math.max(0, duration - (session.supervising_seconds || 0));
}
