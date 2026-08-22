import type { ComposeCommand, EmailSender } from "../../application/ports";

type SendBinding = {
  send(message: {
    to: Array<{ email: string; name?: string }>;
    from: { email: string; name?: string };
    cc?: Array<{ email: string; name?: string }>;
    bcc?: Array<{ email: string; name?: string }>;
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      content: string;
      filename: string;
      type: string;
      disposition: string;
    }>;
  }): Promise<{ messageId?: string }>;
};

export class CloudflareEmailSender implements EmailSender {
  constructor(
    private readonly binding: SendBinding,
    private readonly fromName: string,
  ) {}

  async send(command: ComposeCommand): Promise<{ messageId: string }> {
    const to = command.to.map((item) => ({ email: item.address, name: item.name }));
    const cc = command.cc.map((item) => ({ email: item.address, name: item.name }));
    const bcc = command.bcc.map((item) => ({ email: item.address, name: item.name }));
    const result = await this.binding.send({
      to,
      from: { email: command.from.value, name: this.fromName || command.from.localPart() },
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject: command.subject || "(no subject)",
      html: command.html || undefined,
      text: command.text || undefined,
      headers: command.inReplyTo
        ? { "In-Reply-To": command.inReplyTo, References: command.inReplyTo }
        : undefined,
      attachments: command.attachments.map((file) => ({
        content: file.contentBase64,
        filename: file.filename,
        type: file.contentType,
        disposition: "attachment",
      })),
    });
    return { messageId: result.messageId || crypto.randomUUID() };
  }
}
