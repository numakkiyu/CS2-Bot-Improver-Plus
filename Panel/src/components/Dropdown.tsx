import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "./icons";
import "./Dropdown.css";

export type DropdownOption = { value: string; label: ReactNode };

type Props = {
  value: string | null;
  options: DropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Render the menu in normal flow under the button instead of a floating layer. */
  inline?: boolean;
  onChange: (value: string) => void;
};

export default function Dropdown({
  value,
  options,
  placeholder = "Select…",
  disabled,
  ariaLabel,
  inline,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`dropdown${inline ? " dropdown--inline" : ""}`} ref={ref}>
      <button
        type="button"
        className={`dropdown__btn ${selected ? "has-value" : ""}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="dropdown__value">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className={`dropdown__chev ${open ? "is-open" : ""}`} />
      </button>
      {open && (
        <ul className="dropdown__menu glass glass-strong" role="listbox">
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`dropdown__item ${o.value === value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
