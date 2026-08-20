import { sha256Hex } from "./crypto";

const COOKIE = "__Host-cm_session";
const MAX_AGE = 60 * 60 * 24 * 7;

export class SessionCookie {
  read(request: Request): string | null {
    const header = request.headers.get("Cookie") || "";
    const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  set(token: string): string {
    return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
  }

  clear(): string {
    return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }

  hash(token: string) {
    return sha256Hex(token);
  }
}

export { MAX_AGE as SESSION_TTL_SECONDS };
