import { EmailAddress } from "../../domain/shared/EmailAddress";
import type { Mailbox } from "../../domain/mailbox/Mailbox";
import { FOLDERS, type Folder } from "../../domain/mailbox/Folder";
import type { Message } from "../../domain/message/Message";
import type {
  MessageListItem,
  MessageListQuery,
  MessageRepository,
  NewInboundMessage,
} from "../../application/ports";
import type { KvCache } from "../cache/KvCache";

const MAILBOX_TTL = 120;
const COUNTS_TTL = 60;
const LIST_TTL = 60;
const LIST_FOLDERS = [...FOLDERS, "starred"] as const;

type MailboxRecord = { address: string; displayName: string };

export class CachedMessageRepository implements MessageRepository {
  constructor(
    private readonly inner: MessageRepository,
    private readonly kv: KvCache,
  ) {}

  async ensureMailbox(address: EmailAddress, displayName: string) {
    await this.inner.ensureMailbox(address, displayName);
    await this.kv.delete("mbx:list");
  }

  async listMailboxes(): Promise<Mailbox[]> {
    const hit = await this.kv.getJson<MailboxRecord[]>("mbx:list");
    if (hit) {
      return hit.flatMap((row) => {
        const address = EmailAddress.parse(row.address);
        return address ? [{ address, displayName: row.displayName }] : [];
      });
    }
    const list = await this.inner.listMailboxes();
    await this.kv.putJson(
      "mbx:list",
      list.map((box) => ({ address: box.address.value, displayName: box.displayName })),
      MAILBOX_TTL,
    );
    return list;
  }

  async list(query: MessageListQuery) {
    const q = query.q?.trim();
    if (q || query.cursor) return this.inner.list(query);
    const key = listCacheKey(query.mailbox.value, query.folder);
    const hit = await this.kv.getJson<{ items: MessageListItem[]; nextCursor: string | null }>(key);
    if (hit) return hit;
    const page = await this.inner.list(query);
    await this.kv.putJson(key, page, LIST_TTL);
    return page;
  }

  async counts(mailbox: EmailAddress) {
    const key = `cnt:${mailbox.value}`;
    const hit = await this.kv.getJson<Record<string, number>>(key);
    if (hit) return hit;
    const counts = await this.inner.counts(mailbox);
    await this.kv.putJson(key, counts, COUNTS_TTL);
    return counts;
  }

  get(id: string) {
    return this.inner.get(id);
  }

  async saveInbound(input: NewInboundMessage) {
    const saved = await this.inner.saveInbound(input);
    await this.invalidateMailbox(input.mailbox.value);
    return saved;
  }

  async saveOutbound(input: NewInboundMessage & { folder: Folder }) {
    const saved = await this.inner.saveOutbound(input);
    await this.invalidateMailbox(input.mailbox.value);
    return saved;
  }

  async updateDraft(
    id: string,
    input: NewInboundMessage & { folder: Folder },
    keepAttachmentIds?: string[],
  ) {
    const current = await this.inner.get(id);
    const updated = await this.inner.updateDraft(id, input, keepAttachmentIds);
    if (current) await this.invalidateMailbox(current.mailbox.value);
    if (input.mailbox.value !== current?.mailbox.value) {
      await this.invalidateMailbox(input.mailbox.value);
    }
    return updated;
  }

  async patch(
    id: string,
    patch: Partial<Pick<Message, "unread" | "starred" | "folder">>,
  ) {
    const current = await this.inner.get(id);
    const updated = await this.inner.patch(id, patch);
    if (current) await this.invalidateMailbox(current.mailbox.value);
    return updated;
  }

  async remove(id: string) {
    const current = await this.inner.get(id);
    const removed = await this.inner.remove(id);
    if (current) await this.invalidateMailbox(current.mailbox.value);
    return removed;
  }

  getAttachment(id: string) {
    return this.inner.getAttachment(id);
  }

  private invalidateMailbox(address: string) {
    return this.kv.deleteMany([
      `cnt:${address}`,
      ...LIST_FOLDERS.map((folder) => listCacheKey(address, folder)),
    ]);
  }
}

function listCacheKey(mailbox: string, folder: string) {
  return `list:${mailbox}:${folder}`;
}
