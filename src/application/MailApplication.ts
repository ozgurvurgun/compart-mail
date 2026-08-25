import { EmailAddress } from "../domain/shared/EmailAddress";
import type { Folder } from "../domain/mailbox/Folder";
import { err, ok, type Result } from "../domain/shared/Result";
import { parseContactCsv } from "./parseContactCsv";
import type {
  Authenticator,
  ComposeCommand,
  ContactRepository,
  EmailSender,
  Identity,
  MessageListQuery,
  MessageRepository,
  ObjectStore,
  TemplateRepository,
} from "./ports";
import type { PushStore } from "./pushPorts";
import { sendWebPush, type VapidKeys } from "../infrastructure/push/sendWebPush";

export type MailRuntimeConfig = {
  domain: string;
  seedMailboxes: string[];
  appName: string;
  fromDisplayName: string;
  vapid?: VapidKeys;
};

export class MailApplication {
  constructor(
    private readonly messages: MessageRepository,
    private readonly contacts: ContactRepository,
    private readonly templates: TemplateRepository,
    private readonly store: ObjectStore,
    private readonly sender: EmailSender,
    private readonly auth: Authenticator,
    private readonly push: PushStore,
    private readonly config: MailRuntimeConfig,
  ) {}

  async session(request: Request, ctx: ExecutionContext) {
    const identity = await this.auth.authenticate(request, ctx);
    if (!identity) return err("Unauthorized");
    await this.seedMailboxes();
    const mailboxes = await this.messages.listMailboxes();
    return ok({
      identity,
      appName: this.config.appName,
      fromDisplayName: this.config.fromDisplayName,
      domain: this.config.domain,
      mailboxes: mailboxes.map((box) => ({
        address: box.address.value,
        displayName: box.displayName,
      })),
    });
  }

  async requireIdentity(request: Request, ctx: ExecutionContext): Promise<Result<Identity>> {
    const identity = await this.auth.authenticate(request, ctx);
    return identity ? ok(identity) : err("Unauthorized");
  }

  async list(query: MessageListQuery) {
    return ok(await this.messages.list(query));
  }

  async counts(mailbox?: EmailAddress) {
    return ok(await this.messages.counts(mailbox));
  }

  async readMessage(id: string) {
    const message = await this.messages.get(id);
    if (!message) return err("Not found");
    const [html, text] = await Promise.all([
      message.html ? this.store.get(`messages/${id}/body.html`) : Promise.resolve(null),
      message.text ? this.store.get(`messages/${id}/body.txt`) : Promise.resolve(null),
    ]);
    return ok({
      ...message,
      mailbox: message.mailbox.value,
      html: html ? new TextDecoder().decode(html) : "",
      text: text ? new TextDecoder().decode(text) : "",
      markRead: message.unread,
    });
  }

  async patch(id: string, patch: { unread?: boolean; starred?: boolean; folder?: Folder }) {
    const updated = await this.messages.patch(id, patch);
    return updated ? ok({ id: updated.id }) : err("Not found");
  }

  async patchMany(ids: string[], patch: { unread?: boolean; starred?: boolean; folder?: Folder }) {
    let updated = 0;
    for (const id of ids) {
      const row = await this.messages.patch(id, patch);
      if (row) updated += 1;
    }
    return ok({ updated });
  }

  async remove(id: string) {
    const removed = await this.messages.remove(id);
    return removed ? ok({ id }) : err("Not found");
  }

  async removeMany(ids: string[]) {
    let removed = 0;
    for (const id of ids) {
      if (await this.messages.remove(id)) removed += 1;
    }
    return ok({ removed });
  }

