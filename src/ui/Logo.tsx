export function Logo({ className = "" }: { className?: string }) {
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
        COMP<span>ART</span>
      </span>
      <span className="brand-logo-sub">mail</span>
    </span>
  );
}
