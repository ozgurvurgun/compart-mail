import type { Identity } from "../../application/ports";

export class D1AuthStore {
  constructor(private readonly db: D1Database) {}

  async findUser(email: string) {
    return this.db
      .prepare(
        `SELECT email, name, password_salt as salt, password_hash as hash FROM users WHERE email = ?`,
      )
      .bind(email.toLowerCase())
      .first<{ email: string; name: string; salt: string; hash: string }>();
  }

  async upsertUser(email: string, name: string, salt: string, hash: string) {
    await this.db
      .prepare(
        `INSERT INTO users (email, name, password_salt, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           password_salt = excluded.password_salt,
           password_hash = excluded.password_hash`,
      )
      .bind(email.toLowerCase(), name, salt, hash, Date.now())
      .run();
  }

  async createSession(tokenHash: string, email: string, expiresAt: number) {
    await this.db
      .prepare(
        `INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(tokenHash, email.toLowerCase(), expiresAt, Date.now())
      .run();
  }

  async sessionIdentity(tokenHash: string): Promise<Identity | null> {
    const row = await this.db
      .prepare(
        `SELECT s.email, u.name
         FROM sessions s
         JOIN users u ON u.email = s.email
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .bind(tokenHash, Date.now())
      .first<{ email: string; name: string }>();
    return row ? { email: row.email, name: row.name } : null;
  }

  async deleteSession(tokenHash: string) {
    await this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
  }

  async failedAttempts(key: string, windowMs: number) {
    const row = await this.db
      .prepare(`SELECT failures, window_start FROM login_attempts WHERE key = ?`)
      .bind(key)
      .first<{ failures: number; window_start: number }>();
    const now = Date.now();
    if (!row || now - row.window_start > windowMs) return 0;
    return row.failures;
  }

  async recordFailure(key: string, windowMs: number) {
    const now = Date.now();
    const row = await this.db
      .prepare(`SELECT failures, window_start FROM login_attempts WHERE key = ?`)
      .bind(key)
      .first<{ failures: number; window_start: number }>();
    if (!row || now - row.window_start > windowMs) {
      await this.db
        .prepare(
          `INSERT INTO login_attempts (key, failures, window_start) VALUES (?, 1, ?)
           ON CONFLICT(key) DO UPDATE SET failures = 1, window_start = excluded.window_start`,
        )
        .bind(key, now)
        .run();
      return;
    }
    await this.db
      .prepare(`UPDATE login_attempts SET failures = failures + 1 WHERE key = ?`)
      .bind(key)
      .run();
  }

  async clearFailures(key: string) {
    await this.db.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(key).run();
  }
}
