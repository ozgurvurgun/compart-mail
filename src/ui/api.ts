export type Mailbox = { address: string; displayName: string };

export type Session = {
  identity: { email: string; name?: string };
  appName: string;
  domain: string;
  mailboxes: Mailbox[];
};

export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type MessageListItem = {
  id: string;
  mailbox: { value: string } | string;
  folder: string;
  from: { address: string; name: string };
  to: Array<{ address: string; name: string }>;
  subject: string;
  snippet: string;
  dateMs: number;
  unread: boolean;
  starred: boolean;
  has_attachments?: number;
  attachments: Attachment[];
};

export type Person = {
  email: string;
  name: string;
};

export type MessageDetail = MessageListItem & {
  cc: Array<{ address: string; name: string }>;
  bcc: Array<{ address: string; name: string }>;
  html: string;
  text: string;
  threadId: string;
  internetMessageId: string;
  inReplyTo?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401) {
    throw new ApiError(body.error || "Unauthorized", 401);
  }
  if (response.status === 503) {
    throw new ApiError(body.error || "Service unavailable", 503);
  }
  if (!response.ok) {
    throw new ApiError(body.error || "Request failed", response.status);
  }
  return body as T;
}

export function mailboxAddress(value: MessageListItem["mailbox"]) {
  return typeof value === "string" ? value : value.value;
}

export function formatWhen(ms: number) {
  const date = new Date(ms);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function displayName(from: { address: string; name: string }) {
  return from.name || from.address;
}
