declare global {
  interface Window {
    __MAIL_APP_NAME__?: string;
  }
}

function resolveName(name?: string) {
  return (name || (typeof window !== "undefined" ? window.__MAIL_APP_NAME__ : "") || "Mail").trim();
}

/** Boot splash reads branding injected by the worker into index.html. */
export function bootAppName(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const fromWindow = window.__MAIL_APP_NAME__?.trim();
  if (fromWindow && fromWindow !== "__APP_NAME__") return fromWindow;
  const fromMeta = document.querySelector('meta[name="application-name"]')?.getAttribute("content")?.trim();
  if (fromMeta && fromMeta !== "__APP_NAME__") return fromMeta;
  const title = document.title?.trim();
  if (title && title !== "__APP_NAME__") return title;
  return undefined;
}

export function Logo({ name, className = "" }: { name?: string; className?: string }) {
  const resolved = resolveName(name);
  const isCompart = /^compart(\s+mail)?$/i.test(resolved);
  const brand = resolved.replace(/\s*mail$/i, "").trim() || resolved;

  return (
    <span
      className={`brand-logo ${className}`}
      translate="no"
      lang="en"
      draggable={false}
      aria-hidden="true"
      style={{
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <span className="brand-logo-word">
        {isCompart ? (
          <>
            COMP<span>ART</span>
          </>
        ) : (
          brand.toUpperCase()
        )}
      </span>
      <span className="brand-logo-sub">mail</span>
    </span>
  );
}
