import { BookOpenText, Download, LifeBuoy, PlayCircle } from "lucide-react";
import { useT, type I18nKey } from "../i18n";
import overviewImage from "../assets/guide/01-overview.png";
import weaponPresetsImage from "../assets/guide/02-weapon-presets.png";
import botPresetsImage from "../assets/guide/03-bot-presets.png";
import installationImage from "../assets/guide/04-installation-recovery.jpg";
import onlineUpdateImage from "../assets/guide/05-online-update.png";
import botItemsImage from "../assets/guide/06-bot-items.png";
import commandsImage from "../assets/guide/07-commands.png";
import firstLanguageImage from "../assets/guide/08-first-language.jpg";
import firstDirectoryImage from "../assets/guide/09-first-directory.jpg";
import firstPreviewImage from "../assets/guide/10-first-preview.jpg";
import firstCompleteImage from "../assets/guide/11-first-complete.jpg";
import mixedEnvironmentImage from "../assets/guide/12-first-mixed.jpg";
import healthRepairImage from "../assets/guide/13-health-repair.jpg";
import processLockImage from "../assets/guide/14-process-lock.jpg";
import directoryMissingImage from "../assets/guide/15-directory-missing.jpg";
import updateErrorImage from "../assets/guide/16-update-error.jpg";
import "./PlusGuideArticle.css";

type GuideStep = {
  image: string;
  title: I18nKey;
  body: I18nKey;
  points: I18nKey[];
};

const INSTALL_STEPS: GuideStep[] = [
  { image: firstLanguageImage, title: "guide.install1.title", body: "guide.install1.body", points: ["guide.install1.point1", "guide.install1.point2"] },
  { image: firstDirectoryImage, title: "guide.install2.title", body: "guide.install2.body", points: ["guide.install2.point1", "guide.install2.point2", "guide.install2.point3"] },
  { image: firstPreviewImage, title: "guide.install3.title", body: "guide.install3.body", points: ["guide.install3.point1", "guide.install3.point2", "guide.install3.point3"] },
  { image: firstCompleteImage, title: "guide.install4.title", body: "guide.install4.body", points: ["guide.install4.point1", "guide.install4.point2"] },
];

const USAGE_STEPS: GuideStep[] = [
  { image: overviewImage, title: "guide.step2.title", body: "guide.step2.body", points: ["guide.step2.point1", "guide.step2.point2", "guide.step2.point3"] },
  { image: botPresetsImage, title: "guide.step3.title", body: "guide.step3.body", points: ["guide.step3.point1", "guide.step3.point2", "guide.step3.point3", "guide.step3.point4"] },
  { image: botItemsImage, title: "guide.step4.title", body: "guide.step4.body", points: ["guide.step4.point1", "guide.step4.point2", "guide.step4.point3", "guide.step4.point4"] },
  { image: weaponPresetsImage, title: "guide.step5.title", body: "guide.step5.body", points: ["guide.step5.point1", "guide.step5.point2", "guide.step5.point3", "guide.step5.point4"] },
  { image: commandsImage, title: "guide.step6.title", body: "guide.step6.body", points: ["guide.step6.point1", "guide.step6.point2", "guide.step6.point3"] },
  { image: onlineUpdateImage, title: "guide.step7.title", body: "guide.step7.body", points: ["guide.step7.point1", "guide.step7.point2", "guide.step7.point3", "guide.step7.point4"] },
];

const TROUBLESHOOTING_STEPS: GuideStep[] = [
  { image: directoryMissingImage, title: "guide.issue1.title", body: "guide.issue1.body", points: ["guide.issue1.point1", "guide.issue1.point2", "guide.issue1.point3"] },
  { image: mixedEnvironmentImage, title: "guide.issue2.title", body: "guide.issue2.body", points: ["guide.issue2.point1", "guide.issue2.point2", "guide.issue2.point3"] },
  { image: healthRepairImage, title: "guide.issue3.title", body: "guide.issue3.body", points: ["guide.issue3.point1", "guide.issue3.point2", "guide.issue3.point3"] },
  { image: processLockImage, title: "guide.issue4.title", body: "guide.issue4.body", points: ["guide.issue4.point1", "guide.issue4.point2", "guide.issue4.point3"] },
  { image: updateErrorImage, title: "guide.issue5.title", body: "guide.issue5.body", points: ["guide.issue5.point1", "guide.issue5.point2", "guide.issue5.point3"] },
  { image: installationImage, title: "guide.issue6.title", body: "guide.issue6.body", points: ["guide.issue6.point1", "guide.issue6.point2", "guide.issue6.point3", "guide.issue6.point4"] },
];

function Points({ items }: { items: I18nKey[] }) {
  const t = useT();
  return <ul>{items.map((item) => <li key={item}>{t(item)}</li>)}</ul>;
}

export default function PlusGuideArticle() {
  const t = useT();

  return (
    <article className="plus-guide">
      <header className="plus-guide__head">
        <span className="plus-guide__icon" aria-hidden="true"><BookOpenText size={22} /></span>
        <span>
          <small>{t("guide.eyebrow")}</small>
          <h2>{t("guide.title")}</h2>
          <p>{t("guide.intro")}</p>
        </span>
      </header>

      <section className="plus-guide__chapter">
        <header className="plus-guide__chapter-head">
          <Download size={18} aria-hidden="true" />
          <span><small>01</small><h3>{t("guide.install.title")}</h3><p>{t("guide.install.body")}</p></span>
        </header>
        <div className="plus-guide__install-grid">
          {INSTALL_STEPS.map((step, index) => (
            <section className="plus-guide__install-step" key={step.title}>
              <figure><img src={step.image} alt={t(step.title)} loading={index < 2 ? "eager" : "lazy"} /></figure>
              <div className="plus-guide__install-copy">
                <span className="plus-guide__number">{String(index + 1).padStart(2, "0")}</span>
                <h4>{t(step.title)}</h4><p>{t(step.body)}</p><Points items={step.points} />
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="plus-guide__chapter">
        <header className="plus-guide__chapter-head">
          <PlayCircle size={18} aria-hidden="true" />
          <span><small>02</small><h3>{t("guide.usage.title")}</h3><p>{t("guide.usage.body")}</p></span>
        </header>
        <div className="plus-guide__steps">
          {USAGE_STEPS.map((step, index) => (
            <section className="plus-guide__step" key={step.title}>
              <div className="plus-guide__copy">
                <span className="plus-guide__number">{String(index + 1).padStart(2, "0")}</span>
                <h4>{t(step.title)}</h4><p>{t(step.body)}</p><Points items={step.points} />
              </div>
              <figure><img src={step.image} alt={t(step.title)} loading="lazy" /></figure>
            </section>
          ))}
        </div>
      </section>

      <section className="plus-guide__chapter">
        <header className="plus-guide__chapter-head">
          <LifeBuoy size={18} aria-hidden="true" />
          <span><small>03</small><h3>{t("guide.trouble.title")}</h3><p>{t("guide.trouble.body")}</p></span>
        </header>
        <div className="plus-guide__trouble-grid">
          {TROUBLESHOOTING_STEPS.map((step, index) => (
            <section className="plus-guide__trouble" key={step.title}>
              <figure><img src={step.image} alt={t(step.title)} loading="lazy" /></figure>
              <div>
                <span className="plus-guide__number">{String(index + 1).padStart(2, "0")}</span>
                <h4>{t(step.title)}</h4><p>{t(step.body)}</p><Points items={step.points} />
              </div>
            </section>
          ))}
        </div>
      </section>
    </article>
  );
}
