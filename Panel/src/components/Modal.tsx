import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import "./Modal.css";

type Props = {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  scrimClassName?: string;
};

export default function Modal({ open, title, onClose, children, footer, width = 360, scrimClassName }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={`modal__scrim${scrimClassName ? ` ${scrimClassName}` : ""}`} onMouseDown={onClose}>
      <div
        className="modal glass glass-strong modal--solid"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal__head">
          <div className="modal__title">{title}</div>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
