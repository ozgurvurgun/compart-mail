import type { Authenticator, Identity } from "../../application/ports";
import { extractAccessJwt, verifyCloudflareAccessJwt } from "./access-jwt";

export type AccessAuthConfig = {
  teamDomain: string;
  audience: string;
};

export class AccessAuthenticator implements Authenticator {
  constructor(private readonly config: AccessAuthConfig) {}

  async authenticate(request: Request): Promise<Identity | null> {
    if (!this.config.teamDomain || !this.config.audience) return null;
    const token = extractAccessJwt({
      header: (name) => request.headers.get(name) ?? undefined,
      cookie: request.headers.get("cookie") ?? undefined,
    });
    if (!token) return null;
    try {
      const identity = await verifyCloudflareAccessJwt(token, {
        teamDomain: this.config.teamDomain,
        audience: this.config.audience,
      });
      return { email: identity.email };
    } catch {
      return null;
    }
  }
}
