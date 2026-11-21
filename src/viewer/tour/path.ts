import { CatmullRomCurve3, Vector3 } from 'three';

/** Accélération et décélération douces (vitesse nulle aux deux bouts). */
export const easeInOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

/**
 * Trajet de caméra : spline Catmull-Rom centripète (pas de boucle ni de
 * dépassement aux points serrés), parcourue à vitesse constante le long de la
 * courbe (getPointAt = abscisse curviligne).
 */
export class Path {
  private curve: CatmullRomCurve3 | null;
  private single: Vector3;

  /** `closed` : boucle fermée (dernier point → premier, sans arrêt). */
  constructor(points: Vector3[], closed = false) {
    // Points confondus retirés : ils donneraient une tangente nulle.
    const pts = points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]) > 1e-6);
    if (closed && pts.length > 2 && pts[pts.length - 1].distanceToSquared(pts[0]) < 1e-6) pts.pop();
    this.single = pts[0].clone();
    this.curve = pts.length >= 2 ? new CatmullRomCurve3(pts.map((p) => p.clone()), closed, 'centripetal') : null;
    // Plus d'échantillons pour un paramétrage par longueur précis sur les longs trajets.
    if (this.curve) this.curve.arcLengthDivisions = 400;
  }

  get length() {
    return this.curve?.getLength() ?? 0;
  }

  /** Point à la fraction `u` (0–1) de la longueur. */
  at(u: number, out = new Vector3()) {
    return this.curve ? this.curve.getPointAt(Math.min(Math.max(u, 0), 1), out) : out.copy(this.single);
  }

  /** Échantillons pour l'affichage (éditeur). */
  sample(n = 64) {
    return Array.from({ length: n + 1 }, (_, i) => this.at(i / n));
  }
}
