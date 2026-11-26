import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IDENTITY, isTiled, normalizeScene, type MaterialDef, type ObjectTransform, type SceneObject } from '../viewer/config/scene-model';
import { defaultConfig, type Vec3 } from '../viewer/config/types';
import { useViewer } from './bridge';
import { Icon } from './icons';
import { Button, XYZ } from './tourFields';

/**
 * Onglet « Objets 3D » (administration complète, en local) : outliner des objets de
 * la scène, inspecteur de l'objet sélectionné, éditeur de matériaux. Modifie la
 * STRUCTURE (scene.json) — jamais publiée par l'espace client.
 *
 * En direct dans l'aperçu : visibilité, placement (gizmo), surlignage. Les options de
 * matériau et l'affectation des matériaux s'appliquent à l'enregistrement (l'aperçu
 * se recharge avec la nouvelle structure).
 */

type Materials = Record<string, MaterialDef>;
const initial = () => {
  const m = normalizeScene(defaultConfig as unknown as Parameters<typeof normalizeScene>[0]);
  return { objects: structuredClone(m.objects), materials: structuredClone(m.materials) };
};

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="bo-field bo-switch">
      <span className="bo-switch__text">
        <span className="bo-field__label">{label}</span>
        {hint && <span className="bo-field__hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span className="bo-switch__track" aria-hidden="true" />
    </label>
  );
}

