import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, FolderOpen, LifeBuoy, RotateCcw, Stethoscope } from "lucide-react";
import Modal from "./Modal";
import { AlertIcon, CopyIcon } from "./icons";
import { useToast } from "./Toast";
import { useT, type I18nKey } from "../i18n";
import type { AppError } from "../lib/api";
import type { DiagnosticReport } from "../lib/api";
import { openExternalPath, writeClipboard } from "../lib/platform";
import "./ErrorModal.css";

const KNOWN_CATS = ["path", "permission", "steam", "parse", "io", "config", "internal",
  "filesystem", "validation", "directory", "process", "payload", "installation", "launch", "update"];

// Error categories that have a matching troubleshooting entry in the guide.
const GUIDE_ANCHORS: Record<string, string> = {
  directory: "guide-issue-1",
  path: "guide-issue-1",
  steam: "guide-issue-1",
  installation: "guide-issue-3",
  payload: "guide-issue-3",
  validation: "guide-issue-3",
  filesystem: "guide-issue-3",
  io: "guide-issue-3",
  permission: "guide-issue-3",
  process: "guide-issue-4",
  launch: "guide-issue-4",
  update: "guide-issue-5",
};

type Props = {
  error: AppError | null;
  onClose: () => void;
  /** Localized message for the error code (defaults to raw detail). */
  message?: string;
  onExport?: () => Promise<DiagnosticReport | null>;
  /** Jump to a troubleshooting anchor inside the guide view. */
  onOpenGuide?: (anchor: string) => void;
};

export default function ErrorModal({ error, onClose, message, onExport, onOpenGuide }: Props) {
  const toast = useToast();
  const t = useT();
  const [exporting, setExporting] = useState(false);
  const [diagnosticPath, setDiagnosticPath] = useState<string | null>(null);
  const [exportFailed, setExportFailed] = useState(false);

  // Reset the export state whenever a new error is shown.
  useEffect(() => {
    setExporting(false);
    setDiagnosticPath(null);
    setExportFailed(false);
  }, [error?.code, error?.detail]);

  if (!error) return null;

  const localized = KNOWN_CATS.includes(error.category)
    ? t(`errcat.${error.category}` as I18nKey)
    : error.detail;
  const primaryMessage = message ?? localized;
  const showDetail = error.detail && error.detail !== primaryMessage;
  const guideAnchor = GUIDE_ANCHORS[error.category];

  const copy = async (text: string) => {
    try {
      await writeClipboard(text);
      toast.show(t("common.copied"), "green");
    } catch {
      toast.show(t("common.copyFailed"), "red");
    }
  };

  const exportReport = async () => {
    if (!onExport || exporting) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const report = await onExport();
      if (report) setDiagnosticPath(report.path);
      else setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  const openDiagnosticFolder = async () => {
    if (!diagnosticPath) return;
    try {
      await openExternalPath(diagnosticPath.replace(/[\\/][^\\/]+$/, ""));
    } catch {
      toast.show(t("common.copyFailed"), "red");
    }
  };

  return (
    <Modal
      open={!!error}
      onClose={onClose}
      scrimClassName="modal__scrim--error"
      width={400}
      title={
        <span className="errm__title">
          <span className="errm__title-icon" aria-hidden="true"><AlertIcon size={16} /></span>
          {t("err.title")}
        </span>
      }
      footer={
        <>
          {guideAnchor && onOpenGuide && (
            <button className="btn-secondary errm__export" onClick={() => { onOpenGuide(guideAnchor); onClose(); }}>
              <LifeBuoy size={16} />
              {t("err.viewSolution")}
            </button>
          )}
          {onExport && !diagnosticPath && (
            <button className="btn-secondary errm__export" disabled={exporting} onClick={exportReport}>
              {exporting ? <RotateCcw size={16} className="errm__spin" /> : <Stethoscope size={16} />}
              {exporting ? t("install.working") : t("install.diagnostics")}
            </button>
          )}
          <button className="btn-primary" onClick={onClose}>{t("common.ok")}</button>
        </>
      }
    >
      <div className="errm__badges">
        <button className="errm__code" onClick={() => copy(`${error.code} — ${error.detail}`)} title={t("err.copyCode")}>
          <span className="errm__code-text">{error.code}</span>
          <CopyIcon size={13} />
        </button>
        <span className="errm__category">{error.category}</span>
      </div>

      <p className="errm__msg">{primaryMessage}</p>

      {showDetail && (
        <details className="errm__details">
          <summary>
            {t("err.details")}
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <p className="errm__detail">{error.detail}</p>
        </details>
      )}

      {exportFailed && (
        <p className="errm__export-failed" role="alert">
          <AlertTriangle size={14} aria-hidden="true" />
          {t("err.exportFailed")}
        </p>
      )}

      {diagnosticPath && (
        <div className="errm__exported">
          <span className="errm__exported-head">
            <CheckCircle2 size={16} aria-hidden="true" />
            <strong>{t("err.exportReady")}</strong>
          </span>
          <code className="errm__exported-path" title={diagnosticPath}>{diagnosticPath}</code>
          <span className="errm__exported-actions">
            <button onClick={openDiagnosticFolder}>
              <FolderOpen size={14} /> {t("install.openDiagnosticFolder")}
            </button>
            <button onClick={() => copy(diagnosticPath)}>
              <CopyIcon size={14} /> {t("err.copyPath")}
            </button>
          </span>
        </div>
      )}
    </Modal>
  );
}
