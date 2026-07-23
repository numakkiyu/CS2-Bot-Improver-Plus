import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpenText,
  Download,
  ExternalLink,
  LifeBuoy,
  PlayCircle,
  type LucideIcon,
} from "lucide-react";
import Modal from "../components/Modal";
import { useStore } from "../state/store";
import { useT, type I18nKey } from "../i18n";
import { openExternalUrl } from "../lib/platform";
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
import "./GuideView.css";

const TUTORIAL_URL = "https://www.xiaoheihe.cn/app/bbs/link/ae2271904052?h_camp=link&redirect_data=%7B%22link%22%3A%7B%22description%22%3A%22%5Cu5c0f%5Cu65f6%5Cu5019%5Cuff0c%5Cu6211%5Cu6700%5Cu559c%5Cu6b22%5Cu73a9%5Cu300a%5Cu53cd%5Cu6050%5Cu7cbe%5Cu82f1%5Cuff1a%5Cu96f6%5Cu70b9%5Cu884c%5Cu52a8%5Cu300b%5Cu4e2d%5Cu7684%5Cu4efb%5Cu52a1%5Cu6a21%5Cu5f0f%5Cu3002%5Cu611f%5Cu53d7%5Cu7ec4%5Cu5efa%5Cu56e2%5Cu961f%5Cuff0c%5Cu4e0e%5Cu4eba%5Cu673a%5Cu535a%5Cu5f08%5Cu7684%5Cu5feb%5Cu4e50%5Cu3002CS2%5Cu66f4%5Cu65b0%5Cu4e4b%5Cu540e%5Cuff0c%5Cu4eba%5Cu673a%5Cu53d8%5Cu5f97%5Cu611a%5Cu8822%5Cu81f3%5Cu6781%5Cuff0c%5Cu4ed6%5Cu4eec%5Cu53ea%5Cu4f1a%5Cu7784%5Cu51c6%5Cu809a%5Cu5b50%5Cu4e2d%5Cu592e%5Cuff0c%5Cu53ef%5Cu80fd%5Cu4f1a%5Cu5361%5Cu5728%5Cu5730%5Cu56fe%5Cu7684%5Cu4efb%5Cu4f55%5Cu4e00%5Cu4e2a%5Cu5730%5Cu65b9%5Cuff0c%5Cu6218%5Cu672f%5Cu4e0a%5Cu66f4%5Cu662f%5Cu6beb%5Cu65e0%5Cu7b56%5Cu7565%5Cu53ef%5Cu8a00%5Cu3002%5Cu4e8e%5Cu662f%5Cuff0c%5Cu6211%5Cu5f00%5Cu59cb%5Cu5f00%5Cu53d1%5Cu8fd9%5Cu4e2a%5Cu63d2%5Cu4ef6%5Cuff0c%5Cu4ee5%5Cu6539%5Cu8fdbCS2%5Cu4e2d%5Cu7684%5Cu4eba%5Cu673a%5Cuff0c%5Cu63d0%5Cu4f9b%5Cu7ed9%5Cu50cf%5Cu6211%5Cu8fd9%22%2C%22title%22%3A%22cs2%5Cu4eba%5Cu673abot%5Cu52a0%5Cu5f3a%5Cuff01%5Cu5b89%5Cu88c5%5Cu4e0e%5Cu4f7f%5Cu7528%5Cu6559%5Cu7a0b%5Cuff08%5Cu6301%5Cu7eed%5Cu66f4%5Cu65b0%5Cuff09%22%7D%7D&h_src=YXBwX3NoYXJl";

type Severity = "red" | "yellow" | "green";

type GuideStep = {
  id: string;
  image: string;
  title: I18nKey;
  body: I18nKey;
  points: I18nKey[];
  severity?: Severity;
};

type Chapter = {
  id: string;
  num: string;
  icon: LucideIcon;
  title: I18nKey;
  body: I18nKey;
};

const CHAPTERS: Chapter[] = [
  { id: "guide-ch-install", num: "01", icon: Download, title: "guide.install.title", body: "guide.install.body" },
  { id: "guide-ch-usage", num: "02", icon: PlayCircle, title: "guide.usage.title", body: "guide.usage.body" },
  { id: "guide-ch-trouble", num: "03", icon: LifeBuoy, title: "guide.trouble.title", body: "guide.trouble.body" },
];

