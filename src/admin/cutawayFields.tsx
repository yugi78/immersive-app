import type { CustomField } from '@puckeditor/core';
import { useState } from 'react';
import { CUT_MOMENTS, newCutPreset } from '../viewer/config/cutaway';
import type { CutawayConfig, CutMoment, CutPreset } from '../viewer/config/types';
import { Slider } from './fields';
import { Icon } from './icons';
import { Button } from './tourFields';

/**
 * Onglet « Découpe » : les formes de découpe (cylindre vers le point regardé, sphère
 * autour de la caméra), nommées et réglables, puis la découpe de chaque moment de
 * l'expérience. Une seule valeur Puck (`cutaway`), au format de content.json.
 */

type C = CutawayConfig;

const newId = () => `d-${Math.random().toString(36).slice(2, 8)}`;

function KindSeg({ value, onChange, readOnly }: { value: CutPreset['kind']; onChange: (v: CutPreset['kind']) => void; readOnly?: boolean }) {
  const opts: { value: CutPreset['kind']; label: string }[] = [
    { value: 'cylinder', label: 'Cylindre' },
    { value: 'sphere', label: 'Sphère' },
  ];
  return (
    <div className="bo-seg bo-seg--block" role="radiogroup" aria-label="Forme">
      {opts.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : ''} disabled={readOnly} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PresetCard({ preset, usedBy, onChange, onRemove, readOnly }: { preset: CutPreset; usedBy: string[]; onChange: (p: CutPreset) => void; onRemove: () => void; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<CutPreset>) => onChange({ ...preset, ...patch });
  const cyl = preset.kind === 'cylinder';
  return (
    <div className="bo-item">
      <div className="bo-item__head">
        <span className="bo-item__handle">
          <span className={`bo-cutdot bo-cutdot--${preset.kind}`} aria-hidden="true" />
          <input className="bo-input bo-input--title" value={preset.name} disabled={readOnly} aria-label="Nom de la découpe" onChange={(e) => set({ name: e.currentTarget.value })} />
        </span>
        <span className="bo-scn__actions">
          <Button variant="ghost" icon={open ? <Icon.chevronUp size={15} /> : <Icon.chevronDown size={15} />} title={open ? 'Replier' : 'Régler'} onClick={() => setOpen(!open)} />
          <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer cette découpe" disabled={readOnly} onClick={onRemove} />
        </span>
      </div>
      <small className="bo-cut__used">
        {cyl ? `Cylindre ${preset.radius} m` : `Sphère ${preset.radius} m`} · {usedBy.length ? usedBy.join(', ') : 'non utilisée'}
      </small>
      {open && (
        <div className="bo-cut__body">
          <KindSeg value={preset.kind} readOnly={readOnly} onChange={(kind) => set({ kind })} />
          <p className="bo-scn__help">
            {cyl
              ? 'Efface les murs entre la caméra et le point regardé (vue de l’extérieur).'
              : 'Efface tout ce qui entoure la caméra (traverser murs et piliers).'}
          </p>
          <Slider label="Rayon" min={0.5} max={cyl ? 200 : 40} step={0.5} value={preset.radius} readOnly={readOnly} onChange={(radius) => set({ radius })} />
          <Slider label="Dégradé du bord" min={0} max={15} step={0.25} value={preset.feather} readOnly={readOnly} onChange={(feather) => set({ feather })} />
          {cyl && (
            <>
              <Slider label="Apparaît à partir de (distance au point regardé)" min={10} max={1500} step={5} value={preset.fadeStartDistance} readOnly={readOnly} onChange={(fadeStartDistance) => set({ fadeStartDistance })} />
              <Slider label="Pleine en dessous de" min={0} max={1500} step={5} value={preset.fadeEndDistance} readOnly={readOnly} onChange={(fadeEndDistance) => set({ fadeEndDistance })} />
              <Slider label="Sphère autour de la caméra (0 : aucune)" min={0} max={30} step={0.5} value={preset.cameraRadius} readOnly={readOnly} onChange={(cameraRadius) => set({ cameraRadius })} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CutawayUI({ value, onChange, readOnly }: { value: C; onChange: (v: C) => void; readOnly?: boolean }) {
  const c = value;
  const usedBy = (id: string) => CUT_MOMENTS.filter((m) => c.use[m.id] === id).map((m) => m.label);
  const setPreset = (i: number, p: CutPreset) => onChange({ ...c, presets: c.presets.map((x, j) => (j === i ? p : x)) });
  const remove = (i: number) => {
    const id = c.presets[i].id;
    const use = Object.fromEntries(Object.entries(c.use).map(([k, v]) => [k, v === id ? '' : v])) as C['use'];
    onChange({ ...c, presets: c.presets.filter((_, j) => j !== i), use });
  };
  const add = (kind: CutPreset['kind']) => {
    const n = c.presets.filter((p) => p.kind === kind).length + 1;
    onChange({ ...c, presets: [...c.presets, newCutPreset(kind, `${kind === 'cylinder' ? 'Cylindre' : 'Sphère'} ${n}`, newId())] });
  };
  const setUse = (m: CutMoment, id: string) => onChange({ ...c, use: { ...c.use, [m]: id } });

  return (
    <div className="bo-scn__wrap">
      <section className="bo-scn">
        <header className="bo-scn__head">
          <span>
            <b>Découpe de chaque moment</b>
            <small>Choisissez la forme utilisée à chaque moment de l’expérience</small>
          </span>
        </header>
        <div className="bo-scn__body">
          {CUT_MOMENTS.map((m) => (
            <label key={m.id} className="bo-cut__row">
              <span>{m.label}</span>
              <select className="bo-input" value={c.use[m.id] ?? ''} disabled={readOnly} onChange={(e) => setUse(m.id, e.currentTarget.value)}>
                <option value="">Aucune</option>
                {c.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Slider
            label="Transitions : apparition et disparition (part du trajet)"
            min={0.02}
            max={0.5}
            step={0.01}
            unit={null}
            value={c.transitFade}
            readOnly={readOnly}
            onChange={(transitFade) => onChange({ ...c, transitFade })}
          />
        </div>
      </section>

      <div className="bo-scn__sub" style={{ margin: '16px 0 8px' }}>
        <b>Formes de découpe</b>
        <small>Le cylindre efface les murs vers le point regardé, la sphère autour de la caméra.</small>
      </div>
      <div className="bo-scn__points">
        {c.presets.map((p, i) => (
          <PresetCard key={p.id} preset={p} usedBy={usedBy(p.id)} readOnly={readOnly} onChange={(np) => setPreset(i, np)} onRemove={() => remove(i)} />
        ))}
        <div className="bo-scn__bar">
          <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly} onClick={() => add('cylinder')}>
            Cylindre
          </Button>
          <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly} onClick={() => add('sphere')}>
            Sphère
          </Button>
        </div>
      </div>

      <label className="bo-field bo-color" style={{ marginTop: 16 }}>
        <span className="bo-color__swatch" style={{ background: c.cutColor }}>
          <input type="color" value={c.cutColor} disabled={readOnly} onChange={(e) => onChange({ ...c, cutColor: e.currentTarget.value })} />
        </span>
        <span className="bo-switch__text">
          <span className="bo-field__label">Couleur de coupe (épaisseur des murs)</span>
          <span className="bo-field__hint bo-mono">{c.cutColor.toUpperCase()}</span>
        </span>
      </label>
    </div>
  );
}

export const cutawayField: CustomField<C> = {
  type: 'custom',
  label: 'Découpe',
  render: ({ value, onChange, readOnly }) => <CutawayUI value={value} onChange={onChange} readOnly={readOnly} />,
};
