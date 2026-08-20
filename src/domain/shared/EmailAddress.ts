export class EmailAddress {
  private constructor(readonly value: string) {}

  static parse(raw: string): EmailAddress | null {
    const value = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
    return new EmailAddress(value);
  }

  static parseOrThrow(raw: string): EmailAddress {
    const parsed = EmailAddress.parse(raw);
    if (!parsed) throw new Error(`Invalid email address: ${raw}`);
    return parsed;
  }

  localPart(): string {
    return this.value.split("@")[0] ?? "";
  }

  domain(): string {
    return this.value.split("@")[1] ?? "";
  }

  equals(other: EmailAddress): boolean {
    return this.value === other.value;
  }
}