const INSTALL_STEPS: GuideStep[] = [
  { id: "guide-install-1", image: firstLanguageImage, title: "guide.install1.title", body: "guide.install1.body", points: ["guide.install1.point1", "guide.install1.point2"] },
  { id: "guide-install-2", image: firstDirectoryImage, title: "guide.install2.title", body: "guide.install2.body", points: ["guide.install2.point1", "guide.install2.point2", "guide.install2.point3"] },
  { id: "guide-install-3", image: firstPreviewImage, title: "guide.install3.title", body: "guide.install3.body", points: ["guide.install3.point1", "guide.install3.point2", "guide.install3.point3"] },
  { id: "guide-install-4", image: firstCompleteImage, title: "guide.install4.title", body: "guide.install4.body", points: ["guide.install4.point1", "guide.install4.point2"] },
];

const USAGE_STEPS: GuideStep[] = [
  { id: "guide-usage-1", image: overviewImage, title: "guide.step2.title", body: "guide.step2.body", points: ["guide.step2.point1", "guide.step2.point2", "guide.step2.point3"] },
  { id: "guide-usage-2", image: botPresetsImage, title: "guide.step3.title", body: "guide.step3.body", points: ["guide.step3.point1", "guide.step3.point2", "guide.step3.point3"] },
  { id: "guide-usage-3", image: botItemsImage, title: "guide.step4.title", body: "guide.step4.body", points: ["guide.step4.point1", "guide.step4.point2", "guide.step4.point3", "guide.step4.point4"] },
  { id: "guide-usage-4", image: weaponPresetsImage, title: "guide.step5.title", body: "guide.step5.body", points: ["guide.step5.point1", "guide.step5.point2", "guide.step5.point3", "guide.step5.point4"] },
  { id: "guide-usage-5", image: commandsImage, title: "guide.step6.title", body: "guide.step6.body", points: ["guide.step6.point1", "guide.step6.point2", "guide.step6.point3"] },
  { id: "guide-usage-6", image: onlineUpdateImage, title: "guide.step7.title", body: "guide.step7.body", points: ["guide.step7.point1", "guide.step7.point2", "guide.step7.point3", "guide.step7.point4"] },
];

const TROUBLE_STEPS: GuideStep[] = [
  { id: "guide-issue-1", severity: "red", image: directoryMissingImage, title: "guide.issue1.title", body: "guide.issue1.body", points: ["guide.issue1.point1", "guide.issue1.point2", "guide.issue1.point3"] },
  { id: "guide-issue-2", severity: "red", image: mixedEnvironmentImage, title: "guide.issue2.title", body: "guide.issue2.body", points: ["guide.issue2.point1", "guide.issue2.point2", "guide.issue2.point3"] },
  { id: "guide-issue-3", severity: "yellow", image: healthRepairImage, title: "guide.issue3.title", body: "guide.issue3.body", points: ["guide.issue3.point1", "guide.issue3.point2", "guide.issue3.point3"] },
  { id: "guide-issue-4", severity: "yellow", image: processLockImage, title: "guide.issue4.title", body: "guide.issue4.body", points: ["guide.issue4.point1", "guide.issue4.point2", "guide.issue4.point3"] },
  { id: "guide-issue-5", severity: "yellow", image: updateErrorImage, title: "guide.issue5.title", body: "guide.issue5.body", points: ["guide.issue5.point1", "guide.issue5.point2", "guide.issue5.point3"] },
  { id: "guide-issue-6", severity: "green", image: installationImage, title: "guide.issue6.title", body: "guide.issue6.body", points: ["guide.issue6.point1", "guide.issue6.point2", "guide.issue6.point3", "guide.issue6.point4"] },
];

const num = (n: number) => String(n).padStart(2, "0");

function Points({ items }: { items: I18nKey[] }) {
  const t = useT();
  return <ul className="guide__points">{items.map((item) => <li key={item}>{t(item)}</li>)}</ul>;
}

function Shot({ image, caption, eager, onZoom }: { image: string; caption: string; eager?: boolean; onZoom: (src: string, caption: string) => void }) {
  const t = useT();
  return (
    <figure className="shot">
      <button type="button" className="shot__btn" onClick={() => onZoom(image, caption)} aria-label={t("guide.enlarge")} title={t("guide.enlarge")}>
        <span className="shot__chrome" aria-hidden="true"><i /><i /><i /></span>
        <img src={image} alt={caption} loading={eager ? "eager" : "lazy"} />
      </button>
    </figure>
  );
}

type Props = {
  /** Anchor id requested from outside (e.g. the error modal). Consumed after scrolling. */
  anchor: string | null;
  onAnchorHandled: () => void;
};

