import { useEffect } from "react";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  altLabel,
  altDanger = false,
  onConfirm,
  onAlt,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  altLabel?: string;
  altDanger?: boolean;
  onConfirm: () => void;
  onAlt?: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const stacked = Boolean(altLabel && onAlt);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-6 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="ios-alert">
        <h2 id="confirm-title" className="ios-alert-title">
          {title}
        </h2>
        <p className="ios-alert-body">{body}</p>
        <div className={`ios-alert-actions ${stacked ? "stacked" : ""}`}>
          {stacked ? (
            <>
              <button type="button" className={altDanger ? "destructive emph" : ""} onClick={onAlt}>
                {altLabel}
              </button>
              <button type="button" className={danger ? "destructive emph" : "emph"} onClick={onConfirm}>
                {confirmLabel}
              </button>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className={danger ? "destructive emph" : "emph"} onClick={onConfirm}>
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
