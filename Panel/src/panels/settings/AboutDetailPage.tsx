import { ExternalLink, FileKey2 } from "lucide-react";
import { useStore } from "../../state/store";
import { removeTerminalFullStop, useT, type I18nKey } from "../../i18n";
import { THIRD_PARTY_GROUPS } from "../../data/devs";
import { openExternalUrl } from "../../lib/platform";
import type { AboutTarget } from "./AboutPage";

const LEGAL_SECTIONS: Record<Exclude<AboutTarget, "aboutThirdParty">, { title: I18nKey; body: I18nKey }[]> = {
  aboutAgreement: [
    { title: "set.agreementScope", body: "set.userAgreementP1" },
    { title: "set.agreementOperations", body: "set.userAgreementP2" },
    { title: "set.agreementIndependence", body: "set.userAgreementP3" },
    { title: "set.agreementLicense", body: "set.userAgreementP4" },
    { title: "set.agreementChanges", body: "set.userAgreementP5" },
  ],
  aboutPrivacy: [
    { title: "set.privacyLocal", body: "set.privacyPolicyP1" },
    { title: "set.privacyNetwork", body: "set.privacyPolicyP2" },
    { title: "set.privacyDiagnostics", body: "set.privacyPolicyP3" },
    { title: "set.privacyRetention", body: "set.privacyPolicyP4" },
    { title: "set.privacyThirdParty", body: "set.privacyPolicyP5" },
  ],
};

export default function AboutDetailPage({ kind }: { kind: AboutTarget }) {
  const { config, reportError } = useStore();
  const t = useT();
  const chinese = config?.language === "schinese" || config?.language === "tchinese";

  const openExternal = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      reportError(error);
    }
  };

  if (kind !== "aboutThirdParty") {
    const agreement = kind === "aboutAgreement";
    return (
      <article className="legal-page">
        <header>
          <span>{agreement ? t("set.userAgreement") : t("set.privacyPolicy")}</span>
          <p>{agreement ? t("set.userAgreementLead") : t("set.privacyPolicyLead")}</p>
          <code>{t("set.effectiveDate")}</code>
        </header>
        <div className="legal-page__sections">
          {LEGAL_SECTIONS[kind].map((section, index) => (
            <section key={section.title}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <div>
                <h3>{t(section.title)}</h3>
                <p>{t(section.body)}</p>
              </div>
            </section>
          ))}
        </div>
      </article>
    );
  }

  return (
    <div className="third-party-page">
      <section className="license-notice">
        <span><FileKey2 size={21} /></span>
        <div>
          <strong>{t("set.localArenaLicense")}</strong>
          <p>{t("set.localArenaLicenseDesc")}</p>
        </div>
        <code>AGPL-3.0</code>
      </section>

      <p className="third-party-intro">{t("set.thirdPartyIntro")}</p>

      {THIRD_PARTY_GROUPS.map((group) => (
        <section className="third-party-group" key={group.id}>
          <header>
            <h3>{chinese ? group.titleZh : group.title}</h3>
            <span>{group.projects.length}</span>
          </header>
          <div className="third-party-list">
            {group.projects.map((project) => (
              <div className="third-party-row" key={project.name}>
                <div className="third-party-row__main">
                  <span>
                    <strong>{project.name}</strong>
                    {project.version && <code>{project.version}</code>}
                  </span>
                  <p>{removeTerminalFullStop(chinese ? project.descriptionZh : project.description)}</p>
                </div>
                <span className="third-party-row__license">{project.license}</span>
                <button onClick={() => openExternal(project.url)} aria-label={`${t("set.openProject")}: ${project.name}`}>
                  <ExternalLink size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      <aside className="third-party-footnote">{t("set.licenseFootnote")}</aside>
    </div>
  );
}
