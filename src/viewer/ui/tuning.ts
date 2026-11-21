/**
 * Panneau de réglage temporaire (dev uniquement) : tirettes branchées en direct
 * sur des uniforms. Sert à trouver les bonnes valeurs avant de les figer dans
 * scene.json (puis, à terme, dans le back-office).
 */
export interface TuningSlider {
  type?: 'range';
  label: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(v: number): void;
  unit?: string;
}

export interface TuningToggle {
  type: 'toggle';
  label: string;
  get(): boolean;
  set(v: boolean): void;
}

export type TuningControl = TuningSlider | TuningToggle;

export function createTuningPanel(container: HTMLElement, title: string, controls: TuningControl[]) {
  const panel = document.createElement('details');
  panel.className = 'pv-tuning';
  panel.open = true;
  panel.innerHTML = `<summary>${title}</summary>`;

  for (const c of controls) {
    if (c.type === 'toggle') {
      const row = document.createElement('label');
      row.className = 'pv-tuning__row pv-tuning__row--toggle';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = c.get();
      input.addEventListener('change', () => c.set(input.checked));
      const name = document.createElement('span');
      name.textContent = c.label;
      row.append(input, name);
      panel.appendChild(row);
      continue;
    }
    const row = document.createElement('label');
    row.className = 'pv-tuning__row';
    const name = document.createElement('span');
    name.textContent = c.label;
    const value = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    input.value = String(c.get());
    const show = () => (value.textContent = `${c.get()}${c.unit ?? ''}`);
    input.addEventListener('input', () => {
      c.set(Number(input.value));
      show();
    });
    show();
    row.append(name, value, input);
    panel.appendChild(row);
  }

  // Empêche les gestes sur le panneau de piloter l'orbite.
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  panel.addEventListener('wheel', (e) => e.stopPropagation());
  container.appendChild(panel);
  return panel;
}
