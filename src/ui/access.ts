export const MAIL_ORIGIN = "https://mail.compartsoftware.com";

export function accessLogoutUrl(returnTo = `${MAIL_ORIGIN}/`): string {
  const redirect = encodeURIComponent(returnTo);
  // run_worker_first intercepts /cdn-cgi/access/* and forwards to CF_ACCESS_TEAM_DOMAIN.
  return `/cdn-cgi/access/logout?redirect_url=${redirect}`;
}

export function signOutOfAccess(returnTo?: string): void {
  window.location.href = accessLogoutUrl(returnTo ?? `${MAIL_ORIGIN}/`);
}
