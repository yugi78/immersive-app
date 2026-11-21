import { FieldLabel, type CustomField } from '@puckeditor/core';

/** Champs Puck sur mesure, partagés par les onglets du back-office. */

/** Champ Puck « tirette + saisie numérique ». */
export function slider(label: string, min: number, max: number, step: number, unit: string | null = 'm'): CustomField<number> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, id }) => (
      <FieldLabel label={unit ? `${label} (${unit})` : label} readOnly={readOnly}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={readOnly}
            onChange={(e) => onChange(Number(e.currentTarget.value))}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={readOnly}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v)) onChange(v);
            }}
            style={{ width: 72 }}
          />
        </div>
      </FieldLabel>
    ),
  };
}

/** Champ Puck « case à cocher ». */
export function checkbox(label: string): CustomField<boolean> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, id }) => (
      <label htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600 }}>
        <input id={id} type="checkbox" checked={!!value} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.checked)} />
        {label}
      </label>
    ),
  };
}

/** Champ Puck « sélecteur de couleur ». */
export function colorField(label: string): CustomField<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }) => (
      <FieldLabel label={label} readOnly={readOnly}>
        <input type="color" value={value} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.value)} />
      </FieldLabel>
    ),
  };
}
