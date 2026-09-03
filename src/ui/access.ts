export function currentOrigin(): string {
  return window.location.origin;
}

export function accessLogoutUrl(returnTo = `${currentOrigin()}/`): string {
  const redirect = encodeURIComponent(returnTo);
  return `/cdn-cgi/access/logout?redirect_url=${redirect}`;
}

export function signOutOfAccess(returnTo?: string): void {
  window.location.href = accessLogoutUrl(returnTo ?? `${currentOrigin()}/`);
}