function Section({ title, icon, children, actions }: { title: string; icon: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="bo-section">
      <header className="bo-section__head">
        <span className="bo-section__title">
          {icon}
          {title}
        </span>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function StructurePanel() {
  const viewer = useViewer();
  const [state, setState] = useState(initial);
  const saved = useRef(JSON.stringify(state));
  const [sel, setSel] = useState<string | null>(state.objects[0]?.id ?? null);
  const [mat, setMat] = useState<string | null>(null);
  const [gizmo, setGizmo] = useState<'translate' | 'rotate' | 'scale' | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; text: string } | null>(null);
  const { objects, materials } = state;
  const dirty = JSON.stringify(state) !== saved.current;
  const selected = objects.find((o) => o.id === sel) ?? null;

  const setObjects = (fn: (list: SceneObject[]) => SceneObject[]) => setState((s) => ({ ...s, objects: fn(s.objects) }));
  const patchObject = (id: string, patch: Partial<SceneObject>) =>
    setObjects((list) => list.map((o) => (o.id === id ? ({ ...o, ...patch } as SceneObject) : o)));
  const setMaterials = (fn: (m: Materials) => Materials) => setState((s) => ({ ...s, materials: fn(s.materials) }));

  // Surlignage de l'objet sélectionné ; gizmo retiré au changement de sélection.
  useEffect(() => {
    const ed = viewer?.editor;
    if (!ed) return;
    ed.detachGizmo();
    setGizmo(null);
    ed.highlight(sel ? viewer.objects.root(sel) : null);
  }, [viewer, sel]);
  useEffect(
    () => () => {
      viewer?.editor?.detachGizmo();
      viewer?.editor?.highlight(null);
    },
    [viewer],
  );

  // ---- Objets -----------------------------------------------------------------------
  const setVisible = (o: SceneObject, v: boolean) => {
    patchObject(o.id, { visible: v ? undefined : false });
    viewer?.objects.setVisible(o.id, v);
  };
  const setTransform = (o: SceneObject, t: ObjectTransform) => {
    patchObject(o.id, { transform: t } as Partial<SceneObject>);
    viewer?.objects.setTransform(o.id, t);
    if (viewer?.editor) viewer.editor.highlight(viewer.objects.root(o.id));
  };
  const toggleGizmo = (o: SceneObject, mode: 'translate' | 'rotate' | 'scale') => {
    const ed = viewer?.editor;
    const root = viewer?.objects.root(o.id);
    if (!ed || !root) return;
    if (gizmo === mode) {
      ed.detachGizmo();
      setGizmo(null);
      ed.highlight(root);
      return;
    }
    ed.attachObject(`object:${o.id}`, root, mode, (t) => patchObject(o.id, { transform: t } as Partial<SceneObject>));
    setGizmo(mode);
  };
  const usage = useMemo(() => {
    const u: Record<string, number> = {};
    for (const o of objects) u[o.material] = (u[o.material] ?? 0) + 1;
    return u;
  }, [objects]);

  // ---- Matériaux ----------------------------------------------------------------------
  const patchMaterial = (key: string, patch: Partial<MaterialDef>) =>
    setMaterials((m) => ({ ...m, [key]: Object.fromEntries(Object.entries({ ...m[key], ...patch }).filter(([, v]) => v !== undefined && v !== null)) }));
  const renameMaterial = (from: string, to: string) => {
    const key = to.trim().replace(/[^\w-]+/g, '-');
    if (!key || key === from || materials[key]) return;
    setState((s) => ({
      objects: s.objects.map((o) => (o.material === from ? { ...o, material: key } : o)),
      materials: Object.fromEntries(Object.entries(s.materials).map(([k, v]) => [k === from ? key : k, v])),
    }));
    setMat(key);
  };
  const addMaterial = () => {
    let i = 1;
    while (materials[`materiau-${i}`]) i++;
    const key = `materiau-${i}`;
    setMaterials((m) => ({ ...m, [key]: { unlit: true, mist: true } }));
    setMat(key);
  };

  // ---- Enregistrement -------------------------------------------------------------------
  async function save() {
    setStatus({ kind: 'busy', text: 'Enregistrement…' });
    try {
      const res = await fetch('/__admin/scene-structure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      saved.current = JSON.stringify(state);
      // scene.json a changé : le serveur de dev recharge la page avec la nouvelle structure.
      setStatus({ kind: 'ok', text: 'Structure enregistrée · rechargement de l’aperçu…' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }

  const t: ObjectTransform = (selected && !isTiled(selected) && selected.transform) || IDENTITY;
  const m = mat ? materials[mat] : null;

  return (
    <div className="bo-structure">
      <Section
        title="Objets"
        icon={<Icon.box size={16} />}
        actions={
          <span className="bo-field__hint" title="L'import d'un dossier de fichiers 3D arrive à l'étape suivante">
            {objects.length} objets
          </span>
        }
      >
        <ul className="bo-outliner" role="listbox" aria-label="Objets de la scène">
          {objects.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === sel} className={`bo-outliner__row${o.id === sel ? ' is-on' : ''}${o.visible === false ? ' is-hidden' : ''}`}>
              <button type="button" className="bo-outliner__main" onClick={() => setSel(o.id)}>
                <span className="bo-outliner__icon">{isTiled(o) ? <Icon.layout size={15} /> : <Icon.box size={15} />}</span>
                <span className="bo-outliner__name">{o.name || o.id}</span>
                {o.reference && (
                  <span className="bo-tag bo-tag--accent" title="Objet de référence">
                    réf.
                  </span>
                )}
                <span className="bo-tag">{o.material}</span>
              </button>
              <button
                type="button"
                className="bo-outliner__eye"
                aria-label={o.visible === false ? 'Afficher' : 'Masquer'}
                title={o.visible === false ? 'Afficher' : 'Masquer'}
                onClick={() => setVisible(o, o.visible === false)}
              >
                {o.visible === false ? <Icon.close size={15} /> : <Icon.eye size={15} />}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {selected && (
        <Section title={selected.name || selected.id} icon={<Icon.frame size={16} />}>
          <div className="bo-inspector">
            <label className="bo-field">
              <span className="bo-field__label">Nom</span>
              <input className="bo-input" value={selected.name ?? ''} onChange={(e) => patchObject(selected.id, { name: e.currentTarget.value })} />
            </label>
            <div className="bo-field">
              <span className="bo-field__label">{isTiled(selected) ? 'Ensemble tuilé (manifeste)' : 'Fichier'}</span>
              <code className="bo-code">{isTiled(selected) ? selected.manifest : selected.file}</code>
            </div>
            <label className="bo-field">
              <span className="bo-field__label">Matériau</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <select className="bo-input" value={selected.material} onChange={(e) => patchObject(selected.id, { material: e.currentTarget.value })}>
                  {Object.keys(materials).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <Button icon={<Icon.layout size={15} />} title="Modifier ce matériau" onClick={() => setMat(selected.material)} />
              </span>
            </label>

            {!isTiled(selected) && (
              <div className="bo-field">
                <span className="bo-field__label">Placement (en plus de celui du fichier)</span>
                {selected.reference && (
                  <p className="bo-warn">
                    Objet de référence : le déplacer décale aussi le centre, le sol et le focus, mais pas les points déjà placés (visite,
                    carte).
                  </p>
                )}
                <span className="bo-field__hint">Position (m)</span>
                <XYZ value={t.position as Vec3} onChange={(p) => setTransform(selected, { ...t, position: p })} />
                <span className="bo-field__hint">Rotation (°)</span>
                <XYZ value={t.rotation as Vec3} onChange={(r) => setTransform(selected, { ...t, rotation: r })} />
                <span className="bo-field__hint">Échelle</span>
                <XYZ value={t.scale as Vec3} onChange={(sc) => setTransform(selected, { ...t, scale: sc })} />
                <div className="bo-row">
                  <Button on={gizmo === 'translate'} icon={<Icon.move size={15} />} disabled={!viewer?.editor} onClick={() => toggleGizmo(selected, 'translate')}>
                    Déplacer
                  </Button>
                  <Button on={gizmo === 'rotate'} icon={<Icon.rotate size={15} />} disabled={!viewer?.editor} onClick={() => toggleGizmo(selected, 'rotate')}>
                    Tourner
                  </Button>
                  <Button on={gizmo === 'scale'} icon={<Icon.frame size={15} />} disabled={!viewer?.editor} onClick={() => toggleGizmo(selected, 'scale')}>
                    Échelle
                  </Button>
                  <Button variant="ghost" icon={<Icon.undo size={15} />} title="Réinitialiser le placement" onClick={() => setTransform(selected, IDENTITY)} />
                </div>
              </div>
            )}

            <div className="bo-field">
              <span className="bo-field__label">Rôle dans la scène</span>
              <Toggle
                label="Objet de référence"
                hint="Sa boîte donne le centre, le sol et le focus"
                checked={!!selected.reference}
                onChange={(v) => v && setObjects((list) => list.map((o) => ({ ...o, reference: o.id === selected.id ? true : undefined })))}
              />
              <Toggle label="Pointage" hint="« Pointer sur le scan » vise cet objet" checked={!!selected.pick} onChange={(v) => patchObject(selected.id, { pick: v || undefined })} />
              {!isTiled(selected) && (
                <Toggle
                  label="Fusionner les maillages"
                  hint="Plus rapide à afficher ; s'applique à l'enregistrement"
                  checked={!!selected.merge}
                  onChange={(v) => patchObject(selected.id, { merge: v } as Partial<SceneObject>)}
                />
              )}
            </div>
            <div className="bo-field">
              <span className="bo-field__label">Carte</span>
              {(
                [
                  ['views', 'Vues de la carte (plan, murs, plafonds)'],
                  ['plan', 'Calque du plan'],
                  ['minimap', 'Mini-carte de la visite'],
                ] as const
              ).map(([k, label]) => (
                <Toggle
                  key={k}
                  label={label}
                  checked={!!selected.map?.[k]}
                  onChange={(v) => {
                    const map = { ...selected.map, [k]: v || undefined };
                    const clean = Object.fromEntries(Object.entries(map).filter(([, x]) => x));
                    patchObject(selected.id, { map: Object.keys(clean).length ? clean : undefined });
                  }}
                />
              ))}
            </div>
          </div>
        </Section>
      )}

      <Section
        title="Matériaux"
        icon={<Icon.layout size={16} />}
        actions={
          <Button variant="ghost" icon={<Icon.plus size={15} />} title="Nouveau matériau" onClick={addMaterial} />
        }
      >
        <div className="bo-chips">
          {Object.keys(materials).map((k) => (
            <button key={k} type="button" className={`bo-chip-btn${k === mat ? ' is-on' : ''}`} onClick={() => setMat(k === mat ? null : k)}>
              {k}
              <small>{usage[k] ?? 0}</small>
            </button>
          ))}
        </div>
        {mat && m && (
          <div className="bo-inspector">
            <label className="bo-field">
              <span className="bo-field__label">Nom</span>
              <input
                className="bo-input"
                defaultValue={mat}
                key={mat}
                onBlur={(e) => renameMaterial(mat, e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              />
            </label>
            <Toggle label="Sans ombrage (unlit)" hint="Texture affichée telle quelle (éclairage déjà cuit)" checked={m.unlit !== false} onChange={(v) => patchMaterial(mat, { unlit: v })} />
            <Toggle label="Double face" checked={!!m.doubleSided} onChange={(v) => patchMaterial(mat, { doubleSided: v || undefined })} />
            <Toggle
              label="Découpe"
              hint="Voir à travers les murs ; faces arrière remplies de la couleur de coupe"
              checked={!!m.cutaway}
              onChange={(v) => patchMaterial(mat, { cutaway: v || undefined })}
            />
            <Toggle label="Remplissage de coupe" hint="Couleur de coupe unie, sans texture (tranche)" checked={m.fill === 'coupe'} onChange={(v) => patchMaterial(mat, { fill: v ? 'coupe' : undefined })} />
            <Toggle label="Brume" hint="Se fond dans la brume au loin" checked={m.mist !== false} onChange={(v) => patchMaterial(mat, { mist: v })} />
            <label className="bo-field">
              <span className="bo-field__label">Réglage des couleurs (onglet Scène)</span>
              <select className="bo-input" value={m.grade ?? ''} onChange={(e) => patchMaterial(mat, { grade: (e.currentTarget.value || undefined) as MaterialDef['grade'] })}>
                <option value="">Aucun</option>
                <option value="clay">Maquettes (clay)</option>
                <option value="scan">Scan</option>
              </select>
            </label>
            <div className="bo-row">
              <span className="bo-field__hint">
                Utilisé par {usage[mat] ?? 0} objet{(usage[mat] ?? 0) > 1 ? 's' : ''}
              </span>
              <span style={{ flex: 1 }} />
              <Button
                variant="ghost"
                icon={<Icon.trash size={15} />}
                title={usage[mat] ? 'Utilisé : impossible de le supprimer' : 'Supprimer ce matériau'}
                disabled={!!usage[mat]}
                onClick={() => {
                  setMaterials((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== mat)));
                  setMat(null);
                }}
              />
            </div>
          </div>
        )}
      </Section>

      <div className="bo-savebar">
        {status && <span className={`bo-pill ${status.kind === 'ok' ? 'is-ok' : status.kind === 'error' ? 'is-error' : 'is-busy'}`}>{status.text}</span>}
        {!status && dirty && <span className="bo-pill is-dirty">Structure modifiée</span>}
        <span style={{ flex: 1 }} />
        <Button variant="primary" icon={<Icon.upload size={15} />} disabled={!dirty || status?.kind === 'busy'} onClick={save}>
          Enregistrer la structure
        </Button>
      </div>
      <p className="bo-field__hint" style={{ margin: '0 16px 16px' }}>
        Enregistre scene.json (en local). Les matériaux et la fusion s’appliquent au rechargement de l’aperçu : publie d’abord tes
        modifications de contenu en cours.
      </p>
    </div>
  );
}
