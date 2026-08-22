export function currentOrigin(): string {
  return window.location.origin;
}

export function accessLogoutUrl(returnTo = `${currentOrigin()}/`): string {
  const redirect = encodeURIComponent(returnTo);
  // run_worker_first intercepts /cdn-cgi/access/* and forwards to CF_ACCESS_TEAM_DOMAIN.
  return `/cdn-cgi/access/logout?redirect_url=${redirect}`;
}

export function signOutOfAccess(returnTo?: string): void {
  window.location.href = accessLogoutUrl(returnTo ?? `${currentOrigin()}/`);
}
