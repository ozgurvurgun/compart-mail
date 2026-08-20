import { useEffect, useRef, useState } from "react";
import { api, type Person } from "./api";

export function AddressField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<Person[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const token = lastToken(value).token;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api<Person[]>(`/api/contacts?q=${encodeURIComponent(token)}&limit=8`).then((rows) => {
        const used = new Set(existingAddresses(value));
        setItems(rows.filter((row) => !used.has(row.email)).slice(0, 8));
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [token, value]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(person: Person) {
    onChange(replaceToken(value, formatPerson(person)));
    setOpen(false);
  }

  return (
    <div ref={root} className="relative">
      <input
        value={value}
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!open || items.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % items.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index - 1 + items.length) % items.length);
          } else if (event.key === "Enter" && items[active]) {
            event.preventDefault();
            pick(items[active]);
          } else if (event.key === "Escape") setOpen(false);
        }}
        className="field"
      />
      {open && items.length > 0 ? (
        <ul
          role="listbox"
          className="menu-surface absolute z-50 mt-1 max-h-56 w-full overflow-x-hidden overflow-y-auto rounded-[12px] border border-[color:var(--color-line)] py-1.5 shadow-[var(--shadow)]"
        >
          {items.map((person, index) => (
            <li key={person.email}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={`flex w-full min-w-0 flex-col px-3 py-2 text-left text-sm ${
                  index === active ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-ink" : "text-muted hover:bg-[var(--fill)] hover:text-ink"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(person)}
              >
                <span className="truncate text-ink">{person.name || person.email.split("@")[0]}</span>
                <span className="truncate text-[13px] text-muted">{person.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function lastToken(value: string) {
  const parts = value.split(",");
  return { token: (parts.at(-1) || "").trim() };
}

function existingAddresses(value: string) {
  return value
    .split(",")
    .slice(0, -1)
    .map((part) => {
      const named = part.match(/<([^>]+)>/);
      return (named ? named[1] : part).trim().toLowerCase();
    })
    .filter(Boolean);
}

function replaceToken(value: string, next: string) {
  const parts = value.split(",");
  parts[parts.length - 1] = ` ${next}`;
  return `${parts.join(",").replace(/^,/, "").trim()}, `;
}

function formatPerson(person: Person) {
  return person.name ? `${person.name} <${person.email}>` : person.email;
}