export default function GuideView({ anchor, onAnchorHandled }: Props) {
  const t = useT();
  const { reportError } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(CHAPTERS[0].id);
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!anchor) return;
    const raf = requestAnimationFrame(() => {
      scrollTo(anchor);
      onAnchorHandled();
    });
    return () => cancelAnimationFrame(raf);
  }, [anchor, onAnchorHandled, scrollTo]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const sections = CHAPTERS.map((c) => document.getElementById(c.id)).filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { root, rootMargin: "-20% 0px -70% 0px" }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const onZoom = useCallback((src: string, caption: string) => setZoom({ src, caption }), []);

  const openTutorial = async () => {
    try {
      await openExternalUrl(TUTORIAL_URL);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="guide-view" ref={scrollRef}>
      <header className="workspace__head guide-view__head">
        <span className="workspace__eyebrow">{t("guide.eyebrow")}</span>
        <h1>{t("guide.title")}</h1>
      </header>
      <p className="guide-view__intro">{t("guide.intro")}</p>

      <nav className="guide-view__toc" aria-label={t("guide.toc")}>
        {CHAPTERS.map(({ id, num: chapterNum, title }) => (
          <button
            key={id}
            type="button"
            className={`guide-view__toc-item ${active === id ? "is-active" : ""}`}
            onClick={() => scrollTo(id)}
            aria-current={active === id ? "true" : undefined}
          >
            <small>{chapterNum}</small>
            <span>{t(title)}</span>
          </button>
        ))}
      </nav>

      <article className="guide">
        <section className="guide__chapter" id="guide-ch-install">
          <header className="guide__chapter-head">
            <Download size={18} aria-hidden="true" />
            <span><small>01</small><h3>{t("guide.install.title")}</h3><p>{t("guide.install.body")}</p></span>
          </header>
          <div className="guide__install">
            {INSTALL_STEPS.map((step, index) => (
              <section className="guide__install-step" id={step.id} key={step.id}>
                <span className="guide__install-rail" aria-hidden="true">
                  <span className="guide__install-dot">{num(index + 1)}</span>
                </span>
                <div className="guide__install-card">
                  <Shot image={step.image} caption={t(step.title)} eager={index < 2} onZoom={onZoom} />
                  <div className="guide__copy">
                    <h4>{t(step.title)}</h4>
                    <p>{t(step.body)}</p>
                    <Points items={step.points} />
                  </div>
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="guide__chapter" id="guide-ch-usage">
          <header className="guide__chapter-head">
            <PlayCircle size={18} aria-hidden="true" />
            <span><small>02</small><h3>{t("guide.usage.title")}</h3><p>{t("guide.usage.body")}</p></span>
          </header>
          <div className="guide__steps">
            {USAGE_STEPS.map((step, index) => (
              <section className="guide__step" id={step.id} key={step.id}>
                <div className="guide__copy">
                  <span className="guide__number">{num(INSTALL_STEPS.length + index + 1)}</span>
                  <h4>{t(step.title)}</h4>
                  <p>{t(step.body)}</p>
                  <Points items={step.points} />
                </div>
                <Shot image={step.image} caption={t(step.title)} onZoom={onZoom} />
              </section>
            ))}
          </div>
        </section>

        <section className="guide__chapter" id="guide-ch-trouble">
          <header className="guide__chapter-head">
            <LifeBuoy size={18} aria-hidden="true" />
            <span><small>03</small><h3>{t("guide.trouble.title")}</h3><p>{t("guide.trouble.body")}</p></span>
          </header>
          <div className="guide__trouble-grid">
            {TROUBLE_STEPS.map((step, index) => (
              <section className={`guide__trouble guide__trouble--${step.severity}`} id={step.id} key={step.id}>
                <Shot image={step.image} caption={t(step.title)} onZoom={onZoom} />
                <div className="guide__copy">
                  <span className={`guide__number guide__number--${step.severity}`}>{num(INSTALL_STEPS.length + USAGE_STEPS.length + index + 1)}</span>
                  <h4>{t(step.title)}</h4>
                  <p>{t(step.body)}</p>
                  <Points items={step.points} />
                </div>
              </section>
            ))}
          </div>
        </section>

        <button className="tutorial-card glass guide__community" onClick={openTutorial}>
          <span className="tutorial-card__icon" aria-hidden="true">
            <BookOpenText size={22} strokeWidth={1.8} />
          </span>
          <span className="tutorial-card__body">
            <small>{t("overview.tutorialEyebrow")}</small>
            <strong>{t("overview.tutorialTitle")}</strong>
            <span>{t("overview.tutorialDesc")}</span>
          </span>
          <span className="tutorial-card__action">
            {t("overview.tutorialAction")}
            <ExternalLink size={16} strokeWidth={1.9} />
          </span>
        </button>
      </article>

      <Modal open={!!zoom} onClose={() => setZoom(null)} title={zoom?.caption} width={920}>
        {zoom && <img className="guide-view__zoom" src={zoom.src} alt={zoom.caption} />}
      </Modal>
    </div>
  );
}
