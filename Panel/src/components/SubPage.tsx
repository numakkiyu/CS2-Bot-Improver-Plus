import type { ReactNode } from "react";
import { BackIcon } from "./icons";
import StatusDot, { type Status } from "./StatusDot";
import "./SubPage.css";

type Props = {
  title: string;
  onBack?: () => void;
  status?: Status;
  right?: ReactNode;
  children: ReactNode;
};

// Full-screen sub-view with an icon-only back button, matching Settings.
export default function SubPage({ title, onBack, status, right, children }: Props) {
  return (
    <div className="subpage">
      <div className="subpage__head">
        {onBack && (
          <button className="subpage__back" onClick={onBack} aria-label="Back">
            <BackIcon size={20} />
          </button>
        )}
        <span className="subpage__title">{title}</span>
        <div className="subpage__actions">
          {status && <StatusDot status={status} />}
          {right}
        </div>
      </div>
      <div className="subpage__body">{children}</div>
    </div>
  );
}
