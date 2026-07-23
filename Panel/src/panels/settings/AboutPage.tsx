import { Boxes, ChevronRight, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { useT } from "../../i18n";
import { APP_DISPLAY_VERSION } from "../../lib/version";
import bhcnSymbol from "../../assets/bhcn-symbol.svg";
import appLogo from "../../assets/app-logo.png";

export type AboutTarget = "aboutThirdParty" | "aboutAgreement" | "aboutPrivacy";

type Props = {
  onOpen: (target: AboutTarget) => void;
  onOpenUpdates: () => void;
};

export default function AboutPage({ onOpen, onOpenUpdates }: Props) {
  const t = useT();

  const links = [
    { target: "aboutThirdParty" as const, icon: Boxes, title: "set.thirdParty", desc: "set.thirdPartyDesc" },
    { target: "aboutAgreement" as const, icon: ScrollText, title: "set.userAgreement", desc: "set.userAgreementDesc" },
    { target: "aboutPrivacy" as const, icon: ShieldCheck, title: "set.privacyPolicy", desc: "set.privacyPolicyDesc" },
  ] as const;

  return (
    <div className="about-page">
      <section className="about-identity">
        <img className="about-identity__logo" src={appLogo} alt="Local Arena" />
        <h2>Local Arena</h2>
        <code>v{APP_DISPLAY_VERSION}</code>
        <p>{t("set.aboutTagline")}</p>
        <button className="about-update" onClick={onOpenUpdates}>
          <RefreshCw size={16} />
          <span>{t("set.checkUpdates")}</span>
        </button>
      </section>

      <section className="about-studio">
        <img src={bhcnSymbol} alt="" aria-hidden="true" />
        <span>
          <small>{t("set.developedBy")}</small>
          <strong>BHCN STUDIO</strong>
          <em>Copyright © 2026 BHCN STUDIO. {t("set.allRightsReserved")}</em>
        </span>
      </section>

      <nav className="about-nav" aria-label={t("set.aboutLinks")}>
        {links.map(({ target, icon: Icon, title, desc }) => (
          <button key={target} onClick={() => onOpen(target)}>
            <span className="about-nav__icon"><Icon size={18} /></span>
            <span className="about-nav__body">
              <strong>{t(title)}</strong>
              <small>{t(desc)}</small>
            </span>
            <ChevronRight size={17} className="about-nav__chevron" />
          </button>
        ))}
      </nav>
    </div>
  );
}
