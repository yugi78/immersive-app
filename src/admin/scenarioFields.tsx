import { createUsePuck, type CustomField } from '@puckeditor/core';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { MODES, modeLabel, PASSAGES } from '../viewer/config/scenario';
import type { CutPreset, ModeId, Passage, PassageId, ScenarioConfig, ScenarioPoint, Vec3 } from '../viewer/config/types';
import { bridge, useViewer } from './bridge';
import { Slider, Switch } from './fields';
import { Icon } from './icons';
import { Button, GizmoButton, XYZ } from './tourFields';

/**
 * Onglet Expérience → « Scénario » :
 *   ACCUEIL   intro → boucle d'attente → premier mode (une fois, à l'arrivée)
 *   MODES     vue extérieure, visite guidée (visite à pied plus tard)
 *   PASSAGES  comment la caméra va d'un mode à l'autre (direct ou trajet)
 * Une seule valeur Puck (`scenario`), au format de content.json.
 */

type S = ScenarioConfig;
const usePuck = createUsePuck();
const sec = (msv: number) => Math.round(msv / 100) / 10;
const ms = (s: number) => Math.round(s * 1000);
const fmtS = (msv: number) => `${sec(msv).toLocaleString('fr-FR')} s`;

/** Choix exclusif (boutons segmentés). */
function Seg<T extends string>({ value, options, onChange, readOnly }: { value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; readOnly?: boolean }) {
  return (
    <div className="bo-seg bo-seg--block" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-on' : ''}
          disabled={readOnly || o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Carte : icône, titre, résumé ; interrupteur (élément optionnel) ; contenu dépliable. */
function Card(p: { icon: ReactNode; tone: string; title: string; summary: string; enabled?: boolean; onToggle?: (v: boolean) => void; soon?: boolean; readOnly?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const on = p.enabled ?? true;
  return (
    <section className={`bo-scn bo-step bo-step--${p.tone}${open && on ? ' is-open' : ''}${on ? '' : ' is-off'}`}>
      <header className="bo-scn__head bo-step__head">
        <button type="button" className="bo-step__toggle" aria-expanded={open} disabled={p.soon || !on || !p.children} onClick={() => setOpen(!open)}>
          <span className="bo-step__icon" aria-hidden="true">
            {p.icon}
          </span>
          <span className="bo-step__title">
            <b>{p.title}</b>
            <small>{p.summary}</small>
          </span>
        </button>
        {p.onToggle && (
          <label className="bo-scn__toggle">
            <input type="checkbox" role="switch" checked={on} disabled={p.readOnly} aria-label={`${p.title} : activer`} onChange={(e) => p.onToggle!(e.currentTarget.checked)} />
            <span className="bo-switch__track" aria-hidden="true" />
          </label>
        )}
        {on && p.children && (
          <span className="bo-step__chev" aria-hidden="true">
            {open ? <Icon.chevronUp size={16} /> : <Icon.chevronDown size={16} />}
          </span>
        )}
      </header>
      {open && on && p.children && <div className="bo-scn__body">{p.children}</div>}
    </section>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="bo-scn__section">
      <div className="bo-scn__sechead">
        <b>{title}</b>
        <small>{hint}</small>
      </div>
      {children}
    </div>
  );
}

/** Lien entre deux cartes de l'accueil. */
function Link({ text }: { text: string }) {
  return (
    <div className="bo-scn__link" aria-hidden="true">
      <span />
      <small>{text}</small>
    </div>
  );
}

/** Formes de découpe à cocher (bibliothèque de l'onglet Rendu) ; un cylindre et une sphère au plus. */
function CutPicker({ label, value, presets, onChange, readOnly }: { label: string; value: string[]; presets: CutPreset[]; onChange: (ids: string[]) => void; readOnly?: boolean }) {
  return (
    <div className="bo-cutpick">
      <span>{label}</span>
      <div>
        {presets.length === 0 && <small className="bo-scn__hint">Aucune forme : créez-en dans Rendu → Découpes.</small>}
        {presets.map((p) => {
          const on = value.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={`bo-cutchip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              disabled={readOnly}
              onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value.filter((x) => presets.find((q) => q.id === x)?.kind !== p.kind), p.id])}
              title={p.kind === 'cylinder' ? 'Cylindre vers le point regardé' : 'Sphère autour de la caméra'}
            >
              <span className={`bo-cutdot bo-cutdot--${p.kind}`} aria-hidden="true" />
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Points de la boucle d'attente (position + point regardé + durée), réordonnables. */
function LoopPoints({ points, onChange, readOnly }: { points: ScenarioPoint[]; onChange: (p: ScenarioPoint[]) => void; readOnly?: boolean }) {
  const viewer = useViewer();
  const [drag, setDrag] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const set = (i: number, patch: Partial<ScenarioPoint>) => onChange(points.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= points.length || from === to) return;
    const next = [...points];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    onChange(next);
  };
  const fromCamera = (): Pick<ScenarioPoint, 'position' | 'target'> | null => {
    const pose = viewer?.view.pose();
    return pose ? { position: pose.position, target: pose.target } : null;
  };
  return (
    <div className="bo-scn__points">
      {points.map((p, i) => (
        <div
          key={i}
          className={`bo-item${drag === i ? ' is-drag' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag !== null) move(drag, i);
            setDrag(null);
          }}
        >
          <div className="bo-item__head">
            <span className="bo-item__handle">
              <span
                className="bo-grip"
                draggable={!readOnly}
                title="Glisser pour changer l'ordre"
                onDragStart={(e) => {
                  setDrag(i);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDrag(null)}
              >
                <Icon.grip size={16} />
              </span>
              <span className="bo-num bo-num--loop">{i + 1}</span>
              <label className="bo-mini" title={i === 0 ? 'Durée pour revenir du dernier point à celui-ci (fermeture de la boucle)' : 'Durée pour venir du point précédent'}>
                {i === 0 ? 'retour en' : 'en'}
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={sec(p.durationMs)}
                  disabled={readOnly}
                  onChange={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (Number.isFinite(n) && n > 0) set(i, { durationMs: ms(n) });
                  }}
                />
                s
              </label>
            </span>
            <span className="bo-scn__actions">
              <GizmoButton markerKey={`scn:loop:${i}`} label="" onMove={(position) => set(i, { position })} />
              <Button variant="ghost" icon={<Icon.camera size={15} />} title="Remplacer par la vue actuelle de la caméra" disabled={readOnly || !viewer} onClick={() => {
                const pose = fromCamera();
                if (pose) set(i, pose);
              }} />
              <Button variant="ghost" icon={<Icon.eye size={15} />} title="Placer la caméra sur ce point" disabled={!viewer} onClick={() => viewer?.view.setPose(p.position, p.target)} />
              <Button variant="ghost" icon={open === i ? <Icon.chevronUp size={15} /> : <Icon.chevronDown size={15} />} title="Coordonnées" onClick={() => setOpen(open === i ? null : i)} />
              <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer ce point" disabled={readOnly} onClick={() => onChange(points.filter((_, j) => j !== i))} />
            </span>
          </div>
          {open === i && (
            <div className="bo-scn__coords">
              <small>Position de la caméra</small>
              <XYZ value={p.position} onChange={(position: Vec3) => set(i, { position })} readOnly={readOnly} />
              <small>Point regardé</small>
              <XYZ value={p.target} onChange={(target: Vec3) => set(i, { target })} readOnly={readOnly} />
            </div>
          )}
        </div>
      ))}
      <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly || !viewer} onClick={() => {
        const pose = fromCamera();
        if (pose) onChange([...points, { ...pose, durationMs: points.at(-1)?.durationMs ?? 3000 }]);
      }}>
        Ajouter la vue actuelle
      </Button>
      {points.length < 3 && <p className="bo-scn__warn">Au moins 3 points pour former une boucle.</p>}
    </div>
  );
}

/** Points de passage d'un trajet, et son point regardé. `id` : clé des repères 3D (intro, orbit>tour…). */
function Waypoints(p: { id: string; waypoints: Vec3[]; look: Vec3 | null; endsOnNext: boolean; onChange: (v: { waypoints?: Vec3[]; look?: Vec3 | null }) => void; readOnly?: boolean; children?: ReactNode }) {
  const viewer = useViewer();
  const ed = viewer?.editor;
  const pts = p.waypoints;
  const latest = useRef(pts);
  latest.current = pts;
  const [drag, setDrag] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const focus = viewer ? (viewer.reference.focus.toArray().map((x) => Math.round(x * 100) / 100) as Vec3) : ([0, 0, 0] as Vec3);
  const look = p.look ?? focus;
  const set = (j: number, v: Vec3) => p.onChange({ waypoints: latest.current.map((x, k) => (k === j ? v : x)) });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= pts.length || from === to) return;
    const next = [...pts];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    ed?.detachGizmo();
    bridge.setGizmoKey(null);
    p.onChange({ waypoints: next });
  };
  const roleOf = (j: number) => (j === 0 ? 'Départ' : j === pts.length - 1 && !p.endsOnNext ? 'Arrivée' : 'Passage');
  return (
    <div className="bo-scn__points">
      {pts.map((w, j) => (
        <div
          key={j}
          className={`bo-item${drag === j ? ' is-drag' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag !== null) move(drag, j);
            setDrag(null);
          }}
        >
          <div className="bo-item__head">
            <span className="bo-item__handle">
              <span
                className="bo-grip"
                draggable={!p.readOnly}
                title="Glisser pour changer l'ordre"
                onDragStart={(e) => {
                  setDrag(j);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDrag(null)}
              >
                <Icon.grip size={16} />
              </span>
              <span className="bo-num bo-num--intro">{j + 1}</span>
              {roleOf(j)}
            </span>
            <span className="bo-scn__actions">
              <GizmoButton markerKey={`scn:${p.id}:${j}`} label="" onMove={(v) => set(j, v)} />
              <Button variant="ghost" icon={<Icon.camera size={15} />} title="Remplacer par la position actuelle de la caméra" disabled={p.readOnly || !ed} onClick={() => set(j, ed!.capture())} />
              <Button variant="ghost" icon={<Icon.eye size={15} />} title="Placer la caméra sur ce point (regard sur le point visé)" disabled={!viewer} onClick={() => viewer?.view.setPose(w, look)} />
              <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer ce point" disabled={p.readOnly} onClick={() => p.onChange({ waypoints: pts.filter((_, k) => k !== j) })} />
            </span>
          </div>
          <XYZ value={w} onChange={(v) => set(j, v)} readOnly={p.readOnly} />
        </div>
      ))}
      <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={p.readOnly || !ed} onClick={() => p.onChange({ waypoints: [...pts, ed!.capture()] })}>
        Capturer la position actuelle
      </Button>
      {p.children}
      <div className="bo-scn__sub">
        <b>Point regardé</b>
        <small>{p.look ? 'Repère R dans la vue 3D' : 'Le point de focus (centre de la vue extérieure)'}</small>
      </div>
      <XYZ value={look} onChange={(v) => p.onChange({ look: v })} readOnly={p.readOnly} />
      <div className="bo-scn__bar">
        <Button
          icon={<Icon.target size={15} />}
          on={picking}
          disabled={p.readOnly || !ed}
          title="Cliquer ensuite sur le scan dans la vue 3D (Échap : annuler)"
          onClick={async () => {
            setPicking(true);
            const v = await ed!.pick();
            setPicking(false);
            if (v) p.onChange({ look: v });
          }}
        >
          {picking ? 'Cliquez sur le scan…' : 'Pointer sur le scan'}
        </Button>
        <GizmoButton markerKey={`scn:${p.id}:look`} onMove={(v) => p.onChange({ look: v })} />
        {p.look && (
          <Button variant="ghost" title="Revenir au point de focus" disabled={p.readOnly} onClick={() => p.onChange({ look: null })}>
            Point de focus
          </Button>
        )}
      </div>
    </div>
  );
}

function ScenarioUI({ value, onChange, readOnly }: { value: S; onChange: (v: S) => void; readOnly?: boolean }) {
  const viewer = useViewer();
  const s = value;
  // Valeurs brutes (références stables), dérivées ensuite : un sélecteur qui crée un
  // nouveau tableau à chaque appel ferait boucler le rendu.
  const cutaway = usePuck((st) => st.appState.data.root?.props?.cutaway) as { presets?: CutPreset[] } | undefined;
  const tourWorks = usePuck((st) => st.appState.data.root?.props?.tourWorks) as { infos?: { title?: string } }[] | undefined;
  const presets = useMemo(() => cutaway?.presets ?? [], [cutaway]);
  const works = useMemo(() => (tourWorks ?? []).map((w, i) => w.infos?.title || `Œuvre ${i + 1}`), [tourWorks]);
  const patch = <K extends keyof S>(k: K, v: Partial<S[K]>) => onChange({ ...s, [k]: { ...(s[k] as object), ...v } } as S);
  const setPassage = (id: PassageId, v: Partial<Passage>) => onChange({ ...s, passages: { ...s.passages, [id]: { ...s.passages[id], ...v } } });
  const loopOk = s.loop.enabled && s.loop.points.length >= 3;
  const i = s.intro;
  const o = s.orbit;

  return (
    <div className="bo-scn__wrap">
      <div className="bo-scn__bar">
        <Button variant="primary" icon={<Icon.play size={15} />} disabled={!viewer} onClick={() => viewer?.scenario.replay()}>
          Jouer l’accueil
        </Button>
        <Button icon={<Icon.stop size={15} />} disabled={!viewer} title="Arrêter et revenir à la vue de départ" onClick={() => viewer?.scenario.goHome()}>
          Vue de départ
        </Button>
      </div>
      <p className="bo-scn__help">Repères dans la vue 3D : D (vue de départ), R (point regardé), trajets en violet, boucle en bleu-vert.</p>

      <Section title="Accueil" hint="Joué une fois à l’arrivée, dans cet ordre">
        <Card
          icon={<Icon.arrowRight size={15} />}
          tone="path"
          title="Intro"
          summary={i.enabled ? `${i.style === 'sky' ? 'Arrivée du ciel' : `${i.waypoints.length} point${i.waypoints.length > 1 ? 's' : ''}`} · ${fmtS(i.durationMs)}` : 'Désactivée'}
          enabled={i.enabled}
          onToggle={(enabled) => patch('intro', { enabled })}
          readOnly={readOnly}
        >
          <Seg
            value={i.style}
            readOnly={readOnly}
            onChange={(style) => patch('intro', { style })}
            options={[
              { value: 'sky', label: 'Arrivée du ciel' },
              { value: 'points', label: 'Point par point' },
            ]}
          />
          <Slider label="Durée totale" min={0.5} max={30} step={0.1} unit="s" value={sec(i.durationMs)} readOnly={readOnly} onChange={(v) => patch('intro', { durationMs: ms(v) })} />
          {i.style === 'sky' ? (
            <>
              <Slider label="Hauteur de départ (au-dessus du sol)" min={10} max={1000} step={5} value={i.startHeightAboveGround} readOnly={readOnly} onChange={(v) => patch('intro', { startHeightAboveGround: v })} />
              <Slider label="Distance de départ" min={10} max={2000} step={5} value={i.startDistance} readOnly={readOnly} onChange={(v) => patch('intro', { startDistance: v })} />
              <Slider label="Arc parcouru autour du bâtiment" min={-360} max={360} step={1} unit="°" value={i.sweepDeg} readOnly={readOnly} onChange={(v) => patch('intro', { sweepDeg: v })} />
              <p className="bo-scn__help">Descend du ciel en tournant autour du point de focus et finit sur la vue de départ (repère D).</p>
            </>
          ) : (
            <Waypoints id="intro" waypoints={i.waypoints} look={i.look} endsOnNext={i.endAtNext} readOnly={readOnly} onChange={(v) => patch('intro', v)}>
              <Switch
                label="Arriver sur le départ de la suite"
                hint="La boucle d’attente, ou la vue de départ (repère D), sans raccord"
                value={i.endAtNext}
                readOnly={readOnly}
                onChange={(endAtNext) => patch('intro', { endAtNext })}
              />
            </Waypoints>
          )}
          <Switch label="Le visiteur peut l’interrompre" hint="Il arrive alors dans le premier mode, sur place" value={i.interruptible} readOnly={readOnly} onChange={(interruptible) => patch('intro', { interruptible })} />
          <CutPicker label="Découpe pendant l’intro" value={i.cut} presets={presets} readOnly={readOnly} onChange={(cut) => patch('intro', { cut })} />
        </Card>
        <Link text={`raccord ${fmtS(s.blend.durationMs)}`} />
        <Card
          icon={<Icon.rotate size={15} />}
          tone="loop"
          title="Boucle d’attente"
          summary={s.loop.enabled ? `${s.loop.points.length} points · jusqu’au premier geste` : 'Désactivée'}
          enabled={s.loop.enabled}
          onToggle={(enabled) => patch('loop', { enabled })}
          readOnly={readOnly}
        >
          <LoopPoints points={s.loop.points} readOnly={readOnly} onChange={(points) => patch('loop', { points })} />
          <CutPicker label="Découpe pendant la boucle" value={s.loop.cut} presets={presets} readOnly={readOnly} onChange={(cut) => patch('loop', { cut })} />
          <div className="bo-scn__bar">
            <Button icon={<Icon.play size={15} />} disabled={!viewer || !loopOk} onClick={() => viewer?.scenario.playLoop()}>
              Jouer la boucle
            </Button>
          </div>
          <p className="bo-scn__help">Revient aussi en vue extérieure après une inactivité, si vous le choisissez.</p>
        </Card>
        <Link text={`raccord ${fmtS(s.blend.durationMs)}`} />
        <label className="bo-cut__row bo-scn__first">
          <span>Puis le visiteur arrive dans</span>
          <select className="bo-input" value={s.firstMode} disabled={readOnly} onChange={(e) => onChange({ ...s, firstMode: e.currentTarget.value as ModeId })}>
            <option value="orbit">{modeLabel('orbit')}</option>
            <option value="tour">{modeLabel('tour')}</option>
          </select>
        </label>
        <div className="bo-scn__raccords">
          <Slider label="Durée des raccords" min={0} max={10} step={0.1} unit="s" value={sec(s.blend.durationMs)} readOnly={readOnly} onChange={(v) => patch('blend', { durationMs: ms(v) })} />
          <CutPicker label="Découpe pendant les raccords" value={s.blend.cut} presets={presets} readOnly={readOnly} onChange={(cut) => patch('blend', { cut })} />
        </div>
      </Section>

      <Section title="Modes" hint="Où se trouve le visiteur ; il en change avec les boutons">
        <Card
          icon={<Icon.move size={15} />}
          tone="control"
          title={modeLabel('orbit')}
          summary={`Orbite · inactivité : ${o.idle.action === 'none' ? 'rien' : o.idle.action === 'rotate' ? `rotation après ${fmtS(o.idle.afterMs)}` : `boucle après ${fmtS(o.idle.afterMs)}`}`}
        >
          <div className="bo-scn__sub">
            <b>Vue de départ</b>
            <small>Repère D ; aussi le retour en fin de visite</small>
          </div>
          <Slider label="Distance au point de focus" min={1} max={2000} step={1} value={o.start.distance} readOnly={readOnly} onChange={(distance) => patch('orbit', { start: { ...o.start, distance } })} />
          <Slider label="Direction (azimut)" min={-180} max={360} step={1} unit="°" value={o.start.azimuthDeg} readOnly={readOnly} onChange={(azimuthDeg) => patch('orbit', { start: { ...o.start, azimuthDeg } })} />
          <Slider label="Hauteur (élévation)" min={-89} max={89} step={1} unit="°" value={o.start.elevationDeg} readOnly={readOnly} onChange={(elevationDeg) => patch('orbit', { start: { ...o.start, elevationDeg } })} />
          <div className="bo-scn__bar">
            <Button icon={<Icon.camera size={15} />} disabled={readOnly || !viewer} title="Vue de départ = position actuelle de la caméra autour du focus" onClick={() => viewer && patch('orbit', { start: viewer.view.orbitStart() })}>
              Depuis la caméra
            </Button>
            <Button icon={<Icon.eye size={15} />} disabled={!viewer} onClick={() => viewer?.scenario.goHome()}>
              Aperçu
            </Button>
          </div>
          <Slider label="Distance minimale (zoom)" min={0.5} max={500} step={0.5} value={o.minDistance} readOnly={readOnly} onChange={(minDistance) => patch('orbit', { minDistance })} />
          <Slider label="Distance maximale (zoom)" min={5} max={5000} step={5} value={o.maxDistance} readOnly={readOnly} onChange={(maxDistance) => patch('orbit', { maxDistance })} />
          <div className="bo-scn__sub">
            <b>Sans interaction</b>
          </div>
          <Seg
            value={o.idle.action}
            readOnly={readOnly}
            onChange={(action) => patch('orbit', { idle: { ...o.idle, action } })}
            options={[
              { value: 'none', label: 'Rien' },
              { value: 'rotate', label: 'Rotation' },
              { value: 'loop', label: 'Boucle d’attente', disabled: !loopOk, title: loopOk ? undefined : 'Activez une boucle d’attente d’au moins 3 points' },
            ]}
          />
          {o.idle.action !== 'none' && <Slider label="Après" min={1} max={120} step={0.5} unit="s" value={sec(o.idle.afterMs)} readOnly={readOnly} onChange={(v) => patch('orbit', { idle: { ...o.idle, afterMs: ms(v) } })} />}
          {o.idle.action === 'rotate' && <Slider label="Vitesse de rotation" min={0.05} max={5} step={0.05} unit={null} value={o.autoRotateSpeed} readOnly={readOnly} onChange={(autoRotateSpeed) => patch('orbit', { autoRotateSpeed })} />}
          <CutPicker label="Découpe" value={o.cut} presets={presets} readOnly={readOnly} onChange={(cut) => patch('orbit', { cut })} />
        </Card>
        <Card icon={<Icon.route size={15} />} tone="tour" title={modeLabel('tour')} summary={`Bouton « Visite guidée » · ${works.length} œuvre${works.length > 1 ? 's' : ''}`}>
          <label className="bo-cut__row">
            <span>Œuvre de départ (en arrivant par l’accueil)</span>
            <select className="bo-input" value={s.tour.startWork} disabled={readOnly} onChange={(e) => patch('tour', { startWork: Number(e.currentTarget.value) })}>
              {works.map((w, k) => (
                <option key={k} value={k}>
                  {k + 1}. {w}
                </option>
              ))}
            </select>
          </label>
          <p className="bo-scn__help">Les œuvres, leurs parcours et les découpes de la visite se règlent dans l’onglet Œuvres.</p>
        </Card>
        {MODES.filter((m) => m.soon).map((m) => (
          <Card key={m.id} icon={<Icon.fly size={15} />} tone="soon" title={m.label} summary="Bientôt" soon enabled={false} />
        ))}
      </Section>

      <Section title="Passages" hint="Comment la caméra va d’un mode à l’autre">
        {PASSAGES.map((ps) => {
          const v = s.passages[ps.id];
          const toOrbit = ps.to === 'orbit';
          return (
            <Card
              key={ps.id}
              icon={<Icon.arrowRight size={15} />}
              tone="path"
              title={`${modeLabel(ps.from)} → ${modeLabel(ps.to)}`}
              summary={`${ps.hint} · ${v.kind === 'direct' ? 'direct' : `trajet ${v.waypoints.length} point${v.waypoints.length > 1 ? 's' : ''}, ${fmtS(v.durationMs)}`}`}
            >
              <Seg
                value={v.kind}
                readOnly={readOnly}
                onChange={(kind) => setPassage(ps.id, { kind })}
                options={[
                  { value: 'direct', label: 'Direct' },
                  { value: 'path', label: 'Trajet' },
                ]}
              />
              {v.kind === 'direct' ? (
                <p className="bo-scn__help">
                  Mouvement standard : {toOrbit ? 'sortie de la visite vers la vue de départ' : 'entrée de la visite vers la première œuvre'} (durée dans Œuvres → Transitions entre œuvres).
                </p>
              ) : (
                <>
                  <Slider label="Durée totale" min={0.5} max={30} step={0.1} unit="s" value={sec(v.durationMs)} readOnly={readOnly} onChange={(x) => setPassage(ps.id, { durationMs: ms(x) })} />
                  <p className="bo-scn__help">
                    Le trajet part de la caméra, passe par ces points
                    {toOrbit ? ' et arrive sur la vue de départ (repère D).' : ', puis la visite enchaîne vers l’œuvre choisie.'}
                  </p>
                  <Waypoints id={ps.id} waypoints={v.waypoints} look={v.look} endsOnNext={toOrbit} readOnly={readOnly} onChange={(x) => setPassage(ps.id, x)} />
                  <CutPicker label="Découpe pendant le trajet" value={v.cut} presets={presets} readOnly={readOnly} onChange={(cut) => setPassage(ps.id, { cut })} />
                </>
              )}
              <div className="bo-scn__bar">
                <Button icon={<Icon.play size={15} />} disabled={!viewer} onClick={() => viewer?.scenario.playPassage(ps.id)}>
                  Jouer ce passage
                </Button>
              </div>
            </Card>
          );
        })}
      </Section>
    </div>
  );
}

export const scenarioField: CustomField<S> = {
  type: 'custom',
  label: 'Scénario',
  render: ({ value, onChange, readOnly }) => <ScenarioUI value={value} onChange={onChange} readOnly={readOnly} />,
};

/**
 * Vue de contrôle (orbite, vol libre) : outil de configuration de l'expérience, dans une
 * boîte sombre repliée pour ne pas la confondre avec les réglages publiés. Découpe et
 * vitesse : préférences d'édition de ce navigateur (jamais publiées).
 */
function ObserverPanel({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const dispatch = usePuck((st) => st.dispatch);
  const cutaway = usePuck((st) => st.appState.data.root?.props?.cutaway) as { presets?: CutPreset[] } | undefined;
  const flySpeed = usePuck((st) => st.appState.data.root?.props?.flySpeed) as number | undefined;
  const flyCut = usePuck((st) => st.appState.data.root?.props?.observerCutFly) as string[] | undefined;
  const presets = useMemo(() => cutaway?.presets ?? [], [cutaway]);
  const setProp = (key: string, v: unknown) =>
    dispatch({ type: 'setData', data: (prev) => ({ ...prev, root: { ...prev.root, props: { ...(prev.root?.props ?? {}), [key]: v } } }) });
  return (
    <section className={`bo-observer${open ? ' is-open' : ''}`}>
      <button type="button" className="bo-observer__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <b>Vue de contrôle</b>
          <small>Outil de réglage : regarder l’expérience de l’extérieur (orbite, vol libre)</small>
        </span>
        {open ? <Icon.chevronUp size={16} /> : <Icon.chevronDown size={16} />}
      </button>
      {open && (
        <div className="bo-observer__body">
          <p>
            Dans la barre de l’aperçu, « Orbite » et « Vol libre » regardent l’expérience de l’extérieur : elle continue (sa caméra est dessinée en orange) et ses
            boutons restent actifs. « Expérience » revient à la vue du visiteur. Ces réglages restent dans ce navigateur et ne sont pas publiés.
          </p>
          <div className="bo-observer__mode">
            <b>Orbite</b>
            <small>On tourne autour d’un point : un cylindre ouvre les murs entre la caméra et ce point.</small>
            <CutPicker label="Découpe" value={value ?? []} presets={presets} onChange={onChange} />
          </div>
          <div className="bo-observer__mode">
            <b>Vol libre</b>
            <small>On traverse la scène : une sphère autour de la caméra efface murs et piliers.</small>
            <CutPicker label="Découpe" value={flyCut ?? []} presets={presets} onChange={(ids) => setProp('observerCutFly', ids)} />
            <Slider label="Vitesse (aussi à la molette)" min={0.2} max={30} step={0.1} unit="m/s" value={flySpeed ?? 3} onChange={(v) => setProp('flySpeed', v)} />
          </div>
        </div>
      )}
    </section>
  );
}

export const observerCutField: CustomField<string[]> = {
  type: 'custom',
  label: 'Vue de contrôle',
  render: ({ value, onChange }) => <ObserverPanel value={value} onChange={onChange} />,
};
