import { EmailAddress } from "../../domain/shared/EmailAddress";
import type { Mailbox } from "../../domain/mailbox/Mailbox";
import type { Folder } from "../../domain/mailbox/Folder";
import type { AddressHeader, Message } from "../../domain/message/Message";
import type {
  MessageListItem,
  MessageListQuery,
  MessageRepository,
  NewInboundMessage,
  ObjectStore,
} from "../../application/ports";

type EnvDb = D1Database;

export class D1MessageRepository implements MessageRepository {
  constructor(
    private readonly db: EnvDb,
    private readonly store: ObjectStore,
  ) {}

  async ensureMailbox(address: EmailAddress, displayName: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO mailboxes (address, display_name, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(address) DO NOTHING`,
      )
      .bind(address.value, displayName, Date.now())
      .run();
  }

  async listMailboxes(): Promise<Mailbox[]> {
    const rows = await this.db
      .prepare(`SELECT address, display_name FROM mailboxes ORDER BY address`)
      .all<{ address: string; display_name: string }>();
    return (rows.results ?? [])
      .map((row) => {
        const address = EmailAddress.parse(row.address);
        if (!address) return null;
        return { address, displayName: row.display_name };
      })
      .filter((row): row is Mailbox => row !== null);
  }

  async list(query: MessageListQuery): Promise<{ items: MessageListItem[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(query.limit, 1), 50);
    const cursor = decodeCursor(query.cursor);
    const params: unknown[] = [];
    let where = "1 = 1";
    if (query.mailbox) {
      where = "mailbox = ?";
      params.push(query.mailbox.value);
    }

    if (query.folder === "starred") {
      where += ` AND starred = 1 AND folder NOT IN ('trash', 'spam')`;
    } else {
      where += ` AND folder = ?`;
      params.push(query.folder);
    }

    if (cursor) {
      where += ` AND (date_ms < ? OR (date_ms = ? AND id < ?))`;
      params.push(cursor.dateMs, cursor.dateMs, cursor.id);
    }

    let ids: string[] | null = null;
    if (query.q?.trim()) {
      const match = sanitizeFts(query.q);
      if (!match) return { items: [], nextCursor: null };
      const fts = await this.db
        .prepare(
          `SELECT id FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT 100`,
        )
        .bind(match)
        .all<{ id: string }>();
      ids = (fts.results ?? []).map((row) => row.id);
      if (ids.length === 0) return { items: [], nextCursor: null };
      where += ` AND id IN (${ids.map(() => "?").join(",")})`;
      params.push(...ids);
    }

    const rows = await this.db
      .prepare(
        `SELECT id, mailbox, folder, direction, from_addr, from_name, to_addrs, cc_addrs, bcc_addrs,
                reply_to, subject, snippet, thread_id, internet_message_id, in_reply_to, date_ms,
                unread, starred, has_attachments, size_bytes, has_html, has_text
         FROM messages WHERE ${where} ORDER BY date_ms DESC, id DESC LIMIT ?`,
      )
      .bind(...params, limit + 1)
      .all<MessageRow>();

    const records = rows.results ?? [];
    const page = records.slice(0, limit);
    const last = page[page.length - 1];
    const attachments = await this.attachmentsFor(page.map((row) => row.id));

    return {
      items: page.map((row) => toListItem(row, attachments[row.id] ?? [])),
      nextCursor:
        records.length > limit && last
          ? encodeCursor(last.date_ms, last.id)
          : null,
    };
  }

  async counts(mailbox?: EmailAddress): Promise<Record<string, number>> {
    const scoped = mailbox ? "WHERE mailbox = ?" : "";
    const binds = mailbox ? [mailbox.value] : [];
    const rows = await this.db
      .prepare(
        `SELECT folder, SUM(unread) as unread, COUNT(*) as total
         FROM messages ${scoped} GROUP BY folder`,
      )
      .bind(...binds)
      .all<{ folder: string; unread: number; total: number }>();
    const out: Record<string, number> = {};
    for (const row of rows.results ?? []) {
      out[`${row.folder}:unread`] = Number(row.unread ?? 0);
      out[`${row.folder}:total`] = Number(row.total ?? 0);
    }
    const starred = await this.db
      .prepare(
        `SELECT COUNT(*) as n FROM messages ${mailbox ? "WHERE mailbox = ? AND" : "WHERE"} starred = 1 AND folder NOT IN ('trash', 'spam')`,
      )
      .bind(...binds)
      .first<{ n: number }>();
    out["starred:total"] = Number(starred?.n ?? 0);
    return out;
  }

  async get(id: string): Promise<Message | null> {
    const row = await this.db
      .prepare(`SELECT * FROM messages WHERE id = ?`)
      .bind(id)
      .first<MessageRow>();
    if (!row) return null;
    const attachments = await this.attachmentsFor([id]);
    return {
      ...toListItem(row, attachments[id] ?? []),
      html: row.has_html ? "1" : null,
      text: row.has_text ? "1" : null,
    };
  }

  async saveInbound(input: NewInboundMessage): Promise<Message> {
    return this.save(input, "inbox", "inbound", 1);
  }

  async saveOutbound(input: NewInboundMessage & { folder: Folder }): Promise<Message> {
    return this.save(input, input.folder, "outbound", 0);
  }

  async updateDraft(
    id: string,
    input: NewInboundMessage & { folder: Folder },
    keepAttachmentIds?: string[],
  ): Promise<Message | null> {
    const current = await this.get(id);
    if (!current || current.folder !== "drafts") return null;

    const hasHtml = Boolean(input.html);
    const hasText = Boolean(input.text);
    const keepIds = new Set(keepAttachmentIds ?? current.attachments.map((item) => item.id));
    const kept = current.attachments.filter((item) => keepIds.has(item.id));
    const dropped = current.attachments.filter((item) => !keepIds.has(item.id));

    for (const file of dropped) {
      const meta = await this.getAttachment(file.id);
      if (meta) await this.store.delete(meta.r2Key);
      await this.db.prepare(`DELETE FROM attachments WHERE id = ?`).bind(file.id).run();
    }

    await this.db.batch([
      this.db
        .prepare(
          `UPDATE messages SET
            mailbox = ?, from_addr = ?, from_name = ?, to_addrs = ?, cc_addrs = ?, bcc_addrs = ?,
            reply_to = ?, subject = ?, snippet = ?, thread_id = ?, in_reply_to = ?, date_ms = ?,
            has_attachments = ?, size_bytes = ?, has_html = ?, has_text = ?
           WHERE id = ?`,
        )
        .bind(
          input.mailbox.value,
          input.from.address,
          input.from.name,
          JSON.stringify(input.to),
          JSON.stringify(input.cc),
          JSON.stringify(input.bcc ?? []),
          input.replyTo,
          input.subject,
          input.snippet,
          input.threadId || current.threadId,
          input.inReplyTo,
          input.dateMs,
          kept.length + input.attachments.length > 0 ? 1 : 0,
          input.sizeBytes,
          hasHtml ? 1 : 0,
          hasText ? 1 : 0,
          id,
        ),
      this.db.prepare(`DELETE FROM messages_fts WHERE id = ?`).bind(id),
      this.db
        .prepare(
          `INSERT INTO messages_fts (id, subject, snippet, from_addr, to_addrs) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.subject,
          input.snippet,
          input.from.address,
          input.to.map((item) => item.address).join(" "),
        ),
    ]);

    await this.store.put(`messages/${id}/body.html`, input.html || "", "text/html; charset=utf-8");
    await this.store.put(`messages/${id}/body.txt`, input.text || "", "text/plain; charset=utf-8");

    const start = kept.length;
    for (const [offset, file] of input.attachments.entries()) {
      const attId = crypto.randomUUID();
      const key = `messages/${id}/att/${start + offset}-${safeName(file.filename)}`;
      await this.store.put(key, file.content, file.contentType);
      await this.db
        .prepare(
          `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(attId, id, file.filename, file.contentType, file.content.byteLength, key)
        .run();
    }

    return this.get(id);
  }

  async patch(
    id: string,
    patch: Partial<Pick<Message, "unread" | "starred" | "folder">>,
  ): Promise<Message | null> {
    const current = await this.get(id);
    if (!current) return null;
    const unread = patch.unread ?? current.unread;
    const starred = patch.starred ?? current.starred;
    const folder = patch.folder ?? current.folder;
    await this.db
      .prepare(`UPDATE messages SET unread = ?, starred = ?, folder = ? WHERE id = ?`)
      .bind(unread ? 1 : 0, starred ? 1 : 0, folder, id)
      .run();
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    const current = await this.get(id);
    if (!current) return false;
    await this.store.deletePrefix(`messages/${id}/`);
    await this.db.batch([
      this.db.prepare(`DELETE FROM attachments WHERE message_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM messages_fts WHERE id = ?`).bind(id),
      this.db.prepare(`DELETE FROM messages WHERE id = ?`).bind(id),
    ]);
    return true;
  }

  async getAttachment(id: string) {
    const row = await this.db
      .prepare(
        `SELECT id, filename, content_type as contentType, size_bytes as sizeBytes, r2_key as r2Key
         FROM attachments WHERE id = ?`,
      )
      .bind(id)
      .first<{
        id: string;
        filename: string;
        contentType: string;
        sizeBytes: number;
        r2Key: string;
      }>();
    return row ?? null;
  }

  private async save(
    input: NewInboundMessage,
    folder: Folder,
    direction: "inbound" | "outbound",
    unread: number,
  ): Promise<Message> {
    const id = crypto.randomUUID();
    await this.ensureMailbox(input.mailbox, titleCase(input.mailbox.localPart()));
    const hasHtml = Boolean(input.html);
    const hasText = Boolean(input.text);

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO messages (
          id, mailbox, folder, direction, from_addr, from_name, to_addrs, cc_addrs, bcc_addrs,
          reply_to, subject, snippet, thread_id, internet_message_id, in_reply_to, date_ms,
          unread, starred, has_attachments, size_bytes, has_html, has_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.mailbox.value,
          folder,
          direction,
          input.from.address,
          input.from.name,
          JSON.stringify(input.to),
          JSON.stringify(input.cc),
          JSON.stringify(input.bcc ?? []),
          input.replyTo,
          input.subject,
          input.snippet,
          input.threadId,
          input.internetMessageId,
          input.inReplyTo,
          input.dateMs,
          unread,
          input.attachments.length > 0 ? 1 : 0,
          input.sizeBytes,
          hasHtml ? 1 : 0,
          hasText ? 1 : 0,
          Date.now(),
        ),
      this.db
        .prepare(
          `INSERT INTO messages_fts (id, subject, snippet, from_addr, to_addrs) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.subject,
          input.snippet,
          input.from.address,
          input.to.map((item) => item.address).join(" "),
        ),
    ]);

    if (input.raw.byteLength) {
      await this.store.put(`messages/${id}/raw.eml`, input.raw, "message/rfc822");
    }
    if (hasHtml) {
      await this.store.put(`messages/${id}/body.html`, input.html, "text/html; charset=utf-8");
    }
    if (hasText) {
      await this.store.put(`messages/${id}/body.txt`, input.text, "text/plain; charset=utf-8");
    }

    const attachmentRefs = [];
    for (const [index, file] of input.attachments.entries()) {
      const attId = crypto.randomUUID();
      const key = `messages/${id}/att/${index}-${safeName(file.filename)}`;
      await this.store.put(key, file.content, file.contentType);
      await this.db
        .prepare(
          `INSERT INTO attachments (id, message_id, filename, content_type, size_bytes, r2_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(attId, id, file.filename, file.contentType, file.content.byteLength, key)
        .run();
      attachmentRefs.push({
        id: attId,
        filename: file.filename,
        contentType: file.contentType,
        sizeBytes: file.content.byteLength,
      });
    }

    return {
      id,
      mailbox: input.mailbox,
      folder,
      direction,
      from: input.from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc ?? [],
      replyTo: input.replyTo,
      subject: input.subject,
      snippet: input.snippet,
      html: hasHtml ? "1" : null,
      text: hasText ? "1" : null,
      threadId: input.threadId,
      internetMessageId: input.internetMessageId,
      inReplyTo: input.inReplyTo,
      dateMs: input.dateMs,
      unread: unread === 1,
      starred: false,
      attachments: attachmentRefs,
      sizeBytes: input.sizeBytes,
    };
  }

  private async attachmentsFor(ids: string[]) {
    const map: Record<string, Message["attachments"]> = {};
    if (ids.length === 0) return map;
    const rows = await this.db
      .prepare(
        `SELECT id, message_id, filename, content_type, size_bytes FROM attachments
         WHERE message_id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(...ids)
      .all<{
        id: string;
        message_id: string;
        filename: string;
        content_type: string;
        size_bytes: number;
      }>();
    for (const row of rows.results ?? []) {
      map[row.message_id] ??= [];
      map[row.message_id].push({
        id: row.id,
        filename: row.filename,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
      });
    }
    return map;
  }
}

