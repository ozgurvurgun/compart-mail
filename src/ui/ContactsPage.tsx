import { useEffect, useRef, useState } from "react";
import { api, type Person } from "./api";
import { CheckBox } from "./CheckBox";
import { ConfirmDialog } from "./ConfirmDialog";

export function ContactsPage({
  q,
  onCompose,
}: {
  q: string;
  onCompose: (emails: string[]) => void;
}) {
  const [items, setItems] = useState<Person[]>([]);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, Person[]>());
  const loadSeq = useRef(0);

  async function load(nextQ = q) {
    const key = nextQ.trim();
    const cached = cache.current.get(key);
    if (cached) {
      setItems(cached);
      setReady(true);
      setPicked((prev) => prev.filter((email) => cached.some((row) => row.email === email)));
    } else {
      setItems([]);
      setReady(false);
      setPicked([]);
    }
    const seq = ++loadSeq.current;
    const rows = await api<Person[]>(`/api/contacts?q=${encodeURIComponent(nextQ)}&limit=200`);
    if (seq !== loadSeq.current) return;
    cache.current.set(key, rows);
    setItems(rows);
    setReady(true);
    setPicked((prev) => prev.filter((email) => rows.some((row) => row.email === email)));
  }

  const skipQLoad = useRef(true);
  useEffect(() => {
    if (skipQLoad.current) {
      skipQLoad.current = false;
      void load(q);
      return;
    }
    const timer = window.setTimeout(() => void load(q), 160);
    return () => window.clearTimeout(timer);
  }, [q]);

  async function importCsv(file: File) {
    const csv = await file.text();
    const result = await api<{ imported: number; skipped: number }>("/api/contacts/import", {
      method: "POST",
      body: JSON.stringify({ csv }),
    });
    setNote(`Imported ${result.imported}, skipped ${result.skipped} already saved or invalid.`);
    cache.current.clear();
    await load();
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <div className="hairline flex h-12 shrink-0 items-center gap-3 bg-surface px-3">
        <CheckBox
          checked={items.length > 0 && picked.length === items.length}
          mixed={picked.length > 0 && picked.length < items.length}
          disabled={items.length === 0}
          label="Select all people"
          onChange={(next) => setPicked(next ? items.map((item) => item.email) : [])}
        />
        {picked.length > 0 ? (
          <>
            <p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">
              {picked.length} Selected
            </p>
            <button type="button" className="btn-ghost px-2 text-[17px]" onClick={() => onCompose(picked)}>
              Mail
            </button>
            <button type="button" className="btn-ghost px-2 text-[17px] text-danger" onClick={() => setAskDelete(true)}>
              Delete
            </button>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.03em]">Contacts</p>
            <span className="shrink-0 text-[13px] tabular-nums text-muted">{ready ? items.length : ""}</span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importCsv(file);
              }}
            />
            <button type="button" className="btn-ghost px-2 text-[17px]" onClick={() => fileInput.current?.click()}>
              Import
            </button>
          </>
        )}
      </div>
      {note ? <p className="px-4 py-2 text-[13px] text-muted">{note}</p> : null}
      <div className="mail-scroll flex-1 overflow-y-auto">
        {ready && picked.length === 0 ? <CsvPreview /> : null}
        {!ready ? (
          <div className="grid place-items-center px-6 py-16">
            <div className="spinner" />
          </div>
        ) : items.length === 0 ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <p className="text-[22px] font-semibold tracking-[-0.03em]">No Contacts</p>
            <p className="mt-1 max-w-xs text-[15px] text-muted">
              Send mail or import a CSV using the format below.
            </p>
          </div>
        ) : (
          <div className="mx-3 mb-4 overflow-hidden rounded-[12px] bg-surface">
            {items.map((person, index) => {
              const checked = picked.includes(person.email);
              const initial = (person.name || person.email).slice(0, 1).toUpperCase();
              return (
                <div
                  key={person.email}
                  className={`flex items-center gap-3 px-3 py-2.5 ${
                    index < items.length - 1 ? "shadow-[inset_0_-0.5px_0_var(--color-line)]" : ""
                  }`}
                >
                  <CheckBox
                    checked={checked}
                    label={`Select ${person.name || person.email}`}
                    onChange={(next) => {
                      setPicked((prev) =>
                        next ? [...prev, person.email] : prev.filter((email) => email !== person.email),
                      );
                    }}
                  />
                  <span className="avatar h-9 w-9 text-[13px]">{initial}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[17px] text-ink">{person.name || person.email.split("@")[0]}</p>
                    <p className="truncate text-[13px] text-muted">{person.email}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 px-2 text-[15px]"
                    onClick={() => onCompose([person.email])}
                  >
                    Mail
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {askDelete ? (
        <ConfirmDialog
          danger
          title={picked.length > 1 ? `Delete ${picked.length} Contacts` : "Delete Contact"}
          body="They leave the contacts list. Mail already sent stays in the archive."
          confirmLabel="Delete"
          onCancel={() => setAskDelete(false)}
          onConfirm={async () => {
            await api("/api/contacts/batch", {
              method: "POST",
              body: JSON.stringify({ emails: picked, deleteForever: true }),
            });
            setAskDelete(false);
            setPicked([]);
            cache.current.clear();
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

const CSV_SAMPLE = `email,name
ada@example.com,Ada Lovelace
linus@example.org,Linus Torvalds`;

function CsvPreview() {
  return (
    <div className="mx-3 mt-3 mb-3 overflow-hidden rounded-[12px] bg-surface">
      <div className="flex items-center justify-between gap-3 px-3 py-2 shadow-[inset_0_-0.5px_0_var(--color-line)]">
        <p className="text-[13px] font-medium text-muted">CSV Format</p>
        <p className="truncate text-[12px] text-muted">First row is the header.</p>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[13px] leading-relaxed text-ink">{CSV_SAMPLE}</pre>
    </div>
  );
}
