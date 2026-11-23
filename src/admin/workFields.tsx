import { AutoField, FieldLabel, type CustomField } from '@puckeditor/core';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ContentBlock, TourHotspot, Vec3 } from '../viewer/config/types';
import { withBase } from '../viewer/url';
import { useViewer } from './bridge';
import { GizmoButton, workIndex } from './tourFields';

/**
 * Champs Puck du contenu d'une œuvre : vignette (capture 3D ou import),
 * points d'intérêt (pointage sur le scan, texte, ordre), blocs « En savoir plus »
 * (texte riche ou image).
 */

const btn: CSSProperties = {
  padding: '4px 8px',
  font: '12px system-ui, sans-serif',
  border: '1px solid #c9ced6',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' };
const card: CSSProperties = { display: 'grid', gap: 6, padding: 6, border: '1px solid #e1e4e8', borderRadius: 4, background: '#fafbfc' };
const muted: CSSProperties = { font: '11px system-ui', color: '#59606b' };

function Button({ children, ...p }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" style={{ ...btn, opacity: p.disabled ? 0.5 : 1 }} {...p}>
      {children}
    </button>
  );
}

/** Envoie une image au serveur de dev (public/media/) ; renvoie son URL depuis la racine. */
export async function uploadImage(file: Blob, name: string): Promise<string> {
  const res = await fetch(`/__admin/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body: file });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.url as string;
}

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
function ImportButton({ label, onFile }: { label: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button onClick={() => input.current?.click()}>{label}</Button>
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
          <img src={withBase(value)} alt="" style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          <span style={muted}>Aucune vignette.</span>
        )}
        <div style={row}>
          <Button
            disabled={!viewer?.editor || !!busy}
            title="Rendu de la vue 3D actuelle, sans repères (place d'abord la caméra : aperçu ou vol libre)"
            onClick={() => run('capture', async () => uploadImage(await viewer!.editor!.captureThumbnail(), `oeuvre-${work + 1}-${stamp()}.webp`))}
          >
            Capturer la vue 3D
          </Button>
          <ImportButton label="Importer une image" onFile={(f) => run('import', () => uploadImage(f, `oeuvre-${work + 1}-${stamp()}.${extOf(f)}`))} />
          {value && <Button onClick={() => onChange('')}>Retirer</Button>}
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
      <div style={{ display: 'grid', gap: 6 }}>
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
            style={{ ...card, background: drag === j ? '#e7f1fb' : card.background }}
          >
            <div style={{ ...row, justifyContent: 'space-between' }}>
              <span style={{ cursor: 'grab', font: '600 12px system-ui' }} title="Glisser pour réordonner">
                ⠿ Point {j + 1}
              </span>
              <span style={row}>
                <Button disabled={!ed} title="Cliquer ensuite sur le scan (Échap : annuler)" onClick={() => pick(j)}>
                  {picking === j ? 'Cliquez…' : 'Repointer'}
                </Button>
                <GizmoButton markerKey={`hot:${work}:${j}`} onMove={(v: Vec3) => set(j, { position: v })} />
                <Button title="Supprimer ce point" onClick={() => onChange(list.filter((_, k) => k !== j))}>
                  ✕
                </Button>
              </span>
            </div>
            <textarea
              value={h.text}
              rows={3}
              placeholder="Texte affiché à côté du point"
              onChange={(e) => set(j, { text: e.currentTarget.value })}
              style={{ width: '100%', boxSizing: 'border-box', font: '12px system-ui', resize: 'vertical' }}
            />
          </div>
        ))}
        <Button disabled={!ed} title="Cliquer ensuite sur le scan, à l'endroit du point" onClick={() => pick('new')}>
          {picking === 'new' ? 'Cliquez sur le scan…' : '+ Ajouter un point (pointer sur le scan)'}
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
            style={{ ...card, background: drag === j ? '#e7f1fb' : card.background }}
          >
            <div style={{ ...row, justifyContent: 'space-between' }}>
              <span
                draggable
                onDragStart={(e) => {
                  setDrag(j);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDrag(null)}
                style={{ cursor: 'grab', font: '600 12px system-ui' }}
                title="Glisser pour réordonner"
              >
                ⠿ {b.type === 'text' ? 'Texte' : 'Image'}
              </span>
              <Button title="Supprimer ce bloc" onClick={() => onChange(blocks.filter((_, k) => k !== j))}>
                ✕
              </Button>
            </div>
            {b.type === 'text' ? (
              <AutoField field={richtext} value={b.html} onChange={(html: string) => set(j, { type: 'text', html: html ?? '' })} />
            ) : (
              <>
                {b.src ? (
                  <img src={withBase(b.src)} alt={b.alt} style={{ width: '100%', borderRadius: 4 }} />
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
                  style={{ font: '12px system-ui' }}
                />
              </>
            )}
          </div>
        ))}
        {error && <span style={{ ...muted, color: '#b42318' }}>{error}</span>}
        <div style={row}>
          <Button onClick={() => onChange([...blocks, { type: 'text', html: '' }])}>+ Texte</Button>
          <Button onClick={() => onChange([...blocks, { type: 'image', src: '', alt: '' }])}>+ Image</Button>
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