  async compose(command: ComposeCommand) {
    if (command.from.domain() !== this.config.domain) {
      return err("Sender must belong to this domain");
    }
    if (command.to.length === 0) return err("At least one recipient is required");
    const normalized = normalizeComposeBody(command);
    if (!normalized.subject.trim() && !normalized.text.trim() && !normalized.html.trim()) {
      return err("Message is empty");
    }

    const attachments = await this.collectAttachments(normalized);
    let sent: { messageId: string };
    try {
      sent = await this.sender.send({
        ...normalized,
        attachments: toBase64Payloads(attachments),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      return err(message.includes("send") ? message : `Send failed: ${message}`);
    }
    const now = Date.now();
    const id = crypto.randomUUID();
    const html = normalized.html || `<pre>${escapeHtml(normalized.text)}</pre>`;
    const text = normalized.text || stripHtml(normalized.html);
    await this.messages.saveOutbound({
      mailbox: normalized.from,
      from: { address: normalized.from.value, name: this.config.fromDisplayName },
      to: normalized.to,
      cc: normalized.cc,
      bcc: normalized.bcc,
      replyTo: normalized.from.value,
      subject: normalized.subject,
      snippet: text.replace(/\s+/g, " ").slice(0, 240),
      html,
      text,
      threadId: normalized.threadId || id,
      internetMessageId: sent.messageId || `<${id}@${this.config.domain}>`,
      inReplyTo: normalized.inReplyTo || "",
      dateMs: now,
      sizeBytes: new TextEncoder().encode(html).byteLength,
      raw: new ArrayBuffer(0),
      attachments,
      folder: "sent",
    });
    if (normalized.draftId) await this.messages.remove(normalized.draftId);
    await this.rememberRecipients(normalized);
    return ok({ id, messageId: sent.messageId });
  }

  async listContacts(q?: string, limit?: number) {
    const take = Math.min(Math.max(limit ?? (q ? 12 : 200), 1), 200);
    const items = await this.contacts.list(q, take);
    return ok(
      items.map((item) => ({
        email: item.email.value,
        name: item.name,
      })),
    );
  }

  async importContacts(csv: string) {
    const rows = parseContactCsv(csv);
    if (rows.length === 0) return err("No contacts in this CSV");
    const result = await this.contacts.importRows(rows);
    return ok(result);
  }

  async removeContacts(emails: string[]) {
    const unique = [...new Set(emails.map((item) => item.trim().toLowerCase()))].slice(0, 200);
    const removed = await this.contacts.remove(unique);
    return ok({ removed });
  }

  private async rememberRecipients(command: ComposeCommand) {
    const boxes = await this.messages.listMailboxes();
    const skip = new Set(boxes.map((box) => box.address.value));
    skip.add(command.from.value);
    await this.contacts.remember([...command.to, ...command.cc, ...command.bcc], skip);
  }

  async saveDraft(command: ComposeCommand) {
    if (command.from.domain() !== this.config.domain) {
      return err("Sender must belong to this domain");
    }
    const normalized = normalizeComposeBody(command);
    const html = normalized.html || (normalized.text ? `<pre>${escapeHtml(normalized.text)}</pre>` : "");
    const text = normalized.text || stripHtml(normalized.html);
    const snippet = text.replace(/\s+/g, " ").slice(0, 240) || normalized.subject.trim() || "Draft";
    const now = Date.now();
    const payload = {
      mailbox: normalized.from,
      from: { address: normalized.from.value, name: this.config.fromDisplayName },
      to: normalized.to,
      cc: normalized.cc,
      bcc: normalized.bcc,
      replyTo: normalized.from.value,
      subject: normalized.subject,
      snippet,
      html,
      text,
      threadId: normalized.threadId || crypto.randomUUID(),
      internetMessageId: "",
      inReplyTo: normalized.inReplyTo || "",
      dateMs: now,
      sizeBytes: new TextEncoder().encode(html || text).byteLength,
      raw: new ArrayBuffer(0),
      attachments: normalized.attachments.map((file) => ({
        filename: file.filename,
        contentType: file.contentType,
        content: base64ToBuffer(file.contentBase64),
      })),
      folder: "drafts" as const,
    };
    if (normalized.draftId) {
      const updated = await this.messages.updateDraft(
        normalized.draftId,
        payload,
        normalized.keepAttachmentIds,
      );
      if (updated) return ok({ id: updated.id });
    }
    const saved = await this.messages.saveOutbound(payload);
    return ok({ id: saved.id });
  }

  async listTemplates(q?: string, limit?: number) {
    const take = Math.min(Math.max(limit ?? 100, 1), 200);
    const items = await this.templates.list(q, take);
    return ok(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        subject: item.subject,
        html: item.html,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    );
  }

  async getTemplate(id: string) {
    const item = await this.templates.get(id);
    return item
      ? ok({
          id: item.id,
          name: item.name,
          subject: item.subject,
          html: item.html,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })
      : err("Not found");
  }

  async saveTemplate(input: { id?: string; name: string; subject: string; html: string }) {
    try {
      const item = await this.templates.save(input);
      return ok({
        id: item.id,
        name: item.name,
        subject: item.subject,
        html: item.html,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    } catch (error) {
      return err(error instanceof Error ? error.message : "Could not save template");
    }
  }

  async removeTemplate(id: string) {
    const removed = await this.templates.remove(id);
    return removed ? ok({ id }) : err("Not found");
  }

  private async collectAttachments(command: ComposeCommand) {
    const files = command.attachments.map((file) => ({
      filename: file.filename,
      contentType: file.contentType,
      content: base64ToBuffer(file.contentBase64),
    }));
    if (!command.draftId) return files;
    const draft = await this.messages.get(command.draftId);
    if (!draft || draft.folder !== "drafts") return files;
    const keep = new Set(command.keepAttachmentIds ?? draft.attachments.map((item) => item.id));
    const kept = [];
    for (const item of draft.attachments) {
      if (!keep.has(item.id)) continue;
      const meta = await this.messages.getAttachment(item.id);
      const body = meta ? await this.store.get(meta.r2Key) : null;
      if (!meta || !body) continue;
      kept.push({
        filename: meta.filename,
        contentType: meta.contentType,
        content: body,
      });
    }
    return [...kept, ...files];
  }

  async attachment(id: string) {
    const meta = await this.messages.getAttachment(id);
    if (!meta) return err("Not found");
    const body = await this.store.get(meta.r2Key);
    if (!body) return err("Not found");
    return ok({ ...meta, body });
  }

  async seedMailboxes() {
    for (const local of this.config.seedMailboxes) {
      const address = EmailAddress.parse(`${local}@${this.config.domain}`);
      if (!address) continue;
      await this.messages.ensureMailbox(address, titleCase(local));
    }
  }

  vapidPublicKey() {
    return this.config.vapid?.publicKey || "";
  }

  async subscribePush(userEmail: string, body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
    const endpoint = (body.endpoint || "").trim();
    const p256dh = (body.keys?.p256dh || "").trim();
    const auth = (body.keys?.auth || "").trim();
    if (!endpoint.startsWith("https://") || !p256dh || !auth) return err("Invalid subscription");
    await this.push.save({ endpoint, p256dh, auth, userEmail });
    return ok({ ok: true });
  }

  async unsubscribePush(endpoint: string) {
    if (!endpoint) return err("Invalid subscription");
    await this.push.remove(endpoint);
    return ok({ ok: true });
  }

  async notifyNewMail(input: { from: string; subject: string; mailbox: string }) {
    if (!this.config.vapid) return;
    const payload = JSON.stringify({
      title: input.from || "New mail",
      body: input.subject || "No subject",
      url: "/",
      tag: `mail:${input.mailbox}`,
    });
    const list = await this.push.list();
    for (const target of list) {
      try {
        const status = await sendWebPush(target, payload, this.config.vapid);
        if (status === 404 || status === 410) await this.push.remove(target.endpoint);
      } catch {
      }
    }
  }
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Detect pasted HTML so Cloudflare Email sends text/html, not text/plain. */
export function looksLikeHtml(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^<!DOCTYPE\s+html/i.test(v) || /^<html[\s>]/i.test(v)) return true;
  return /<(div|table|tr|td|th|p|br|h[1-6]|span|style|head|body|img|a|ul|ol|li|section|header|footer)\b/i.test(
    v,
  );
}

function normalizeComposeBody(command: ComposeCommand): ComposeCommand {
  let html = (command.html || "").trim();
  let text = (command.text || "").trim();
  if (!html && text && looksLikeHtml(text)) {
    html = text;
    text = stripHtml(html);
  } else if (html && !text) {
    text = stripHtml(html);
  }
  return { ...command, html, text, attachments: command.attachments ?? [] };
}

function base64ToBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBase64Payloads(
  files: Array<{ filename: string; contentType: string; content: ArrayBuffer }>,
) {
  return files.map((file) => ({
    filename: file.filename,
    contentType: file.contentType,
    contentBase64: bufferToBase64(file.content),
  }));
}

function bufferToBase64(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
