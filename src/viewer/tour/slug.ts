/** « La Mort de sainte Geneviève » → « la-mort-de-sainte-genevieve ». */
export function slugify(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // accents
      .toLowerCase()
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'oeuvre'
  );
}

/** Slugs dérivés des titres, rendus uniques dans l'ordre de la liste (« -2 », « -3 »…). */
export function uniqueSlugs(titles: string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((t) => {
    const base = slugify(t);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** Identifiant stable d'une nouvelle œuvre. */
export function newWorkId(): string {
  return `w-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}
