import PostalMime from "postal-mime";
import { EmailAddress } from "../../domain/shared/EmailAddress";
import type { AddressHeader } from "../../domain/message/Message";
import type { NewInboundMessage } from "../../application/ports";

export async function parseInbound(
  message: ForwardableEmailMessage,
): Promise<NewInboundMessage> {
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const mailbox =
    EmailAddress.parse(stripBrackets(message.to)) ??
    EmailAddress.parse(parsed.to?.[0]?.address ?? "") ??
    EmailAddress.parse("unknown@invalid.local");

  const from = header(parsed.from);
  const to = (parsed.to ?? []).map(header);
  const cc = (parsed.cc ?? []).map(header);
  const subject = parsed.subject || "(no subject)";
  const text = parsed.text || "";
  const html = parsed.html || "";
  const internetMessageId = parsed.messageId || message.headers.get("message-id") || "";
  const inReplyTo = parsed.inReplyTo || message.headers.get("in-reply-to") || "";
  const references = message.headers.get("references") || "";
  const threadSeed = references.trim().split(/\s+/)[0] || inReplyTo || internetMessageId;
  const dateMs = parsed.date ? Date.parse(parsed.date) || Date.now() : Date.now();

  return {
    mailbox: mailbox!,
    from,
    to: to.length ? to : [{ address: message.to, name: "" }],
    cc,
    replyTo: parsed.replyTo?.[0]?.address || from.address,
    subject,
    snippet: (text || html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 240),
    html,
    text,
    threadId: threadSeed.replace(/[<>]/g, "") || crypto.randomUUID(),
    internetMessageId,
    inReplyTo,
    dateMs,
    sizeBytes: message.rawSize,
    raw,
    attachments: (parsed.attachments ?? [])
      .filter((file) => file.content)
      .map((file) => ({
        filename: file.filename || "attachment",
        contentType: file.mimeType || "application/octet-stream",
        content: toBuffer(file.content as ArrayBuffer | Uint8Array | string),
      })),
  };
}

function header(value?: { address?: string; name?: string }): AddressHeader {
  return { address: value?.address || "", name: value?.name || "" };
}

function stripBrackets(value: string) {
  return value.replace(/^<|>$/g, "");
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (typeof content === "string") return new TextEncoder().encode(content).buffer;
  if (content instanceof Uint8Array) {
    return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
  }
  return content;
}
