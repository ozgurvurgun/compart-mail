import type { EmailAddress } from "../shared/EmailAddress";

export type Contact = {
  email: EmailAddress;
  name: string;
  createdAt: number;
};
