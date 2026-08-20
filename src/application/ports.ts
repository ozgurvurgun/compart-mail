import type { EmailAddress } from "../domain/shared/EmailAddress";
import type { Folder } from "../domain/mailbox/Folder";
import type { AddressHeader, AttachmentRef, Message } from "../domain/message/Message";
import type { Mailbox } from "../domain/mailbox/Mailbox";
import type { Contact } from "../domain/contact/Contact";

export type MessageListQuery = {
  mailbox: EmailAddress;
  folder: Folder | "starred";
  q?: string;
  limit: number;
  cursor?: string;
};

export type MessageListItem = Omit<Message, "html" | "text">;

export type NewInboundMessage = {
  mailbox: EmailAddress;
  from: AddressHeader;
  to: AddressHeader[];
  cc: AddressHeader[];
  bcc?: AddressHeader[];
  replyTo: string;
  subject: string;
  snippet: string;
  html: string;
  text: string;
  threadId: string;
  internetMessageId: string;
  inReplyTo: string;
  dateMs: number;
  sizeBytes: number;
  raw: ArrayBuffer;
  attachments: Array<{
    filename: string;
    contentType: string;
    content: ArrayBuffer;
  }>;
};

export type ComposeCommand = {
  from: EmailAddress;
  to: AddressHeader[];
  cc: AddressHeader[];
  bcc: AddressHeader[];
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  threadId?: string;
  draftId?: string;
  keepAttachmentIds?: string[];
  attachments: Array<{
    filename: string;
    contentType: string;
    contentBase64: string;
  }>;
};

export interface MessageRepository {
  ensureMailbox(address: EmailAddress, displayName: string): Promise<void>;
  listMailboxes(): Promise<Mailbox[]>;
  list(query: MessageListQuery): Promise<{ items: MessageListItem[]; nextCursor: string | null }>;
  counts(mailbox: EmailAddress): Promise<Record<string, number>>;
  get(id: string): Promise<Message | null>;
  saveInbound(input: NewInboundMessage): Promise<Message>;
  saveOutbound(input: NewInboundMessage & { folder: Folder }): Promise<Message>;
  updateDraft(
    id: string,
    input: NewInboundMessage & { folder: Folder },
    keepAttachmentIds?: string[],
  ): Promise<Message | null>;
  patch(
    id: string,
    patch: Partial<Pick<Message, "unread" | "starred" | "folder">>,
  ): Promise<Message | null>;
  remove(id: string): Promise<boolean>;
  getAttachment(id: string): Promise<(AttachmentRef & { r2Key: string }) | null>;
}

export interface ContactRepository {
  list(q?: string, limit?: number): Promise<Contact[]>;
  remember(people: AddressHeader[], skip: Set<string>): Promise<number>;
  importRows(rows: AddressHeader[]): Promise<{ imported: number; skipped: number }>;
  remove(emails: string[]): Promise<number>;
}

export interface ObjectStore {
  put(key: string, data: ArrayBuffer | string, contentType: string): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface EmailSender {
  send(command: ComposeCommand): Promise<{ messageId: string }>;
}

export interface Identity {
  email: string;
  name?: string;
}

export interface Authenticator {
  authenticate(request: Request, ctx?: ExecutionContext): Promise<Identity | null>;
}

export interface AuthSession extends Authenticator {
  login(
    email: string,
    password: string,
    ip: string,
  ): Promise<import("../domain/shared/Result").Result<{ identity: Identity; setCookie: string }>>;
  logout(request: Request): Promise<string>;
}
