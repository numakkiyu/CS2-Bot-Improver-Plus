import "./StatusDot.css";

export type Status = "green" | "yellow" | "red" | "off" | "unknown";

type Props = {
  status: Status;
  size?: number;
  pulse?: boolean;
  onClick?: () => void;
  title?: string;
};

export default function StatusDot({ status, size = 8, pulse, onClick, title }: Props) {
  const interactive = !!onClick;
  return (
    <span
      className={`dot dot--${status} ${pulse ? "dot--pulse" : ""} ${
        interactive ? "dot--btn" : ""
      }`}
      style={{ width: size, height: size }}
      onClick={onClick}
      title={title}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick?.();
            }
          : undefined
      }
    />
  );
}
