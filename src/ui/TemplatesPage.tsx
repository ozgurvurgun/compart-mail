import { useEffect, useMemo, useState } from "react";
import { api, type EmailTemplate } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";

export function TemplatesPage({
  q,
  onUse,
}: {
  q: string;
  onUse: (template: EmailTemplate) => void;
}) {
  const [items, setItems] = useState<EmailTemplate[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState({ id: "", name: "", subject: "", html: "" });
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const [error, setError] = useState("");

  async function load(nextQ = q) {
    setReady(false);
    const rows = await api<EmailTemplate[]>(
      `/api/templates?q=${encodeURIComponent(nextQ)}&limit=200`,
    );
    setItems(rows);
    setReady(true);
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]?.id ?? null);
    } else if (!selectedId && rows[0]) {
      setSelectedId(rows[0].id);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(q), 120);
    return () => window.clearTimeout(timer);
  }, [q]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  function openNew() {
    setDraft({ id: "", name: "", subject: "", html: "" });
    setPreview(true);
    setError("");
    setEditorOpen(true);
  }

  function openEdit(item: EmailTemplate) {
    setDraft({
      id: item.id,
      name: item.name,
      subject: item.subject,
      html: item.html,
    });
    setPreview(true);
    setError("");
    setEditorOpen(true);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await api<EmailTemplate>("/api/templates", {
        method: "POST",
        body: JSON.stringify({
          id: draft.id || undefined,
          name: draft.name,
          subject: draft.subject,
          html: draft.html,
        }),
      });
      setNote(draft.id ? "Template updated." : "Template saved.");
      setEditorOpen(false);
      await load();
      setSelectedId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col bg-surface shadow-[inset_-0.5px_0_0_var(--color-line)] lg:w-[23rem] lg:shrink-0 lg:flex-none">
        <div className="hairline flex h-12 shrink-0 items-center gap-3 px-3">
          <p className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.03em]">
            Templates
          </p>
          <span className="shrink-0 text-[13px] tabular-nums text-muted">
            {ready ? items.length : ""}
          </span>
          <button type="button" className="btn-ghost px-2 text-[17px]" onClick={openNew}>
            New
          </button>
        </div>
        {note ? <p className="px-4 py-2 text-[13px] text-muted">{note}</p> : null}
        <div className="mail-scroll flex-1 overflow-y-auto">
          {!ready ? (
            <div className="grid place-items-center px-6 py-16">
              <div className="spinner" />
            </div>
          ) : items.length === 0 ? (
            <div className="grid place-items-center px-6 py-16 text-center">
              <p className="text-[22px] font-semibold tracking-[-0.03em]">No Templates</p>
              <p className="mt-1 max-w-xs text-[15px] text-muted">
                Save HTML email layouts here, preview them, then use in Compose.
              </p>
            </div>
          ) : (
            <ul>
              {items.map((item) => {
                const active = item.id === selectedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`hairline flex w-full flex-col gap-0.5 px-4 py-3 text-left ${
                        active ? "bg-[var(--fill)]" : ""
                      }`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="truncate text-[16px] font-semibold tracking-[-0.02em]">
                        {item.name}
                      </span>
                      <span className="truncate text-[13px] text-muted">
                        {item.subject || "No subject"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className={`flex min-w-0 flex-1 flex-col ${selected || editorOpen ? "" : "max-lg:hidden"}`}>
        {editorOpen ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="hairline flex h-12 shrink-0 items-center gap-2 px-3">
              <button
                type="button"
                className="btn-ghost px-2 text-[17px]"
                onClick={() => setEditorOpen(false)}
              >
                Cancel
              </button>
              <p className="min-w-0 flex-1 truncate text-[17px] font-semibold">
                {draft.id ? "Edit Template" : "New Template"}
              </p>
              <button
                type="button"
                className="btn-ghost px-2 text-[17px]"
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? "Code" : "Preview"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="btn-ghost px-2 text-[17px] font-semibold"
                onClick={() => void save()}
              >
                {busy ? "Saving" : "Save"}
              </button>
            </div>
            <div className="space-y-0 border-b border-[color:var(--color-line)] px-4 py-2">
              <label className="block py-1.5">
                <span className="mb-1 block text-[12px] font-medium text-muted">Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="field w-full"
                  placeholder="Campaign name"
                />
              </label>
              <label className="block py-1.5">
                <span className="mb-1 block text-[12px] font-medium text-muted">Subject</span>
                <input
                  value={draft.subject}
                  onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                  className="field w-full"
                  placeholder="Optional default subject"
                />
              </label>
            </div>
            {error ? <p className="px-4 py-2 text-[15px] text-danger">{error}</p> : null}
            {preview ? (
              <iframe
                title="Template preview"
                sandbox=""
                srcDoc={draft.html || "<p style='font-family:sans-serif;color:#6b7280;padding:24px'>Paste HTML to preview</p>"}
                className="min-h-0 w-full flex-1 border-0 bg-white"
              />
            ) : (
              <textarea
                value={draft.html}
                onChange={(event) => setDraft({ ...draft, html: event.target.value })}
                className="min-h-0 flex-1 resize-none border-0 bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed outline-none"
                placeholder="Paste full HTML email here…"
                spellCheck={false}
              />
            )}
          </div>
        ) : selected ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="hairline flex h-12 shrink-0 items-center gap-2 px-3">
              <p className="min-w-0 flex-1 truncate text-[17px] font-semibold">{selected.name}</p>
              <button
                type="button"
                className="btn-ghost px-2 text-[17px]"
                onClick={() => onUse(selected)}
              >
                Use
              </button>
              <button
                type="button"
                className="btn-ghost px-2 text-[17px]"
                onClick={() => openEdit(selected)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn-ghost px-2 text-[17px] text-danger"
                onClick={() => setAskDelete(true)}
              >
                Delete
              </button>
            </div>
            {selected.subject ? (
              <p className="hairline px-4 py-2 text-[14px] text-muted">Subject: {selected.subject}</p>
            ) : null}
            <iframe
              title="Template preview"
              sandbox=""
              srcDoc={selected.html}
              className="min-h-0 w-full flex-1 border-0 bg-white"
            />
          </div>
        ) : (
          <div className="grid flex-1 place-items-center px-6 py-16 text-center max-lg:hidden">
            <p className="text-[22px] font-semibold tracking-[-0.03em]">Pick a template</p>
            <p className="mt-1 max-w-xs text-[15px] text-muted">Or create a new HTML layout.</p>
          </div>
        )}
      </div>

      {askDelete ? (
        <ConfirmDialog
          danger
          title="Delete template?"
          body="This removes the saved HTML layout. Messages already sent are unchanged."
          confirmLabel="Delete"
          onCancel={() => setAskDelete(false)}
          onConfirm={async () => {
            if (!selected) return;
            await api(`/api/templates/${selected.id}`, { method: "DELETE" });
            setAskDelete(false);
            setNote("Template deleted.");
            setSelectedId(null);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}
