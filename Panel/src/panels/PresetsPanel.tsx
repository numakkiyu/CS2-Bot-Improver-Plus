import Section from "../components/Section";
import Segmented from "../components/Segmented";
import SubPage from "../components/SubPage";
import { useStore } from "../state/store";
import { useT } from "../i18n";
import type { AimValue, NadesValue } from "../lib/api";
import type { Status } from "../components/StatusDot";
import "./PresetsPanel.css";

const AIM: { value: AimValue; label: string }[] = [
  { value: "head", label: "Head" },
  { value: "mixed", label: "Mixed" },
  { value: "body", label: "Body" },
];
const NADES: { value: NadesValue; label: string }[] = [
  { value: "max", label: "Max" },
  { value: "more", label: "More" },
  { value: "normal", label: "Normal" },
  { value: "off", label: "Off" },
];

export default function PresetsPanel({ onBack }: { onBack?: () => void }) {
  const { presets, config, csgoPath, applyAim, applyNades, aimPending, nadesPending } =
    useStore();
  const t = useT();

  const cfgPresent = presets?.cfg_present ?? false;
  const running = presets?.cs2_running ?? false;
  const disabled = !csgoPath || !cfgPresent;

  // aimPending / nadesPending live in the global store, so each section's
  // pending-restart flag survives leaving and returning to this panel. A section
  // turns yellow only when *that* setting was changed while CS2 is running, so
  // the Aim and Nades lights stay independent.

  // Per-section light: green when writable, yellow only if this section has a
  // change pending a restart, off/red when no path/cfg.
  const statusFor = (pending: boolean): Status =>
    !csgoPath ? "off" : !cfgPresent ? "red" : running && pending ? "yellow" : "green";
  const toneFor = (pending: boolean): "green" | "yellow" =>
    running && pending ? "yellow" : "green";

  const aim: AimValue = presets?.aim ?? ((config?.aim as AimValue | null) ?? "mixed");
  const nades: NadesValue =
    presets?.nades ?? ((config?.nades as NadesValue | null) ?? "normal");

  return (
    <SubPage title={t("pre.title")} onBack={onBack}>
      <div className="presets__controls">
        <Section title={t("pre.aim")} status={statusFor(aimPending)}>
          <Segmented
            ariaLabel="Aim"
            value={aim}
            onChange={(v) => applyAim(v)}
            disabled={disabled}
            options={AIM.map((o) => ({
              ...o,
              tone: o.value === aim ? toneFor(aimPending) : undefined,
            }))}
          />
        </Section>

        <Section title={t("pre.nades")} status={statusFor(nadesPending)}>
          <Segmented
            ariaLabel="Nades"
            value={nades}
            onChange={(v) => applyNades(v)}
            disabled={disabled}
            options={NADES.map((o) => ({
              ...o,
              tone: o.value === nades ? toneFor(nadesPending) : undefined,
            }))}
          />
        </Section>
      </div>
    </SubPage>
  );
}
