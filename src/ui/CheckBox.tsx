export function CheckBox({
  checked,
  mixed = false,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  const on = checked || mixed;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(mixed ? true : !checked);
      }}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${disabled ? "opacity-35" : ""}`}
    >
      <span
        className={`grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] ${
          on ? "border-accent bg-accent text-white" : "border-[#8e8e93] bg-surface"
        }`}
      >
        {mixed ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
            <path d="M2.5 6h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : checked ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
            <path
              d="M2.4 6.2 4.8 8.6 9.6 3.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
    </button>
  );
}
