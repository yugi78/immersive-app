/** Icônes SVG de l'interface (trait = currentColor). */
const svg = (body: string, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  prev: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
  next: svg('<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>'),
  pause: svg('<path d="M9 5.5v13M15 5.5v13" stroke-width="2.6"/>'),
  play: svg('<path class="fill" d="M8 5.2v13.6L19 12z"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  grid: svg(
    '<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>',
  ),
  share: svg('<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5H7A2.5 2.5 0 0 0 4.5 13v4A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4a2.5 2.5 0 0 0-2.5-2.5h-1.5"/>'),
  arrowDownLeft: svg('<path d="M16.5 7.5l-9 9M7.5 9.5v7h7"/>'),
  /** Panthéon en perspective : dôme, tambour à colonnes, portique. */
  pantheon: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3v2.2M13.6 9.2a2.4 2.4 0 0 1 4.8 0M12.2 9.2h7.6v2.2h-7.6zM11 11.4h10l1 1.4H10z"/><path d="M11.4 12.8v4.6M14 12.8v4.6M16.6 12.8v4.6M19.2 12.8v4.6M21.4 12.8v4.6M10 17.4h13"/><path d="M3.5 20.5 10 17.4l13 0 5.5 3.1-6.5 3.4-12.5 0z"/><path d="M3.5 20.5v4.2l6 3.2h12.5l6.5-3.2v-4.2M9.5 24v3.9M22 24v3.9"/><path d="M15 6.2a1 1 0 1 1 2 0 1 1 0 0 1-2 0" class="fill"/></svg>`,
};
