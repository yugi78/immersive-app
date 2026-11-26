import { createUsePuck, Puck, type Data } from '@puckeditor/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BRAND } from '../config/brand';
import { projectName } from './project';
import { isFull, LOCAL } from './backend';
import { bridge, useDevice, useViewer } from './bridge';
import { Icon } from './icons';
import { StructurePanel } from './StructurePanel';
import { AddressesDialog } from './Addresses';

const usePuck = createUsePuck();

/**
 * Onglets (libellés identiques aux FieldTab de SceneEditor) : un onglet par partie de
 * l'expérience, dans l'ordre où le visiteur la découvre, puis l'apparence, puis les
 * outils d'édition (en bas).
 */
export const TOOLS_TAB = 'Outils';
const TABS: { tab: string; label: string; icon: ReactNode; bottom?: boolean }[] = [
  { tab: 'Expérience', label: 'Expérience', icon: <Icon.play size={20} /> },
  { tab: 'Œuvres', label: 'Œuvres', icon: <Icon.route size={20} /> },
  { tab: 'Carte', label: 'Carte', icon: <Icon.map size={20} /> },
  { tab: 'Rendu', label: 'Rendu', icon: <Icon.scene size={20} /> },
  { tab: 'Infos', label: 'Infos', icon: <Icon.layout size={20} /> },
  { tab: TOOLS_TAB, label: 'Outils', icon: <Icon.box size={20} />, bottom: true },
];
const SUBTITLES: Record<string, string> = {
  Expérience: 'Écran de démarrage, intro, boucle d’attente, prise en main',
  Œuvres: 'Œuvres, parcours caméra, points d’intérêt, transitions',
  Carte: 'Carte interactive, points de vue, mini-carte',
  Rendu: 'Découpes, brume, couleurs, flou',
  Infos: 'Textes du site : à propos',
  [TOOLS_TAB]: isFull ? 'Objets 3D et matériaux (en local), vol libre, repères' : 'Vol libre et repères (outils d’édition)',
};

export type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

/**
 * Mise en page du back-office (composition Puck) : en-tête (état d'enregistrement,
 * annuler / rétablir, aperçu bureau / mobile, Publier), colonne d'onglets à icônes,
 * panneau des réglages (Puck.Fields), aperçu 3D agrandi avec sa barre d'outils.
 */
