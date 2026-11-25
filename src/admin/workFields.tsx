import { AutoField, FieldLabel, type CustomField } from '@puckeditor/core';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './icons';
import type { ContentBlock, TourHotspot, Vec3 } from '../viewer/config/types';
import { withBase } from '../viewer/url';
import { uploadImage } from './backend';
import { bridge, useViewer, useWorkTab } from './bridge';
import { Button, GizmoButton, workIndex } from './tourFields';

/**
 * Champs Puck du contenu d'une œuvre : vignette (capture 3D ou import),
 * points d'intérêt (pointage sur le scan, texte, ordre), blocs « En savoir plus »
 * (texte riche ou image).
 */

const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };
const muted: CSSProperties = { fontSize: 12, color: 'var(--bo-muted)' };


const extOf = (f: File) => (/\.(webp|jpe?g|png|avif)$/i.exec(f.name)?.[1] ?? 'jpg').toLowerCase();
const stamp = () => Date.now().toString(36);
/** Réordonne une liste : déplace l'élément `from` à l'index `to`. */
const moved = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
};

/** Sélecteur de fichier image caché derrière un bouton. */
function ImportButton({ label, onFile, icon }: { label: string; onFile: (f: File) => void; icon?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button icon={icon ?? <Icon.upload size={15} />} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/webp,image/jpeg,image/png,image/avif"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

// ---- Vignette --------------------------------------------------------------------

function ThumbnailUI({ value, onChange, name }: { value: string; onChange: (v: string) => void; name: string }) {
  const viewer = useViewer();
  const [busy, setBusy] = useState<string | null>(null);
  const work = workIndex(name);
  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    try {
      onChange(await fn());
      setBusy(null);
    } catch (err) {
      setBusy(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return (
    <FieldLabel label="Vignette (bandeau, collection)">
      <div style={{ display: 'grid', gap: 6 }}>
        {value ? (
          <img src={withBase(value)} alt="" className="bo-thumb" />
        ) : (
          <span className="bo-thumb bo-thumb--empty">
            <Icon.image size={22} />
            Aucune vignette
          </span>
        )}
        <div style={row}>
          <Button
            variant="primary"
            icon={<Icon.camera size={15} />}
            disabled={!viewer?.editor || !!busy}
            title="Rendu de la vue 3D actuelle, sans repères (place d'abord la caméra : aperçu ou vol libre)"
            onClick={() => run('capture', async () => uploadImage(await viewer!.editor!.captureThumbnail(), `oeuvre-${work + 1}-${stamp()}.webp`))}
          >
            Capturer la vue 3D
          </Button>
          <ImportButton label="Importer" onFile={(f) => run('import', () => uploadImage(f, `oeuvre-${work + 1}-${stamp()}.${extOf(f)}`))} />
          {value && <Button variant="ghost" icon={<Icon.trash size={15} />} title="Retirer la vignette" onClick={() => onChange('')} />}
        </div>
        {busy && <span style={muted}>{busy === 'capture' || busy === 'import' ? 'Enregistrement…' : busy}</span>}
      </div>
    </FieldLabel>
  );
}

export const thumbnailField: CustomField<string> = {
  type: 'custom',
  label: 'Vignette',
  render: (p) => <ThumbnailUI value={p.value ?? ''} onChange={p.onChange} name={p.name} />,
};

// ---- Points d'intérêt -----------------------------------------------------------

const newHotspotId = () => `h-${Math.random().toString(36).slice(2, 8)}`;

function HotspotsUI({ value, onChange, name }: { value: TourHotspot[]; onChange: (v: TourHotspot[]) => void; name: string }) {
  const viewer = useViewer();
  const ed = viewer?.editor;
  const list = value ?? [];
  const work = workIndex(name);
  const [drag, setDrag] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | 'new' | null>(null);
  const latest = useRef(list);
  latest.current = list;
  const set = (j: number, patch: Partial<TourHotspot>) => onChange(latest.current.map((h, k) => (k === j ? { ...h, ...patch } : h)));
  const pick = async (j: number | 'new') => {
    if (!ed) return;
    setPicking(j);
    const p = await ed.pick();
    setPicking(null);
    if (!p) return;
    if (j === 'new') onChange([...latest.current, { id: newHotspotId(), position: p, text: '' }]);
    else set(j, { position: p });
  };

  return (
    <FieldLabel label="Points d'intérêt (cycle automatique ou clic)">
      <div style={{ display: 'grid', gap: 8 }}>
        {list.map((h, j) => (
          <div
            key={h.id}
            draggable
            onDragStart={(e) => {
              // Pas de glisser depuis la zone de texte (sélection du texte).
              if ((e.target as HTMLElement).tagName === 'TEXTAREA') return e.preventDefault();
              setDrag(j);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null && drag !== j) onChange(moved(list, drag, j));
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            className={`bo-item${drag === j ? ' is-drag' : ''}`}
          >
            <div className="bo-item__head">
              <span className="bo-item__handle" title="Glisser pour réordonner">
                <span className="bo-num">{j + 1}</span>
                Point d'intérêt
              </span>
              <span style={row}>
                <Button
                  on={picking === j}
                  icon={<Icon.target size={15} />}
                  disabled={!ed}
                  title={picking === j ? 'Cliquez sur le scan… (Échap : annuler)' : 'Repointer sur le scan'}
                  onClick={() => pick(j)}
                />
                <GizmoButton markerKey={`hot:${work}:${j}`} label="" onMove={(v: Vec3) => set(j, { position: v })} />
                <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer ce point" onClick={() => onChange(list.filter((_, k) => k !== j))} />
              </span>
            </div>
            <textarea
              className="bo-textarea"
              value={h.text}
              rows={3}
              placeholder="Texte affiché à côté du point"
              onChange={(e) => set(j, { text: e.currentTarget.value })}
            />
          </div>
        ))}
        <Button
          variant={picking === 'new' ? 'primary' : 'dashed'}
          icon={picking === 'new' ? <Icon.target size={15} /> : <Icon.plus size={15} />}
          disabled={!ed}
          title="Cliquer ensuite sur le scan, à l'endroit du point"
          onClick={() => pick('new')}
        >
          {picking === 'new' ? 'Cliquez sur le scan… (Échap : annuler)' : 'Ajouter un point (pointer sur le scan)'}
        </Button>
      </div>
    </FieldLabel>
  );
}

export const hotspotsField: CustomField<TourHotspot[]> = {
  type: 'custom',
  label: "Points d'intérêt",
  render: (p) => <HotspotsUI value={p.value} onChange={p.onChange} name={p.name} />,
};

// ---- Contenu « En savoir plus » --------------------------------------------------

const richtext = { type: 'richtext' as const, label: 'Texte' };

function BlocksUI({ value, onChange, name }: { value: ContentBlock[]; onChange: (v: ContentBlock[]) => void; name: string }) {
  const blocks = value ?? [];
  const work = workIndex(name);
  const [drag, setDrag] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(blocks);
  latest.current = blocks;
  const set = (j: number, b: ContentBlock) => onChange(latest.current.map((x, k) => (k === j ? b : x)));

  return (
    <FieldLabel label="Contenu « En savoir plus » (blocs)">
      <div style={{ display: 'grid', gap: 6 }}>
        {blocks.map((b, j) => (
          <div
            key={j}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null && drag !== j) onChange(moved(blocks, drag, j));
              setDrag(null);
            }}
            className={`bo-item${drag === j ? ' is-drag' : ''}`}
          >
            <div className="bo-item__head">
              <span
                className="bo-item__handle"
                draggable
                onDragStart={(e) => {
                  setDrag(j);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDrag(null)}
                title="Glisser pour réordonner"
              >
                <span className="bo-num">{b.type === 'text' ? <Icon.text size={12} /> : <Icon.image size={12} />}</span>
                {b.type === 'text' ? 'Texte' : 'Image'}
              </span>
              <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer ce bloc" onClick={() => onChange(blocks.filter((_, k) => k !== j))} />
            </div>
            {b.type === 'text' ? (
              <AutoField field={richtext} value={b.html} onChange={(html: string) => set(j, { type: 'text', html: html ?? '' })} />
            ) : (
              <>
                {b.src ? (
                  <img src={withBase(b.src)} alt={b.alt} className="bo-thumb" style={{ aspectRatio: 'auto' }} />
                ) : (
                  <span style={muted}>Aucune image.</span>
                )}
                <div style={row}>
                  <ImportButton
                    label={b.src ? 'Remplacer' : 'Importer une image'}
                    onFile={async (f) => {
                      setError(null);
                      try {
                        set(j, { ...b, src: await uploadImage(f, `oeuvre-${work + 1}-contenu-${stamp()}.${extOf(f)}`) });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  />
                </div>
                <input
                  type="text"
                  value={b.alt}
                  placeholder="Description de l'image (accessibilité)"
                  onChange={(e) => set(j, { ...b, alt: e.currentTarget.value })}
                  className="bo-input"
                />
              </>
            )}
          </div>
        ))}
        {error && <span style={{ ...muted, color: '#b42318' }}>{error}</span>}
        <div style={row}>
          <Button variant="dashed" icon={<Icon.text size={15} />} onClick={() => onChange([...blocks, { type: 'text', html: '' }])}>
            Ajouter un texte
          </Button>
          <Button variant="dashed" icon={<Icon.image size={15} />} onClick={() => onChange([...blocks, { type: 'image', src: '', alt: '' }])}>
            Ajouter une image
          </Button>
        </div>
      </div>
    </FieldLabel>
  );
}

export const blocksField: CustomField<ContentBlock[]> = {
  type: 'custom',
  label: 'Contenu',
  render: (p) => <BlocksUI value={p.value} onChange={p.onChange} name={p.name} />,
};

// ---- Sous-onglets d'une œuvre -------------------------------------------------------

const WORK_TABS: { key: string; label: string }[] = [
  { key: 'infos', label: 'Infos' },
  { key: 'parcours', label: 'Parcours' },
  { key: 'points', label: 'Points' },
  { key: 'contenu', label: 'Contenu' },
];

/**
 * Sélecteur Infos / Parcours / Points / Contenu en tête d'une œuvre. N'enregistre rien :
 * il marque le bloc de champs de l'œuvre (data-bo-tab) et la feuille de style
 * n'affiche que la section choisie (admin.css).
 */
function WorkTabsUI({ name }: { name: string }) {
  const id = String(workIndex(name));
  const tab = useWorkTab(id);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fieldset = ref.current?.closest<HTMLElement>('[class*="_ArrayFieldItem-fieldset_"]');
    if (fieldset) fieldset.dataset.boTab = tab;
  }, [tab]);
  return (
    <div ref={ref} className="bo-seg bo-worktabs" role="tablist" aria-label="Réglages de l'œuvre">
      {WORK_TABS.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-on' : ''} onClick={() => bridge.setWorkTab(id, t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export const workTabsField: CustomField<null> = {
  type: 'custom',
  label: 'Section',
  render: ({ name }) => <WorkTabsUI name={name} />,
};

/** Résumé d'une œuvre dans la liste : vignette, titre, auteur, nombre de points. */
export function WorkSummary({ title, author, thumbnail, points, index }: { title: string; author: string; thumbnail: string; points: number; index: number }) {
  return (
    <span className="bo-worksum">
      {thumbnail ? <img src={withBase(thumbnail)} alt="" /> : <span className="bo-worksum__empty"><Icon.image size={16} /></span>}
      <span className="bo-worksum__text">
        <b>{title || `Œuvre ${index + 1}`}</b>
        <small>
          {author || 'Auteur ?'} · {points} point{points > 1 ? 's' : ''}
        </small>
      </span>
      <span className="bo-num">{index + 1}</span>
    </span>
  );
}
