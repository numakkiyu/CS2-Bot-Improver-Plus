import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import Modal from "./Modal";
import { AlertIcon, CopyIcon } from "./icons";
import { useToast } from "./Toast";
import { useT, type I18nKey } from "../i18n";
import type { AppError } from "../lib/api";
import "./ErrorModal.css";

const KNOWN_CATS = ["path", "permission", "steam", "parse", "io", "config", "internal", "filesystem", "validation"];

type Props = {
  error: AppError | null;
  onClose: () => void;
  /** Localized message for the error code (defaults to raw detail). */
  message?: string;
};

export default function ErrorModal({ error, onClose, message }: Props) {
  const toast = useToast();
  const t = useT();
  if (!error) return null;

  const localized = KNOWN_CATS.includes(error.category)
    ? t(`errcat.${error.category}` as I18nKey)
    : error.detail;
  const primaryMessage = message ?? localized;
  const showDetail = error.detail && error.detail !== primaryMessage;

  const copy = async () => {
    try {
      await writeText(`${error.code} — ${error.detail}`);
      toast.show(t("common.copied"), "green");
    } catch {
      toast.show(t("common.copyFailed"), "red");
    }
  };

  return (
    <Modal
      open={!!error}
      onClose={onClose}
      title={
        <span className="errm__title">
          <AlertIcon size={18} /> {t("err.title")}
        </span>
      }
      footer={
        <button className="btn-primary" onClick={onClose}>
          {t("common.ok")}
        </button>
      }
    >
      <p className="errm__msg">{primaryMessage}</p>
      {showDetail && <p className="errm__detail">{error.detail}</p>}
      <button className="errm__code" onClick={copy} title={t("err.copyCode")}>
        <span className="errm__code-text">{error.code}</span>
        <CopyIcon size={14} />
      </button>
    </Modal>
  );
}