export function AdminLayout({ onPublish, save }: { onPublish: (data: Data) => void; save: SaveState }) {
  const dispatch = usePuck((s) => s.dispatch);
  const history = usePuck((s) => s.history);
  const data = usePuck((s) => s.appState.data);
  const fieldTab = usePuck((s) => s.appState.ui.fieldTab);
  const tab = String(fieldTab ?? TABS[0].tab);
  const device = useDevice();

  // Modifié depuis le dernier enregistrement : comparaison des réglages (JSON).
  const props = data.root?.props ?? {};
  const json = useMemo(() => JSON.stringify(props), [props]);
  const savedJson = useRef<string | null>(null);
  if (savedJson.current === null) savedJson.current = json;
  useEffect(() => {
    if (save.kind === 'saved') savedJson.current = json;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);
  const dirty = json !== savedJson.current;

  // Adresses du projet : bouton de l'en-tête, et rappel après chaque publication réussie.
  const [addresses, setAddresses] = useState<null | 'manual' | 'published'>(null);
  const prevSave = useRef(save.kind);
  useEffect(() => {
    if (prevSave.current === 'saving' && save.kind === 'saved') setAddresses('published');
    prevSave.current = save.kind;
  }, [save]);

  const pill =
    save.kind === 'saving'
      ? { cls: 'is-busy', text: 'Enregistrement…' }
      : save.kind === 'error'
        ? { cls: 'is-error', text: save.message ?? 'Erreur' }
        : dirty
          ? { cls: 'is-dirty', text: 'Modifications non publiées' }
          : { cls: 'is-ok', text: save.kind === 'saved' && save.message ? save.message : 'Publié' };

  const setTab = (t: string) => dispatch({ type: 'setUi', ui: { fieldTab: t } });
  // L'historique de Puck contient aussi l'onglet ouvert : on annule les réglages
  // sans quitter l'onglet courant.
  const step = (go: () => void) => {
    const keep = tab;
    go();
    dispatch({ type: 'setUi', ui: { fieldTab: keep } });
  };

  return (
    <div className="bo">
      <header className="bo-header">
        <div className="bo-brand">
          <span className="bo-brand__mark">
            <Icon.logo />
          </span>
          <span className="bo-brand__text">
            <b>{BRAND}</b>
            <span>
              {projectName()} · {isFull ? 'administration complète' : 'espace client'}
            </span>
          </span>
        </div>
        {LOCAL && (
          <a className="bo-modelink" href={isFull ? '?client' : '?'} title="Basculer entre l'administration complète et l'espace client (test local)">
            {isFull ? 'Voir l’espace client' : 'Mode complet'}
          </a>
        )}
        <span className={`bo-pill ${pill.cls}`} role="status" title={pill.text}>
          <i />
          {pill.text}
        </span>
        <div className="bo-spacer" />
        <div className="bo-group">
          <button type="button" className="bo-iconbtn" aria-label="Annuler" title="Annuler (Ctrl+Z)" disabled={!history.hasPast} onClick={() => step(history.back)}>
            <Icon.undo />
          </button>
          <button type="button" className="bo-iconbtn" aria-label="Rétablir" title="Rétablir (Ctrl+Maj+Z)" disabled={!history.hasFuture} onClick={() => step(history.forward)}>
            <Icon.redo />
          </button>
        </div>
        <div className="bo-seg" role="group" aria-label="Largeur de l'aperçu">
          <button type="button" className={device === 'desktop' ? 'is-on' : ''} aria-pressed={device === 'desktop'} onClick={() => bridge.setDevice('desktop')}>
            <Icon.desktop size={16} />
            Desktop
          </button>
          <button type="button" className={device === 'mobile' ? 'is-on' : ''} aria-pressed={device === 'mobile'} onClick={() => bridge.setDevice('mobile')}>
            <Icon.mobile size={16} />
            Mobile
          </button>
        </div>
        <button type="button" className="bo-btn" onClick={() => setAddresses('manual')} title="Adresses du site à transmettre">
          <Icon.link size={16} />
          Adresses
        </button>
        {!LOCAL && (
          <button
            type="button"
            className="bo-iconbtn"
            aria-label="Se déconnecter"
            title="Se déconnecter"
            onClick={async () => {
              await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
              location.assign('/connexion/');
            }}
          >
            <Icon.close />
          </button>
        )}
        <button type="button" className="bo-btn bo-btn--primary bo-btn--lg" disabled={save.kind === 'saving'} onClick={() => onPublish(data)}>
          <Icon.upload size={16} />
          Publier
        </button>
      </header>

      {addresses && <AddressesDialog published={addresses === 'published'} onClose={() => setAddresses(null)} />}

      <div className="bo-body">
        <nav className="bo-rail" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              className={`bo-rail__item${t.tab === tab ? ' is-on' : ''}${t.bottom ? ' is-bottom' : ''}`}
              aria-current={t.tab === tab ? 'page' : undefined}
              onClick={() => setTab(t.tab)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <aside className="bo-panel">
          <div className="bo-panel__head">
            <h1>{tab}</h1>
            <p>{SUBTITLES[tab] ?? ''}</p>
          </div>
          <div className="bo-panel__fields">
            <Puck.Fields />
            {/* Outils, en local : structure de la scène (scene.json) sous les réglages d'édition. */}
            {tab === TOOLS_TAB && isFull && (
              <section className="bo-tools__structure">
                <h2>Objets 3D et matériaux</h2>
                <StructurePanel />
              </section>
            )}
          </div>
        </aside>

        <main className="bo-stage">
          <div className={`bo-stage__frame${device === 'mobile' ? ' is-mobile' : ''}`}>
            <div className="bo-preview">
              <Puck.Preview />
            </div>
            <ScanStatus />
          </div>
          <PreviewToolbar />
        </main>
      </div>
    </div>
  );
}

/** Barre flottante de l'aperçu : orbite / vol libre, repères, carte. */
function PreviewToolbar() {
  const dispatch = usePuck((s) => s.dispatch);
  const fly = usePuck((s) => Boolean(s.appState.data.root?.props?.flyEnabled));
  const helpers = usePuck((s) => s.appState.data.root?.props?.showTourHelpers !== false);
  const viewer = useViewer();
  const [mapOpen, setMapOpen] = useState(false);
  const setProp = (key: string, value: unknown) =>
    dispatch({
      type: 'setData',
      data: (prev) => ({ ...prev, root: { ...prev.root, props: { ...(prev.root?.props ?? {}), [key]: value } } }),
    });
  return (
    <div className="bo-toolbar" role="toolbar" aria-label="Aperçu">
      <button type="button" className={!fly ? 'is-on' : ''} aria-pressed={!fly} onClick={() => setProp('flyEnabled', false)}>
        <Icon.rotate size={16} />
        Orbite
      </button>
      <button
        type="button"
        className={fly ? 'is-on' : ''}
        aria-pressed={fly}
        title="ZQSD pour avancer, glisser au clic gauche pour regarder, A / E : bas / haut, Maj : vite"
        onClick={() => setProp('flyEnabled', true)}
      >
        <Icon.fly size={16} />
        Vol libre
      </button>
      <span className="bo-toolbar__sep" />
      <button
        type="button"
        className={`is-icon${helpers ? ' is-soft' : ''}`}
        aria-pressed={helpers}
        aria-label="Afficher les repères de la visite"
        title="Repères de la visite"
        onClick={() => setProp('showTourHelpers', !helpers)}
      >
        <Icon.pin size={16} />
      </button>
      <button
        type="button"
        className={`is-icon${mapOpen ? ' is-soft' : ''}`}
        aria-pressed={mapOpen}
        aria-label="Ouvrir la carte"
        title="Carte interactive"
        disabled={!viewer}
        onClick={() => {
          if (mapOpen) viewer?.map.close();
          else viewer?.map.open(0);
          setMapOpen(!mapOpen);
        }}
      >
        <Icon.map size={16} />
      </button>
    </div>
  );
}

/** État du scan (niveaux chargés, mémoire), en bas à gauche de l'aperçu. */
function ScanStatus() {
  const viewer = useViewer();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const scan = (viewer?.debug as { scan?: { stats(): { perLevel: Record<string, number>; textureMB: number; loading: number } } } | undefined)?.scan;
    if (!scan) return;
    const tick = () => {
      const s = scan.stats();
      const top = Object.keys(s.perLevel)
        .map(Number)
        .filter((l) => s.perLevel[l] > 0)
        .sort((a, b) => b - a)[0];
      setText(`Scan ${top ?? '—'} · ${Math.round(s.textureMB)} Mo${s.loading ? ` · ${s.loading} en cours` : ''}`);
      setBusy(s.loading > 0);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [viewer]);
  if (!text) return null;
  return (
    <div className="bo-chip">
      <i className={busy ? 'is-busy' : ''} />
      {text}
    </div>
  );
}
