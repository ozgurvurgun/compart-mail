export function Switch({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={`ios-switch ${on ? "is-on" : ""}`}
    >
      <span className="ios-switch-knob" />
    </button>
  );
}
