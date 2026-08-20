import { parseInbound } from "./email/parseInbound";
import type { MessageRepository } from "../application/ports";

export async function ingestInbound(message: ForwardableEmailMessage, repository: MessageRepository) {
  const parsed = await parseInbound(message);
  await repository.saveInbound(parsed);
  return parsed;
}
