import type { EmailAddress } from "../shared/EmailAddress";

export type AddressHeader = {
  address: string;
  name: string;
};

export type AttachmentRef = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type MessageDirection = "inbound" | "outbound";

export type Message = {
  id: string;
  mailbox: EmailAddress;
  folder: string;
  direction: MessageDirection;
  from: AddressHeader;
  to: AddressHeader[];
  cc: AddressHeader[];
  bcc: AddressHeader[];
  replyTo: string;
  subject: string;
  snippet: string;
  html: string | null;
  text: string | null;
  threadId: string;
  internetMessageId: string;
  inReplyTo: string;
  dateMs: number;
  unread: boolean;
  starred: boolean;
  attachments: AttachmentRef[];
  sizeBytes: number;
};
