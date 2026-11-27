import type { CustomField } from '@puckeditor/core';
import { useState } from 'react';
import { componentOf, UI_ELEMENTS, type ComponentKind, type DesignComponent, type DesignConfig } from '../viewer/config/design';
import { bridge, useUiSelected, useUiSelectMode } from './bridge';
import { Icon } from './icons';
import { Button } from './tourFields';

/**
 * Onglet « Design UI » : le design de l'interface publique.
 * - Rien de sélectionné : les STYLES (couleurs, arrondis) et les COMPOSANTS.
 * - Un élément sélectionné (clic dans l'aperçu en mode sélection) : son texte, son
 *   composant, puis le composant lui-même (modifié pour tous les éléments qui l'utilisent).
 * Une seule valeur Puck (`design`), au format de content.json.
 */

type D = DesignConfig;
const KIND_LABEL: Record<ComponentKind, string> = { button: 'Bouton', panel: 'Panneau', thumb: 'Vignette' };
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 7)}`;
const radiusLabel = (v: number) => (v >= 999 ? 'pilule' : `${v} px`);

function ColorSelect({ value, design, onChange, allowNone, readOnly }: { value: string; design: D; onChange: (id: string) => void; allowNone?: boolean; readOnly?: boolean }) {
  const c = design.colors.find((x) => x.id === value);
  return (
    <span className="bo-ds__select">
      <i className="bo-ds__swatch" style={{ background: c?.value ?? 'transparent' }} aria-hidden="true" />
      <select className="bo-input" value={value} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.value)}>
        {allowNone && <option value="">Aucune</option>}
        {design.colors.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Réglages d'un composant (fond, texte et icône, arrondi). */
function ComponentEditor({ id, design, onChange, readOnly }: { id: string; design: D; onChange: (v: D) => void; readOnly?: boolean }) {
  const c = design.components[id];
  if (!c) return null;
  const set = (patch: Partial<DesignComponent>) => onChange({ ...design, components: { ...design.components, [id]: { ...c, ...patch } } });
  const users = UI_ELEMENTS.filter((e) => componentOf(design, e.id) === id).map((e) => e.name);
  return (
    <div className="bo-ds__comp">
      <label className="bo-cut__row">
        <span>Nom</span>
        <input className="bo-input" value={c.name} disabled={readOnly} onChange={(e) => set({ name: e.currentTarget.value })} />
      </label>
      <label className="bo-cut__row">
        <span>Fond</span>
        <ColorSelect value={c.bg} design={design} allowNone readOnly={readOnly} onChange={(bg) => set({ bg })} />
      </label>
      <label className="bo-cut__row">
        <span>Texte et icône</span>
        <ColorSelect value={c.fg} design={design} readOnly={readOnly} onChange={(fg) => set({ fg })} />
      </label>
      <label className="bo-cut__row">
        <span>Arrondi</span>
        <select className="bo-input" value={c.radius} disabled={readOnly} onChange={(e) => set({ radius: e.currentTarget.value })}>
          {design.radii.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({radiusLabel(r.value)})
            </option>
          ))}
        </select>
      </label>
      <small className="bo-scn__hint">Utilisé par : {users.length ? users.join(', ') : 'aucun élément'}.</small>
    </div>
  );
}

/** Volet d'un élément sélectionné dans l'aperçu. */
function ElementPanel({ elementId, design, onChange, readOnly }: { elementId: string; design: D; onChange: (v: D) => void; readOnly?: boolean }) {
  const def = UI_ELEMENTS.find((e) => e.id === elementId);
  if (!def) return null;
  const el = design.elements[elementId] ?? {};
  const cmp = componentOf(design, elementId);
  const setEl = (patch: { component?: string; label?: string }) => onChange({ ...design, elements: { ...design.elements, [elementId]: { ...el, ...patch } } });
  const comps = Object.entries(design.components).filter(([, c]) => c.kind === def.kind);
  return (
    <div className="bo-scn__wrap">
      <div className="bo-ds__crumb">
        <button type="button" className="bo-ds__back" onClick={() => bridge.setUiSelected(null)}>
          Styles
        </button>
        <span aria-hidden="true">›</span>
        <b>{def.name}</b>
      </div>
      <section className="bo-scn">
        <header className="bo-scn__head">
          <span>
            <b>Cet élément</b>
            {def.hint && <small>{def.hint}</small>}
          </span>
        </header>
        <div className="bo-scn__body">
          {def.label !== undefined && (
            <label className="bo-cut__row">
              <span>Texte</span>
              <input className="bo-input" value={el.label ?? def.label} disabled={readOnly} onChange={(e) => setEl({ label: e.currentTarget.value })} />
            </label>
          )}
          <label className="bo-cut__row">
            <span>Composant</span>
            <select className="bo-input" value={cmp} disabled={readOnly} onChange={(e) => setEl({ component: e.currentTarget.value })}>
              {comps.map(([id, c]) => (
                <option key={id} value={id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="bo-scn__bar">
            <Button
              variant="dashed"
              icon={<Icon.plus size={15} />}
              disabled={readOnly}
              title="Crée un composant à partir de celui-ci, réservé à cet élément"
              onClick={() => {
                const src = design.components[cmp];
                if (!src) return;
                const id = newId('cmp');
                onChange({
                  ...design,
                  components: { ...design.components, [id]: { ...src, name: `${src.name} (${def.name})` } },
                  elements: { ...design.elements, [elementId]: { ...el, component: id } },
                });
              }}
            >
              Composant à part
            </Button>
          </div>
        </div>
      </section>
      <section className="bo-scn">
        <header className="bo-scn__head">
          <span>
            <b>Composant « {design.components[cmp]?.name ?? cmp} »</b>
            <small>Le modifier change tous les éléments qui l’utilisent</small>
          </span>
        </header>
        <div className="bo-scn__body">
          <ComponentEditor id={cmp} design={design} onChange={onChange} readOnly={readOnly} />
        </div>
      </section>
    </div>
  );
}

/** Styles (couleurs, arrondis) et composants : volet sans sélection. */
function StylesPanel({ design, onChange, readOnly }: { design: D; onChange: (v: D) => void; readOnly?: boolean }) {
  const [openCmp, setOpenCmp] = useState<string | null>(null);
  const colorUsed = (id: string) => Object.values(design.components).some((c) => c.bg === id || c.fg === id);
  const radiusUsed = (id: string) => Object.values(design.components).some((c) => c.radius === id);
  const setColor = (i: number, patch: Partial<D['colors'][number]>) => onChange({ ...design, colors: design.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setRadius = (i: number, patch: Partial<D['radii'][number]>) => onChange({ ...design, radii: design.radii.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="bo-scn__wrap">
      <div className="bo-scn__section">
        <div className="bo-scn__sechead">
          <b>Couleurs</b>
          <small>Partagées par les composants : changer « Noir » change tout ce qui est noir</small>
        </div>
        {design.colors.map((c, i) => (
          <div key={c.id} className="bo-ds__row">
            <label className="bo-color__swatch bo-ds__colorpick" style={{ background: c.value }}>
              <input type="color" value={c.value} disabled={readOnly} aria-label={`Couleur ${c.name}`} onChange={(e) => setColor(i, { value: e.currentTarget.value })} />
            </label>
            <input className="bo-input" value={c.name} disabled={readOnly} aria-label="Nom de la couleur" onChange={(e) => setColor(i, { name: e.currentTarget.value })} />
            <span className="bo-field__hint bo-mono">{c.value.toUpperCase()}</span>
            <Button
              variant="ghost"
              icon={<Icon.trash size={15} />}
              title={colorUsed(c.id) ? 'Utilisée par un composant' : 'Supprimer'}
              disabled={readOnly || colorUsed(c.id)}
              onClick={() => onChange({ ...design, colors: design.colors.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly} onClick={() => onChange({ ...design, colors: [...design.colors, { id: newId('c'), name: `Couleur ${design.colors.length + 1}`, value: '#888888' }] })}>
          Couleur
        </Button>
      </div>

      <div className="bo-scn__section">
        <div className="bo-scn__sechead">
          <b>Arrondis</b>
          <small>999 : bords entièrement arrondis (pilule)</small>
        </div>
        {design.radii.map((r, i) => (
          <div key={r.id} className="bo-ds__row">
            <input className="bo-input" value={r.name} disabled={readOnly} aria-label="Nom de l’arrondi" onChange={(e) => setRadius(i, { name: e.currentTarget.value })} />
            <label className="bo-mini">
              <input
                type="number"
                min={0}
                max={999}
                step={1}
                value={r.value}
                disabled={readOnly}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isFinite(n)) setRadius(i, { value: Math.max(0, Math.min(999, n)) });
                }}
              />
              px
            </label>
            <Button
              variant="ghost"
              icon={<Icon.trash size={15} />}
              title={radiusUsed(r.id) ? 'Utilisé par un composant' : 'Supprimer'}
              disabled={readOnly || radiusUsed(r.id)}
              onClick={() => onChange({ ...design, radii: design.radii.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly} onClick={() => onChange({ ...design, radii: [...design.radii, { id: newId('r'), name: `Arrondi ${design.radii.length + 1}`, value: 8 }] })}>
          Arrondi
        </Button>
      </div>

      <div className="bo-scn__section">
        <div className="bo-scn__sechead">
          <b>Composants</b>
          <small>Modèles réutilisés par les éléments de l’interface</small>
        </div>
        {Object.entries(design.components).map(([id, c]) => {
          const bg = design.colors.find((x) => x.id === c.bg)?.value;
          const fg = design.colors.find((x) => x.id === c.fg)?.value;
          const r = design.radii.find((x) => x.id === c.radius)?.value ?? 0;
          return (
            <section key={id} className={`bo-scn bo-step${openCmp === id ? ' is-open' : ''}`}>
              <header className="bo-scn__head bo-step__head">
                <button type="button" className="bo-step__toggle" aria-expanded={openCmp === id} onClick={() => setOpenCmp(openCmp === id ? null : id)}>
                  <span className="bo-ds__preview" style={{ background: bg ?? 'transparent', color: fg, borderRadius: Math.min(r, 14) }} aria-hidden="true">
                    Aa
                  </span>
                  <span className="bo-step__title">
                    <b>{c.name}</b>
                    <small>
                      {KIND_LABEL[c.kind]} · {design.colors.find((x) => x.id === c.bg)?.name ?? 'sans fond'} / {design.colors.find((x) => x.id === c.fg)?.name ?? '—'}
                    </small>
                  </span>
                </button>
                <span className="bo-step__chev" aria-hidden="true">
                  {openCmp === id ? <Icon.chevronUp size={16} /> : <Icon.chevronDown size={16} />}
                </span>
              </header>
              {openCmp === id && (
                <div className="bo-scn__body">
                  <ComponentEditor id={id} design={design} onChange={onChange} readOnly={readOnly} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DesignUI({ value, onChange, readOnly }: { value: D; onChange: (v: D) => void; readOnly?: boolean }) {
  const selected = useUiSelected();
  const selectMode = useUiSelectMode();
  return (
    <div className="bo-scn__wrap">
      <div className="bo-ds__select-bar">
        <Button variant={selectMode ? 'primary' : undefined} on={selectMode} icon={<Icon.target size={15} />} onClick={() => bridge.setUiSelectMode(!selectMode)}>
          {selectMode ? 'Sélection active : cliquez dans l’aperçu' : 'Sélectionner un élément'}
        </Button>
      </div>
      {selected ? <ElementPanel elementId={selected} design={value} onChange={onChange} readOnly={readOnly} /> : <StylesPanel design={value} onChange={onChange} readOnly={readOnly} />}
    </div>
  );
}

export const designField: CustomField<D> = {
  type: 'custom',
  label: 'Design',
  render: ({ value, onChange, readOnly }) => <DesignUI value={value} onChange={onChange} readOnly={readOnly} />,
};
