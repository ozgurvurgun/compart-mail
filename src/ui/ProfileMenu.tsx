import { useEffect, useRef, useState } from "react";
import { useTheme } from "./theme";
import { disablePush, enablePush, isIos, isStandalone, pushEnabled } from "./pushClient";
import { Switch } from "./Switch";

export function ProfileMenu({
  name,
  email,
  onSignOut,
}: {
  name: string;
  email: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { themePref, setThemePref, font, setFont, density, setDensity } = useTheme();
  const [alerts, setAlerts] = useState(false);
  const [alertNote, setAlertNote] = useState("");
  const initial = (name || email).slice(0, 1).toUpperCase();

  useEffect(() => {
    void pushEnabled().then(setAlerts);
  }, []);

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
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full py-0.5 pr-0.5 pl-1 transition hover:bg-[var(--fill)]"
      >
        <span className="hidden text-right sm:block">
          <span className="block max-w-[10rem] truncate text-[13px] font-medium text-ink">{name}</span>
          <span className="block max-w-[10rem] truncate text-[11px] text-muted">{email}</span>
        </span>
        <span className="avatar">{initial}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="menu-surface absolute top-full right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-x-hidden overflow-y-auto rounded-[14px] border border-[color:var(--color-line)] bg-surface p-3 shadow-[var(--shadow)]"
        >
          <p className="px-1 pb-1 text-[13px] text-muted">Appearance</p>
          <Segment
            value={themePref}
            onChange={setThemePref}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
              { value: "system", label: "Auto" },
            ]}
          />
          <p className="mt-4 px-1 pb-1 text-[13px] text-muted">Text Size</p>
          <Segment
            value={font}
            onChange={setFont}
            options={[
              { value: "md", label: "Normal" },
              { value: "lg", label: "Large" },
            ]}
          />
          <p className="mt-4 px-1 pb-1 text-[13px] text-muted">Density</p>
          <Segment
            value={density}
            onChange={setDensity}
            options={[
              { value: "comfortable", label: "Regular" },
              { value: "compact", label: "Compact" },
            ]}
          />
          <div className="mt-4 rounded-[10px] bg-surface shadow-[inset_0_0_0_0.5px_var(--color-line)]">
            <div className="flex w-full items-center justify-between gap-4 px-3 py-2.5 text-[15px]">
              <span>Push Alerts</span>
              <Switch
                on={alerts}
                label="Push alerts"
                onChange={() => {
                  setAlertNote("");
                  void (async () => {
                    try {
                      if (alerts) {
                        await disablePush();
                        setAlerts(false);
                      } else {
                        await enablePush();
                        setAlerts(true);
                      }
                    } catch (err) {
                      setAlertNote(err instanceof Error ? err.message : "Could not update alerts");
                    }
                  })();
                }}
              />
            </div>
          </div>
          {isIos() && !isStandalone() ? (
            <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted">
              On iPhone, add Mail to the Home Screen, open it, then turn alerts on.
            </p>
          ) : null}
          {alertNote ? <p className="mt-2 px-1 text-[12px] text-danger">{alertNote}</p> : null}
          <button
            type="button"
            className="mt-3 flex w-full items-center justify-center rounded-[10px] bg-[var(--fill)] px-3 py-2.5 text-[17px] text-danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign Out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className={`segmented ${options.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={active ? "active" : "text-muted"}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
