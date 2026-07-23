import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImageOff, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import SubPage from "../components/SubPage";
import Toggle from "../components/Toggle";
import CosmeticsTeamSwitch, { useCosmeticsTeam } from "../components/CosmeticsTeamSwitch";
import { STICKERS, stickerName, type StickerCatalogEntry } from "../data/stickers";
import { WEAPON_ICONS } from "../data/weaponIcons";
import skinImages from "../data/skinImages.json";
import stickerWeaponRows from "../data/stickerWeaponIds.json";
import { api, type KnifeCustomizerConfig, type StickerPreset } from "../lib/api";
import { useStore } from "../state/store";
import { useT } from "../i18n";
import {
  clampStickerValue,
  filterStickerCatalog,
  paginateStickerCatalog,
  removeSticker,
  replaceSticker,
  swapStickerSlots,
  updateGunPresetStickers,
} from "../lib/stickerEditor";
import "./StickersPanel.css";

type SkinImage = { weapon_defindex: number; paint: number | string; image: string };
const PAGE_SIZE = 60;
const SLOT_ANCHORS = [
  { x: 25, y: 46 }, { x: 38, y: 42 }, { x: 51, y: 47 }, { x: 64, y: 42 }, { x: 76, y: 48 },
];
const imageMap = new Map((skinImages as SkinImage[]).map((row) => [`${row.weapon_defindex}:${Number(row.paint)}`, row.image]));
const stickerMap = new Map(STICKERS.map((entry) => [entry.id, entry]));
const stickerWeaponIds = new Set((stickerWeaponRows as { id: number }[]).map((entry) => entry.id));

