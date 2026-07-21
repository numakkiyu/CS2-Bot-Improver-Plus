import { useT, type I18nKey } from "../i18n";
import "./WearGauge.css";

// Official CS wear-band thresholds.
const TIERS: { limit: number; key: I18nKey }[] = [
  { limit: 0.07, key: "wear.fn" },
  { limit: 0.15, key: "wear.mw" },
  { limit: 0.38, key: "wear.ft" },
  { limit: 0.45, key: "wear.ww" },
  { limit: 1.01, key: "wear.bs" },
];

export default function WearGauge({ min, max, value }: { min: number; max: number; value: number }) {
  const t = useT();
  const clamped = Math.min(1, Math.max(0, value));
  const tier = TIERS.find((band) => clamped < band.limit) ?? TIERS[TIERS.length - 1];
  return (
    <div className="wear-gauge">
      <div className="wear-gauge__track" role="img" aria-label={t(tier.key)}>
        <span
          className="wear-gauge__range"
          style={{ left: `${Math.max(0, min) * 100}%`, width: `${Math.max(0.01, max - min) * 100}%` }}
        />
        <i className="wear-gauge__dot" style={{ left: `${clamped * 100}%` }} />
      </div>
      <div className="wear-gauge__meta">
        <span>{t(tier.key)}</span>
        <small>{min.toFixed(2)} – {max.toFixed(2)}</small>
      </div>
    </div>
  );
}
