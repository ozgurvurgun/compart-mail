import type { TemplateRepository } from "../../application/ports";
import type { EmailTemplate } from "../../domain/template/EmailTemplate";

type Row = {
  id: string;
  name: string;
  subject: string;
  html: string;
  created_at: number;
  updated_at: number;
};

export class D1TemplateRepository implements TemplateRepository {
  constructor(private readonly db: D1Database) {}

  async list(q?: string, limit = 100): Promise<EmailTemplate[]> {
    const take = Math.min(Math.max(limit, 1), 200);
    const query = (q || "").trim();
    if (query) {
      const like = `%${query.replace(/[%_]/g, "")}%`;
      const rows = await this.db
        .prepare(
          `SELECT id, name, subject, html, created_at, updated_at FROM email_templates
           WHERE name LIKE ? OR subject LIKE ?
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .bind(like, like, take)
        .all<Row>();
      return (rows.results ?? []).map(toTemplate);
    }
    const rows = await this.db
      .prepare(
        `SELECT id, name, subject, html, created_at, updated_at FROM email_templates
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .bind(take)
      .all<Row>();
    return (rows.results ?? []).map(toTemplate);
  }

  async get(id: string): Promise<EmailTemplate | null> {
    const row = await this.db
      .prepare(
        `SELECT id, name, subject, html, created_at, updated_at FROM email_templates WHERE id = ?`,
      )
      .bind(id)
      .first<Row>();
    return row ? toTemplate(row) : null;
  }

  async save(input: {
    id?: string;
    name: string;
    subject: string;
    html: string;
  }): Promise<EmailTemplate> {
    const name = input.name.trim().slice(0, 120);
    const subject = input.subject.trim().slice(0, 300);
    const html = input.html.slice(0, 500_000);
    if (!name) throw new Error("Template name is required");
    if (!html.trim()) throw new Error("Template HTML is required");

    const now = Date.now();
    if (input.id) {
      const existing = await this.get(input.id);
      if (!existing) throw new Error("Template not found");
      await this.db
        .prepare(
          `UPDATE email_templates SET name = ?, subject = ?, html = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(name, subject, html, now, input.id)
        .run();
      return {
        id: input.id,
        name,
        subject,
        html,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
    }

    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO email_templates (id, name, subject, html, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, name, subject, html, now, now)
      .run();
    return { id, name, subject, html, createdAt: now, updatedAt: now };
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.prepare(`DELETE FROM email_templates WHERE id = ?`).bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }
}

function toTemplate(row: Row): EmailTemplate {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    html: row.html,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
