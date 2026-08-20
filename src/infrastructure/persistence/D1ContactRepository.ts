import { EmailAddress } from "../../domain/shared/EmailAddress";
import type { Contact } from "../../domain/contact/Contact";
import type { AddressHeader } from "../../domain/message/Message";
import type { ContactRepository } from "../../application/ports";

export class D1ContactRepository implements ContactRepository {
  constructor(private readonly db: D1Database) {}

  async list(q?: string, limit = 80): Promise<Contact[]> {
    const take = Math.min(Math.max(limit, 1), 200);
    const query = (q || "").trim();
    if (query) {
      const like = `%${query.replace(/[%_]/g, "")}%`;
      const rows = await this.db
        .prepare(
          `SELECT email, name, created_at FROM contacts
           WHERE email LIKE ? OR name LIKE ?
           ORDER BY name COLLATE NOCASE, email
           LIMIT ?`,
        )
        .bind(like, like, take)
        .all<{ email: string; name: string; created_at: number }>();
      return (rows.results ?? []).flatMap(toContact);
    }
    const rows = await this.db
      .prepare(
        `SELECT email, name, created_at FROM contacts
         ORDER BY name COLLATE NOCASE, email
         LIMIT ?`,
      )
      .bind(take)
      .all<{ email: string; name: string; created_at: number }>();
    return (rows.results ?? []).flatMap(toContact);
  }

  async remember(people: AddressHeader[], skip: Set<string>): Promise<number> {
    let added = 0;
    const now = Date.now();
    for (const person of people) {
      const address = EmailAddress.parse(person.address);
      if (!address || skip.has(address.value)) continue;
      const name = (person.name || "").trim().slice(0, 120);
      const result = await this.db
        .prepare(
          `INSERT OR IGNORE INTO contacts (email, name, created_at) VALUES (?, ?, ?)`,
        )
        .bind(address.value, name, now)
        .run();
      if ((result.meta.changes ?? 0) > 0) added += 1;
    }
    return added;
  }

  async importRows(rows: AddressHeader[]): Promise<{ imported: number; skipped: number }> {
    const seen = new Set<string>();
    let imported = 0;
    let skipped = 0;
    const now = Date.now();
    for (const row of rows) {
      const address = EmailAddress.parse(row.address);
      if (!address) {
        skipped += 1;
        continue;
      }
      if (seen.has(address.value)) {
        skipped += 1;
        continue;
      }
      seen.add(address.value);
      const result = await this.db
        .prepare(
          `INSERT OR IGNORE INTO contacts (email, name, created_at) VALUES (?, ?, ?)`,
        )
        .bind(address.value, (row.name || "").trim().slice(0, 120), now)
        .run();
      if ((result.meta.changes ?? 0) > 0) imported += 1;
      else skipped += 1;
    }
    return { imported, skipped };
  }

  async remove(emails: string[]): Promise<number> {
    let removed = 0;
    for (const raw of emails) {
      const address = EmailAddress.parse(raw);
      if (!address) continue;
      const result = await this.db
        .prepare(`DELETE FROM contacts WHERE email = ?`)
        .bind(address.value)
        .run();
      if ((result.meta.changes ?? 0) > 0) removed += 1;
    }
    return removed;
  }
}

function toContact(row: { email: string; name: string; created_at: number }): Contact[] {
  const email = EmailAddress.parse(row.email);
  return email ? [{ email, name: row.name, createdAt: row.created_at }] : [];
}
