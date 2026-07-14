import { openUrl } from "@tauri-apps/plugin-opener";
import { Code2, ExternalLink, GitFork, ShieldCheck, Users } from "lucide-react";
import { useStore } from "../../state/store";
import { useT, type I18nKey } from "../../i18n";
import { CONTRIBUTORS, PROJECTS, type Contributor } from "../../data/devs";

const ROLE_KEYS: Record<Contributor["role"], I18nKey> = {
  plusMaintainer: "set.role.plusMaintainer",
  upstreamAuthor: "set.role.upstreamAuthor",
  contributor: "set.role.contributor",
};

export default function DevsPage() {
  const { reportError } = useStore();
  const t = useT();

  const openExternal = async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="devs-page">
      <section className="devs-page__section">
        <div className="devs-page__heading">
          <Code2 size={17} />
          <span>
            <strong>{t("set.repositories")}</strong>
            <small>{t("set.repositoriesDesc")}</small>
          </span>
        </div>
        <div className="repo-grid">
          {PROJECTS.map((project) => (
            <button
              key={project.id}
              className={`repo-card repo-card--${project.id}`}
              onClick={() => openExternal(project.url)}
            >
              <span className="repo-card__icon">
                {project.id === "plus" ? <ShieldCheck size={21} /> : <GitFork size={21} />}
              </span>
              <span className="repo-card__body">
                <span className="repo-card__eyebrow">
                  {project.id === "plus" ? t("set.plusRepository") : t("set.upstreamRepository")}
                </span>
                <strong>{project.name}</strong>
                <small>
                  {project.id === "plus" ? t("set.plusRepositoryDesc") : t("set.upstreamRepositoryDesc")}
                </small>
                <code>{project.url}</code>
              </span>
              <ExternalLink className="repo-card__external" size={17} />
            </button>
          ))}
        </div>
      </section>

      <section className="devs-page__section">
        <div className="devs-page__heading">
          <Users size={17} />
          <span>
            <strong>{t("set.contributors")}</strong>
            <small>{t("set.contributorsDesc")}</small>
          </span>
        </div>
        <div className="contributor-grid">
          {CONTRIBUTORS.map((contributor) => (
            <button
              className="contributor-card"
              key={contributor.login}
              onClick={() => openExternal(contributor.profileUrl)}
            >
              <img src={contributor.avatar} alt="" />
              <span className="contributor-card__body">
                <strong>{contributor.login}</strong>
                <small>{t(ROLE_KEYS[contributor.role])}</small>
              </span>
              {contributor.contributions !== undefined && (
                <span className="contributor-card__count">
                  {t("set.contributionCount", { n: contributor.contributions })}
                </span>
              )}
              <ExternalLink size={14} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
