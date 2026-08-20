import type { PushStore, PushSubscriptionRecord } from "../../application/pushPorts";

export class D1PushStore implements PushStore {
  constructor(private readonly db: D1Database) {}

  async save(record: PushSubscriptionRecord) {
    await this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_email, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_email = excluded.user_email`,
      )
      .bind(record.endpoint, record.p256dh, record.auth, record.userEmail, Date.now())
      .run();
  }

  async remove(endpoint: string) {
    await this.db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(endpoint).run();
  }

  async list() {
    const rows = await this.db
      .prepare(`SELECT endpoint, p256dh, auth, user_email FROM push_subscriptions`)
      .all<{ endpoint: string; p256dh: string; auth: string; user_email: string }>();
    return (rows.results ?? []).map((row) => ({
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      userEmail: row.user_email,
    }));
  }
}