type MessageRow = {
  id: string;
  mailbox: string;
  folder: string;
  direction: "inbound" | "outbound";
  from_addr: string;
  from_name: string;
  to_addrs: string;
  cc_addrs: string;
  bcc_addrs: string;
  reply_to: string;
  subject: string;
  snippet: string;
  thread_id: string;
  internet_message_id: string;
  in_reply_to: string;
  date_ms: number;
  unread: number;
  starred: number;
  has_attachments: number;
  size_bytes: number;
  has_html?: number;
  has_text?: number;
};

function toListItem(row: MessageRow, attachments: Message["attachments"]): MessageListItem {
  return {
    id: row.id,
    mailbox: { value: row.mailbox } as EmailAddress,
    folder: row.folder,
    direction: row.direction,
    from: { address: row.from_addr, name: row.from_name },
    to: JSON.parse(row.to_addrs || "[]"),
    cc: JSON.parse(row.cc_addrs || "[]"),
    bcc: JSON.parse(row.bcc_addrs || "[]"),
    replyTo: row.reply_to,
    subject: row.subject,
    snippet: row.snippet,
    threadId: row.thread_id,
    internetMessageId: row.internet_message_id,
    inReplyTo: row.in_reply_to,
    dateMs: row.date_ms,
    unread: row.unread === 1,
    starred: row.starred === 1,
    attachments,
    sizeBytes: row.size_bytes,
  };
}

function encodeCursor(dateMs: number, id: string) {
  return btoa(`${dateMs}:${id}`);
}

function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const [dateMs, id] = atob(cursor).split(":");
    return { dateMs: Number(dateMs), id };
  } catch {
    return null;
  }
}

function sanitizeFts(q: string) {
  const tokens = q
    .replace(/['"^:*(){}]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"`).join(" AND ");
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
