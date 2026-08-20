import { EmailAddress } from "../../domain/shared/EmailAddress";
import type { Contact } from "../../domain/contact/Contact";
import type { AddressHeader } from "../../domain/message/Message";
import type { ContactRepository } from "../../application/ports";
import type { KvCache } from "../cache/KvCache";

const CONTACTS_KEY = "contacts:all";
const CONTACTS_TTL = 60;
const CONTACTS_CAP = 200;

type ContactRecord = { email: string; name: string; createdAt: number };

export class CachedContactRepository implements ContactRepository {
  constructor(
    private readonly inner: ContactRepository,
    private readonly kv: KvCache,
  ) {}

  async list(q?: string, limit = 80): Promise<Contact[]> {
    const take = Math.min(Math.max(limit, 1), CONTACTS_CAP);
    const query = (q || "").trim();
    if (query) return this.inner.list(query, take);

    const hit = await this.kv.getJson<ContactRecord[]>(CONTACTS_KEY);
    if (hit) return hit.slice(0, take).flatMap(revive);

    const rows = await this.inner.list(undefined, CONTACTS_CAP);
    await this.kv.putJson(
      CONTACTS_KEY,
      rows.map((row) => ({ email: row.email.value, name: row.name, createdAt: row.createdAt })),
      CONTACTS_TTL,
    );
    return rows.slice(0, take);
  }

  async remember(people: AddressHeader[], skip: Set<string>) {
    const added = await this.inner.remember(people, skip);
    if (added > 0) await this.kv.delete(CONTACTS_KEY);
    return added;
  }

  async importRows(rows: AddressHeader[]) {
    const result = await this.inner.importRows(rows);
    if (result.imported > 0) await this.kv.delete(CONTACTS_KEY);
    return result;
  }

  async remove(emails: string[]) {
    const removed = await this.inner.remove(emails);
    if (removed > 0) await this.kv.delete(CONTACTS_KEY);
    return removed;
  }
}

function revive(row: ContactRecord): Contact[] {
  const email = EmailAddress.parse(row.email);
  return email ? [{ email, name: row.name, createdAt: row.createdAt }] : [];
}
