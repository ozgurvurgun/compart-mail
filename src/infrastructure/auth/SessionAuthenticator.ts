import type { AuthSession, Identity } from "../../application/ports";
import { err, ok, type Result } from "../../domain/shared/Result";
import type { KvCache } from "../cache/KvCache";
import { PasswordHasher, randomToken } from "./crypto";
import { D1AuthStore } from "./D1AuthStore";
import { SESSION_TTL_SECONDS, SessionCookie } from "./SessionCookie";

const MAX_FAILURES = 8;
const WINDOW_SECONDS = 15 * 60;

export class SessionAuthenticator implements AuthSession {
  constructor(
    private readonly store: D1AuthStore,
    private readonly hasher: PasswordHasher,
    private readonly cookies: SessionCookie,
    private readonly kv: KvCache,
  ) {}

  async authenticate(request: Request): Promise<Identity | null> {
    const token = this.cookies.read(request);
    if (!token) return null;
    const hash = await this.cookies.hash(token);
    const cached = await this.kv.getJson<Identity>(`sess:${hash}`);
    if (cached) return cached;
    const identity = await this.store.sessionIdentity(hash);
    if (identity) {
      await this.kv.putJson(`sess:${hash}`, identity, SESSION_TTL_SECONDS);
    }
    return identity;
  }

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<Result<{ identity: Identity; setCookie: string }>> {
    const normalized = email.trim().toLowerCase();
    const throttleKey = `rl:${normalized}|${ip}`;
    const failures = (await this.kv.getJson<{ n: number }>(throttleKey))?.n ?? 0;
    if (failures >= MAX_FAILURES) {
      return err("Too many attempts. Try again in 15 minutes.");
    }

    const user = await this.store.findUser(normalized);
    const dummySalt = "00".repeat(16);
    const dummyHash = "00".repeat(32);
    const valid = user
      ? await this.hasher.verify(password, user.salt, user.hash)
      : await this.hasher.verify(password, dummySalt, dummyHash);

    if (!user || !valid) {
      await this.kv.putJson(throttleKey, { n: failures + 1 }, WINDOW_SECONDS);
      return err("Invalid email or password");
    }

    await this.kv.delete(throttleKey);
    const token = randomToken();
    const tokenHash = await this.cookies.hash(token);
    await this.store.createSession(
      tokenHash,
      user.email,
      Date.now() + SESSION_TTL_SECONDS * 1000,
    );
    const identity = { email: user.email, name: user.name };
    await this.kv.putJson(`sess:${tokenHash}`, identity, SESSION_TTL_SECONDS);
    return ok({
      identity,
      setCookie: this.cookies.set(token),
    });
  }

  async logout(request: Request): Promise<string> {
    const token = this.cookies.read(request);
    if (token) {
      const hash = await this.cookies.hash(token);
      await this.store.deleteSession(hash);
      await this.kv.delete(`sess:${hash}`);
    }
    return this.cookies.clear();
  }
}

export function sameOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
