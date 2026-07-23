import "./Segmented.css";

export type SegOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: SegOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  /** "row" lays options horizontally, "stack" vertically (top→bottom). */
  layout?: "row" | "stack";
  disabled?: boolean;
  ariaLabel?: string;
};

const GAP = 3;
const PAD = 3;

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  layout = "row",
  disabled = false,
  ariaLabel,
}: Props<T>) {
  const n = options.length;
  const activeIndex = options.findIndex((o) => o.value === value);

  // A single sliding indicator that animates to the active cell.
  const size = `calc((100% - ${2 * PAD}px - ${(n - 1) * GAP}px) / ${n})`;
  const offset = `calc(${Math.max(activeIndex, 0)} * (100% + ${GAP}px))`;
  const indStyle =
    layout === "row"
      ? { width: size, transform: `translateX(${offset})` }
      : { height: size, transform: `translateY(${offset})` };

  return (
    <div
      className={`seg seg--${layout} ${disabled ? "seg--disabled" : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      <span
        className={`seg__ind ${activeIndex < 0 ? "is-hidden" : ""}`}
        style={indStyle}
        aria-hidden
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={`seg__item ${active ? "is-active" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