export default function StickersPanel() {
  const { csgoPath, config: appConfig, process, reportError } = useStore();
  const [config, setConfig] = useState<KnifeCustomizerConfig | null>(null);
  const [team, setTeam] = useCosmeticsTeam();
  const [weaponId, setWeaponId] = useState<number | null>(null);
  const [slot, setSlot] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const t = useT();
  const running = !!process?.running;

  useEffect(() => {
    if (!csgoPath) return setConfig(null);
    void api.getKnifeCustomizer(csgoPath).then((state) => setConfig(state.config)).catch(reportError);
  }, [csgoPath, reportError]);

  const configuredWeapons = useMemo(() => {
    if (!config) return [];
    const presets = config.loadouts[team].gun_presets;
    return WEAPON_ICONS.filter((weapon) =>
      stickerWeaponIds.has(weapon.id) &&
      (weapon.availability === team || weapon.availability === "shared") &&
      !!presets[String(weapon.id)]);
  }, [config, team]);

  useEffect(() => {
    if (!configuredWeapons.some((weapon) => weapon.id === weaponId))
      setWeaponId(configuredWeapons[0]?.id ?? null);
  }, [configuredWeapons, weaponId]);

  const weapon = configuredWeapons.find((entry) => entry.id === weaponId) ?? null;
  const preset = weapon && config ? config.loadouts[team].gun_presets[String(weapon.id)] : null;
  const stickers = [...(preset?.stickers ?? [])].sort((left, right) => left.slot - right.slot);
  const selectedSticker = stickers.find((entry) => entry.slot === slot) ?? null;
  const selectedCatalog = selectedSticker ? stickerMap.get(selectedSticker.id) : null;
  const weaponImage = weapon && preset ? imageMap.get(`${weapon.id}:${preset.paint}`) ?? weapon.url : "";

  const filtered = useMemo(() => filterStickerCatalog(
    STICKERS,
    query,
    (entry) => stickerName(entry, appConfig?.language),
  ), [appConfig?.language, query]);
  const catalogPage = paginateStickerCatalog(filtered, page, PAGE_SIZE);
  const { pageCount, entries: visibleStickers } = catalogPage;

  useEffect(() => setPage(0), [query]);

  const setPresetStickers = (next: StickerPreset[]) => {
    if (!config || !weapon || !preset) return;
    setConfig(updateGunPresetStickers(config, team, weapon.id, weapon.availability, preset, next));
  };

  const chooseSticker = (entry: StickerCatalogEntry) => {
    const next: StickerPreset = {
      slot, id: entry.id, wear: 0, scale: 1, rotation: 0,
      offset_x: 0, offset_y: 0, custom_position: false,
    };
    setPresetStickers(replaceSticker(stickers, next));
  };

  const updateSelected = (patch: Partial<StickerPreset>) => {
    if (!selectedSticker) return;
    setPresetStickers(stickers.map((entry) => entry.slot === slot ? { ...entry, ...patch } : entry));
  };

  const swapSlot = (delta: -1 | 1) => {
    const target = slot + delta;
    if (target < 0 || target > 4) return;
    setPresetStickers(swapStickerSlots(stickers, slot, target));
    setSlot(target);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !selectedSticker?.custom_position || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    updateSelected({
      offset_x: clampStickerValue(dragRef.current.offsetX + ((event.clientX - dragRef.current.x) / rect.width) * 4, -1, 1),
      offset_y: clampStickerValue(dragRef.current.offsetY + ((event.clientY - dragRef.current.y) / rect.height) * 4, -1, 1),
    });
  };

  const persist = async () => {
    if (!csgoPath || !config || running) return;
    setSaving(true);
    try {
      const state = await api.saveKnifeCustomizer(csgoPath, { ...config, enabled: true, stickers_enabled: true });
      setConfig(state.config);
    } catch (error) { reportError(error); }
    finally { setSaving(false); }
  };

  return <SubPage
    title={t("stickers.title")}
    status={!csgoPath ? "off" : running ? "yellow" : "green"}
    right={<button className="stickers-save" disabled={!config || running || saving} onClick={() => void persist()}>
      <Save size={15} />{saving ? t("weapons.saving") : t("weapons.apply")}
    </button>}
  >
    <div className="stickers-page">
      <section className="stickers-weapons">
        <header><strong>{t("stickers.weapon")}</strong><CosmeticsTeamSwitch value={team} onChange={setTeam} ariaLabel={t("weapons.teamLoadout")} compact /></header>
        <div>
          {configuredWeapons.map((entry) => <button key={entry.id} className={entry.id === weaponId ? "is-active" : ""} onClick={() => setWeaponId(entry.id)}>
            <img src={entry.url} alt="" /><span>{entry.name}</span>
          </button>)}
          {!configuredWeapons.length && <p>{t("stickers.noWeapons")}</p>}
        </div>
      </section>

      <section className="stickers-editor">
        <div
          className="stickers-preview"
          ref={previewRef}
          onPointerMove={onPointerMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerLeave={() => { dragRef.current = null; }}
        >
          {weaponImage && <img className="stickers-preview__weapon" src={weaponImage} alt="" />}
          {stickers.map((entry) => {
            const catalog = stickerMap.get(entry.id);
            const anchor = SLOT_ANCHORS[entry.slot];
            return <button
              key={entry.slot}
              className={`stickers-preview__sticker ${entry.slot === slot ? "is-active" : ""}`}
              style={{
                left: `${anchor.x + (entry.custom_position ? entry.offset_x * 18 : 0)}%`,
                top: `${anchor.y + (entry.custom_position ? entry.offset_y * 18 : 0)}%`,
                transform: `translate(-50%, -50%) rotate(${entry.rotation}deg) scale(${entry.scale})`,
                opacity: Math.max(.18, 1 - entry.wear * .82),
              }}
              onClick={() => setSlot(entry.slot)}
              onPointerDown={(event) => {
                if (!entry.custom_position) return;
                setSlot(entry.slot);
                dragRef.current = { x: event.clientX, y: event.clientY, offsetX: entry.offset_x, offsetY: entry.offset_y };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            >{catalog ? <StickerImage entry={catalog} /> : <span>{entry.slot + 1}</span>}</button>;
          })}
        </div>

        <div className="sticker-slots">
          {[0, 1, 2, 3, 4].map((index) => {
            const entry = stickers.find((item) => item.slot === index);
            const catalog = entry ? stickerMap.get(entry.id) : null;
            return <button key={index} className={slot === index ? "is-active" : ""} onClick={() => setSlot(index)}>
              <b>{index + 1}</b>{catalog ? <StickerImage entry={catalog} /> : <span>+</span>}
            </button>;
          })}
        </div>

        <div className="sticker-controls">
          <header>
            <span><small>{t("stickers.slot", { n: slot + 1 })}</small><strong>{selectedCatalog ? stickerName(selectedCatalog, appConfig?.language) : t("stickers.empty")}</strong></span>
            <div>
              <button disabled={!selectedSticker || slot === 0} onClick={() => swapSlot(-1)} title={t("stickers.moveLeft")}><ArrowLeft size={15} /></button>
              <button disabled={!selectedSticker || slot === 4} onClick={() => swapSlot(1)} title={t("stickers.moveRight")}><ArrowRight size={15} /></button>
              <button disabled={!selectedSticker} onClick={() => setPresetStickers(removeSticker(stickers, slot))} title={t("stickers.remove")}><Trash2 size={15} /></button>
            </div>
          </header>
          {selectedSticker && <>
            <Control label={t("stickers.wear")} value={selectedSticker.wear} min={0} max={1} step={0.01} onChange={(wear) => updateSelected({ wear })} />
            <Control label={t("stickers.scale")} value={selectedSticker.scale} min={0.1} max={2} step={0.01} onChange={(scale) => updateSelected({ scale })} />
            <Control label={t("stickers.rotation")} value={selectedSticker.rotation} min={0} max={360} step={1} onChange={(rotation) => updateSelected({ rotation })} />
            <label className="sticker-custom"><span>{t("stickers.customPosition")}</span><Toggle checked={selectedSticker.custom_position} onChange={(custom_position) => updateSelected({ custom_position })} /></label>
            <Control label="X" value={selectedSticker.offset_x} min={-1} max={1} step={0.01} disabled={!selectedSticker.custom_position} onChange={(offset_x) => updateSelected({ offset_x })} />
            <Control label="Y" value={selectedSticker.offset_y} min={-1} max={1} step={0.01} disabled={!selectedSticker.custom_position} onChange={(offset_y) => updateSelected({ offset_y })} />
            <button className="sticker-reset" onClick={() => updateSelected({ wear: 0, scale: 1, rotation: 0, offset_x: 0, offset_y: 0, custom_position: false })}><RotateCcw size={14} />{t("stickers.reset")}</button>
          </>}
        </div>
      </section>

      <section className="sticker-catalog">
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("stickers.search")} /></label>
        <div className="sticker-catalog__grid">
          {visibleStickers.map((entry) => <button key={entry.id} className={entry.id === selectedSticker?.id ? "is-active" : ""} onClick={() => chooseSticker(entry)} title={`${stickerName(entry, appConfig?.language)} · ${entry.id}`}>
            <StickerImage entry={entry} lazy /><span>{stickerName(entry, appConfig?.language)}</span><small>#{entry.id}</small>
          </button>)}
        </div>
        <footer><button disabled={catalogPage.page === 0} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={15} /></button><span>{catalogPage.page + 1} / {pageCount}</span><button disabled={catalogPage.page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ArrowRight size={15} /></button></footer>
      </section>
    </div>
  </SubPage>;
}

function Control({ label, value, min, max, step, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (value: number) => void;
}) {
  return <label className="sticker-control"><span>{label}</span><input type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(clampStickerValue(Number(event.target.value), min, max))} /><input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(clampStickerValue(Number(event.target.value), min, max))} /></label>;
}

function StickerImage({ entry, lazy = false }: { entry: StickerCatalogEntry; lazy?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [entry.image]);
  return failed || !entry.image
    ? <span className="sticker-image-fallback" aria-hidden="true"><ImageOff size={16} /></span>
    : <img src={entry.image} alt="" loading={lazy ? "lazy" : undefined} draggable={false} onError={() => setFailed(true)} />;
}
