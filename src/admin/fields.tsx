import type { CustomField } from '@puckeditor/core';

/** Champs Puck sur mesure, partagés par les onglets du back-office (style : admin.css, bo-*). */

/** Nombre affiché avec la précision du pas (virgule française). */
const fmt = (v: number, step: number) => {
  const d = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d });
};

type SliderProps = { label: string; min: number; max: number; step: number; unit?: string | null; value: number; onChange: (v: number) => void; readOnly?: boolean; id?: string };

/** Curseur : libellé, valeur en pastille (modifiable), piste remplie. */
export function Slider({ label, min, max, step, unit = 'm', value, onChange, readOnly, id }: SliderProps) {
  const v = Number(value ?? min);
  const pct = ((Math.min(Math.max(v, min), max) - min) / (max - min || 1)) * 100;
  return (
    <div className="bo-field bo-slider">
      <div className="bo-field__row">
        <label htmlFor={id} className="bo-field__label">
          {label}
        </label>
        <span className="bo-valuepill">
          <input
            type="number"
            aria-label={`${label} (valeur)`}
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={readOnly}
            onChange={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n)) onChange(n);
            }}
            style={{ width: `${Math.max(fmt(v, step).length, 2) + 1}ch` }}
          />
          {unit && <span>{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        type="range"
        aria-label={id ? undefined : label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={{ ['--bo-fill' as string]: `${pct}%` }}
      />
    </div>
  );
}

/** Champ Puck « curseur ». */
export function slider(label: string, min: number, max: number, step: number, unit: string | null = 'm'): CustomField<number> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, id }) => (
      <Slider label={label} min={min} max={max} step={step} unit={unit} value={value} onChange={onChange} readOnly={readOnly} id={id} />
    ),
  };
}

type SwitchProps = { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; readOnly?: boolean; id?: string };

/** Interrupteur : libellé, aide, case à cocher en forme de bascule. */
export function Switch({ label, hint, value, onChange, readOnly, id }: SwitchProps) {
  return (
    <label htmlFor={id} className="bo-field bo-switch">
      <span className="bo-switch__text">
        <span className="bo-field__label">{label}</span>
        {hint && <span className="bo-field__hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={!!value} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span className="bo-switch__track" aria-hidden="true" />
    </label>
  );
}

/** Champ Puck « interrupteur » (case à cocher). */
export function checkbox(label: string, hint?: string): CustomField<boolean> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, id }) => <Switch label={label} hint={hint} value={value} onChange={onChange} readOnly={readOnly} id={id} />,
  };
}

/** Champ Puck « couleur » : pastille cliquable + code hexadécimal. */
export function colorField(label: string): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, id }) => (
      <label htmlFor={id} className="bo-field bo-color">
        <span className="bo-color__swatch" style={{ background: value }}>
          <input id={id} type="color" value={value} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.value)} />
        </span>
        <span className="bo-switch__text">
          <span className="bo-field__label">{label}</span>
          <span className="bo-field__hint bo-mono">{String(value ?? '').toUpperCase()}</span>
        </span>
      </label>
    ),
  };
}
