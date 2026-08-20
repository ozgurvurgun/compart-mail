import { useEffect, useRef, useState } from "react";

export type MenuOption = {
  value: string;
  label: string;
  hint?: string;
};

export function MenuSelect({
  value,
  options,
  onChange,
  align = "left",
}: {
  value: string;
  options: MenuOption[];
  onChange: (value: string) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={root} className="relative min-w-0 w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-[10px] bg-[var(--fill)] px-3 py-2 text-left text-[15px] text-ink"
      >
        <span className="min-w-0 flex-1 overflow-hidden">
          <span className="block truncate font-medium">{current?.label}</span>
          {current?.hint ? (
            <span className="mt-0.5 block truncate text-[12px] text-muted">{current.hint}</span>
          ) : null}
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <ul
          role="listbox"
          className={`menu-surface absolute z-50 mt-1.5 max-h-64 w-full overflow-x-hidden overflow-y-auto rounded-[12px] border border-[color:var(--color-line)] py-1.5 shadow-[var(--shadow)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <li key={option.value} className="min-w-0">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`mx-1 flex w-[calc(100%-0.5rem)] min-w-0 items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 text-left text-[15px] ${
                    active ? "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-accent" : "text-ink hover:bg-[var(--fill)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="mt-0.5 block truncate text-[12px] text-muted">{option.hint}</span>
                    ) : null}
                  </span>
                  {active ? <CheckMark /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-3 w-3 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path
        d="M2.2 4.2 6 8l3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-accent" aria-hidden="true">
      <path
        d="M3.2 8.2 6.4 11.4 12.8 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
