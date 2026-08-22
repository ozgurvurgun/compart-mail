import type { MailApplication } from "../../application/MailApplication";
import type { Authenticator, ComposeCommand, MessageListQuery } from "../../application/ports";
import type { AddressHeader } from "../../domain/message/Message";
import { EmailAddress } from "../../domain/shared/EmailAddress";
import { isFolder } from "../../domain/mailbox/Folder";
import { sameOrigin } from "./sameOrigin";

export async function handleApi(
  request: Request,
  app: MailApplication,
  auth: Authenticator,
  ctx: ExecutionContext,
  options: { accessConfigured: boolean },
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (!sameOrigin(request)) {
    return json({ error: "Invalid origin" }, 403);
  }

  if (path === "/api/session" && request.method === "GET") {
    if (!options.accessConfigured) {
      return json({ error: "Cloudflare Access is not configured" }, 503);
    }
    const result = await app.session(request, ctx);
    return result.ok ? json(result.value) : json({ error: result.error }, 401);
  }

  const identity = await app.requireIdentity(request, ctx);
  if (!identity.ok) {
    if (!options.accessConfigured) {
      return json({ error: "Cloudflare Access is not configured" }, 503);
    }
    return json({ error: identity.error }, 401);
  }

  if (path === "/api/messages" && request.method === "GET") {
    const mailboxParam = url.searchParams.get("mailbox") || "";
    const allMailboxes = mailboxParam === "all";
    const mailbox = allMailboxes ? undefined : EmailAddress.parse(mailboxParam);
    const folderRaw = url.searchParams.get("folder") || "inbox";
    if (!allMailboxes && !mailbox) return json({ error: "Invalid mailbox" }, 400);
    if (folderRaw !== "starred" && !isFolder(folderRaw)) {
      return json({ error: "Invalid folder" }, 400);
    }
    const result = await app.list({
      mailbox,
      folder: folderRaw as MessageListQuery["folder"],
      q: url.searchParams.get("q") || undefined,
      limit: Number(url.searchParams.get("limit") || 40),
      cursor: url.searchParams.get("cursor") || undefined,
    });
    const counts = await app.counts(mailbox);
    return json({ ...result.value, counts: counts.value });
  }

  if (path === "/api/messages/batch" && request.method === "POST") {
    const body = (await request.json()) as {
      ids?: unknown;
      folder?: string;
      deleteForever?: boolean;
    };
    const ids = sanitizeIds(body.ids);
    if (ids.length === 0) return json({ error: "No messages selected" }, 400);
    if (body.deleteForever) {
      const result = await app.removeMany(ids);
      return json(result.value);
    }
    const folder = body.folder && isFolder(body.folder) ? body.folder : undefined;
    if (!folder) return json({ error: "Invalid folder" }, 400);
    const result = await app.patchMany(ids, { folder });
    return json(result.value);
  }

  const messageMatch = path.match(/^\/api\/messages\/([^/]+)$/);
  if (messageMatch && request.method === "GET") {
    const result = await app.readMessage(messageMatch[1]);
    if (!result.ok) return json({ error: result.error }, 404);
    const { markRead, ...payload } = result.value;
    if (markRead) ctx.waitUntil(app.patch(messageMatch[1], { unread: false }).then(() => undefined));
    return json({ ...payload, unread: false });
  }

  const patchMatch = path.match(/^\/api\/messages\/([^/]+)$/);
  if (patchMatch && request.method === "PATCH") {
    const body = (await request.json()) as {
      unread?: boolean;
      starred?: boolean;
      folder?: string;
    };
    const folder = body.folder && isFolder(body.folder) ? body.folder : undefined;
    const result = await app.patch(patchMatch[1], {
      unread: body.unread,
      starred: body.starred,
      folder,
    });
    return result.ok ? json(result.value) : json({ error: result.error }, 404);
  }

  if (patchMatch && request.method === "DELETE") {
    const result = await app.remove(patchMatch[1]);
    return result.ok ? json(result.value) : json({ error: result.error }, 404);
  }

  if (path === "/api/send" && request.method === "POST") {
    const command = parseCompose(await request.json());
    if (!command) return json({ error: "Invalid from address" }, 400);
    const result = await app.compose(command);
    return result.ok ? json(result.value) : json({ error: result.error }, 400);
  }

  if (path === "/api/drafts" && request.method === "POST") {
    const command = parseCompose(await request.json());
    if (!command) return json({ error: "Invalid from address" }, 400);
    const result = await app.saveDraft(command);
    return result.ok ? json(result.value) : json({ error: result.error }, 400);
  }

  if (path === "/api/push/vapid" && request.method === "GET") {
    const key = app.vapidPublicKey();
    if (!key) return json({ error: "Push is not configured" }, 503);
    return json({ publicKey: key });
  }

  if (path === "/api/push/subscribe" && request.method === "POST") {
    const body = (await request.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const result = await app.subscribePush(identity.value.email, body);
    return result.ok ? json(result.value) : json({ error: result.error }, 400);
  }

  if (path === "/api/push/unsubscribe" && request.method === "POST") {
    const body = (await request.json()) as { endpoint?: string };
    const result = await app.unsubscribePush(body.endpoint || "");
    return result.ok ? json(result.value) : json({ error: result.error }, 400);
  }

  if (path === "/api/contacts" && request.method === "GET") {
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const result = await app.listContacts(
      url.searchParams.get("q") || undefined,
      Number.isFinite(limit) ? limit : undefined,
    );
    return json(result.value);
  }

  if (path === "/api/contacts/import" && request.method === "POST") {
    const body = (await request.json()) as { csv?: string };
    const result = await app.importContacts(body.csv || "");
    return result.ok ? json(result.value) : json({ error: result.error }, 400);
  }

  if (path === "/api/contacts/batch" && request.method === "POST") {
    const body = (await request.json()) as { emails?: unknown; deleteForever?: boolean };
    if (!body.deleteForever) return json({ error: "Unsupported action" }, 400);
    const emails = Array.isArray(body.emails)
      ? body.emails.filter((item): item is string => typeof item === "string").slice(0, 200)
      : [];
    if (emails.length === 0) return json({ error: "No contacts selected" }, 400);
    const result = await app.removeContacts(emails);
    return json(result.value);
  }

  const attMatch = path.match(/^\/api\/attachments\/([^/]+)$/);
  if (attMatch && request.method === "GET") {
    const result = await app.attachment(attMatch[1]);
    if (!result.ok) return json({ error: result.error }, 404);
    const forceDownload = url.searchParams.get("download") === "1";
    const inline = !forceDownload && canPreviewInline(result.value.contentType, result.value.filename);
    const filename = safeFilename(result.value.filename);
    return new Response(result.value.body, {
      headers: {
        "Content-Type": result.value.contentType || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=120",
      },
    });
  }

  return json({ error: "Not found" }, 404);
}

function parseCompose(raw: unknown): ComposeCommand | null {
  const body = raw as {
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    threadId?: string;
    draftId?: string;
    keepAttachmentIds?: string[];
    attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
  };
  const from = EmailAddress.parse(body.from || "");
  if (!from) return null;
  const keep = Array.isArray(body.keepAttachmentIds)
    ? body.keepAttachmentIds.filter((id) => typeof id === "string")
    : undefined;
  return {
    from,
    to: parseList(body.to || ""),
    cc: parseList(body.cc || ""),
    bcc: parseList(body.bcc || ""),
    subject: body.subject || "",
    text: body.text || "",
    html: body.html || "",
    inReplyTo: body.inReplyTo,
    threadId: body.threadId,
    draftId: typeof body.draftId === "string" ? body.draftId : undefined,
    keepAttachmentIds: keep,
    attachments: body.attachments || [],
  };
}

function sanitizeIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) continue;
    unique.add(value);
    if (unique.size >= 80) break;
  }
  return [...unique];
}

function parseList(raw: string): AddressHeader[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const named = part.match(/^(.*)<([^>]+)>$/);
      if (named) return { name: named[1].trim().replace(/^"|"$/g, ""), address: named[2].trim() };
      return { name: "", address: part };
    });
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function canPreviewInline(contentType: string, filename: string) {
  const type = (contentType || "").toLowerCase();
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (type === "image/svg+xml" || ext === "svg") return false;
  if (type.startsWith("image/")) return true;
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) return true;
  if (type === "application/pdf" || ext === "pdf") return true;
  if (type.startsWith("video/") || ["mp4", "webm"].includes(ext)) return true;
  if (type.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(ext)) return true;
  if ((type.startsWith("text/") && type !== "text/html") || ["txt", "csv", "md", "json"].includes(ext)) {
    return true;
  }
  return false;
}

function safeFilename(name: string) {
  return name.replace(/["\\\r\n]/g, "_").slice(0, 120) || "file";
}
