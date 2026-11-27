import { createUsePuck, type CustomField } from '@puckeditor/core';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { newStep, STEP_KINDS } from '../viewer/config/scenario';
import type { ControlStep, CutPreset, PathStep, ScenarioConfig, ScenarioPoint, ScenarioStep, StepKind, Vec3 } from '../viewer/config/types';
import { bridge, useViewer } from './bridge';
import { Slider, Switch } from './fields';
import { Icon } from './icons';
import { Button, GizmoButton, XYZ } from './tourFields';

/**
 * Onglet Expérience → « Scénario » : des ÉTAPES (trajet, boucle d'attente, prise en
 * main, visite guidée), chacune avec ses réglages, sa découpe et ses liens (à la fin,
 * si le visiteur touche, après une inactivité, sortie de la visite). Une seule valeur
 * Puck (`scenario`), au format de content.json.
 */

type S = ScenarioConfig;
const usePuck = createUsePuck();
const sec = (msv: number) => Math.round(msv / 100) / 10;
const ms = (s: number) => Math.round(s * 1000);
const fmtS = (msv: number) => `${sec(msv).toLocaleString('fr-FR')} s`;
const KIND_LABEL = Object.fromEntries(STEP_KINDS.map((k) => [k.kind, k.label])) as Record<StepKind, string>;
const KIND_ICON: Record<StepKind, ReactNode> = {
  path: <Icon.arrowRight size={15} />,
  loop: <Icon.rotate size={15} />,
  control: <Icon.move size={15} />,
  tour: <Icon.route size={15} />,
};

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

/** Menu « vers l'étape… » (liens entre étapes). */
function StepSelect({ label, hint, value, steps, self, onChange, readOnly, empty = 'Aucune (on reste ici)' }: { label: string; hint?: string; value: string; steps: ScenarioStep[]; self?: string; onChange: (id: string) => void; readOnly?: boolean; empty?: string }) {
  return (
    <label className="bo-cut__row">
      <span>
        {label}
        {hint && <small className="bo-scn__hint">{hint}</small>}
      </span>
      <select className="bo-input" value={value} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.value)}>
        <option value="">{empty}</option>
        {steps
          .filter((x) => x.id !== self)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · {KIND_LABEL[x.kind]}
            </option>
          ))}
      </select>
    </label>
  );
}

/** Formes de découpe à cocher (bibliothèque de l'onglet Rendu). */
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
              className={`bo-chip${on ? ' is-on' : ''}`}
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

/** Points d'une boucle (position + point regardé + durée), réordonnables. */
function LoopPoints({ stepId, points, onChange, readOnly }: { stepId: string; points: ScenarioPoint[]; onChange: (p: ScenarioPoint[]) => void; readOnly?: boolean }) {
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
              <GizmoButton markerKey={`scn:${stepId}:${i}`} label="" onMove={(position) => set(i, { position })} />
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

/** Trajet point par point : points de passage, point regardé, arrivée sur l'étape suivante. */
function Waypoints({ step: s, onChange, readOnly }: { step: PathStep; onChange: (v: Partial<PathStep>) => void; readOnly?: boolean }) {
  const viewer = useViewer();
  const ed = viewer?.editor;
  const pts = s.waypoints;
  const latest = useRef(pts);
  latest.current = pts;
  const [drag, setDrag] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const focus = viewer ? (viewer.reference.focus.toArray().map((x) => Math.round(x * 100) / 100) as Vec3) : ([0, 0, 0] as Vec3);
  const look = s.look ?? focus;
  const set = (j: number, v: Vec3) => onChange({ waypoints: latest.current.map((p, k) => (k === j ? v : p)) });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= pts.length || from === to) return;
    const next = [...pts];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    ed?.detachGizmo();
    bridge.setGizmoKey(null);
    onChange({ waypoints: next });
  };
  const roleOf = (j: number) => (j === 0 ? 'Départ' : j === pts.length - 1 && !s.endAtNext ? 'Arrivée' : 'Passage');
  return (
    <div className="bo-scn__points">
      {pts.map((p, j) => (
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
                draggable={!readOnly}
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
              <GizmoButton markerKey={`scn:${s.id}:${j}`} label="" onMove={(v) => set(j, v)} />
              <Button variant="ghost" icon={<Icon.camera size={15} />} title="Remplacer par la position actuelle de la caméra" disabled={readOnly || !ed} onClick={() => set(j, ed!.capture())} />
              <Button variant="ghost" icon={<Icon.eye size={15} />} title="Placer la caméra sur ce point (regard sur le point visé)" disabled={!viewer} onClick={() => viewer?.view.setPose(p, look)} />
              <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer ce point" disabled={readOnly} onClick={() => onChange({ waypoints: pts.filter((_, k) => k !== j) })} />
            </span>
          </div>
          <XYZ value={p} onChange={(v) => set(j, v)} readOnly={readOnly} />
        </div>
      ))}
      <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly || !ed} onClick={() => onChange({ waypoints: [...pts, ed!.capture()] })}>
        Capturer la position actuelle
      </Button>
      {pts.length === 0 && <p className="bo-scn__warn">Aucun point : le trajet passe directement à l’étape suivante.</p>}
      <Switch
        label="Arriver sur le départ de l’étape suivante"
        hint="Le trajet se termine là où commence l’étape suivante (repère D pour une prise en main), sans raccord"
        value={s.endAtNext}
        readOnly={readOnly}
        onChange={(endAtNext) => onChange({ endAtNext })}
      />
      <div className="bo-scn__sub">
        <b>Point regardé</b>
        <small>{s.look ? 'Repère R dans la vue 3D' : 'Le point de focus (centre de la vue extérieure)'}</small>
      </div>
      <XYZ value={look} onChange={(v) => onChange({ look: v })} readOnly={readOnly} />
      <div className="bo-scn__bar">
        <Button
          icon={<Icon.target size={15} />}
          on={picking}
          disabled={readOnly || !ed}
          title="Cliquer ensuite sur le scan dans la vue 3D (Échap : annuler)"
          onClick={async () => {
            setPicking(true);
            const v = await ed!.pick();
            setPicking(false);
            if (v) onChange({ look: v });
          }}
        >
          {picking ? 'Cliquez sur le scan…' : 'Pointer sur le scan'}
        </Button>
        <GizmoButton markerKey={`scn:${s.id}:look`} onMove={(v) => onChange({ look: v })} />
        {s.look && (
          <Button variant="ghost" title="Revenir au point de focus" disabled={readOnly} onClick={() => onChange({ look: null })}>
            Point de focus
          </Button>
        )}
      </div>
    </div>
  );
}

/** Résumé d'une étape (carte repliée). */
function summary(s: ScenarioStep, steps: ScenarioStep[]) {
  const name = (id: string) => steps.find((x) => x.id === id)?.name ?? 'première prise en main';
  switch (s.kind) {
    case 'path':
      return `${s.style === 'sky' ? 'Arrivée du ciel' : `${s.waypoints.length} point${s.waypoints.length > 1 ? 's' : ''}`} · ${fmtS(s.durationMs)} → ${name(s.onEnd)}`;
    case 'loop':
      return `${s.points.length} points · si on touche → ${name(s.onTouch)}`;
    case 'control':
      return `Orbite · inactivité : ${s.idle.action === 'none' ? 'rien' : s.idle.action === 'rotate' ? 'rotation' : `→ ${name(s.idle.step)}`}`;
    case 'tour':
      return `Œuvre ${s.startWork + 1} · sortie → ${name(s.exit)}`;
  }
}

function StepCard(p: {
  step: ScenarioStep;
  index: number;
  count: number;
  steps: ScenarioStep[];
  first: boolean;
  presets: CutPreset[];
  works: string[];
  open: boolean;
  onToggle: () => void;
  onChange: (s: ScenarioStep) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  readOnly?: boolean;
}) {
  const viewer = useViewer();
  const { step: s, steps, readOnly } = p;
  const set = (patch: Partial<ScenarioStep>) => p.onChange({ ...s, ...patch } as ScenarioStep);
  const playing = viewer?.scenario.stepId === s.id;
  return (
    <section className={`bo-scn bo-step bo-step--${s.kind}${p.open ? ' is-open' : ''}`}>
      <header className="bo-scn__head bo-step__head">
        <button type="button" className="bo-step__toggle" aria-expanded={p.open} onClick={p.onToggle}>
          <span className="bo-step__icon" aria-hidden="true">
            {KIND_ICON[s.kind]}
          </span>
          <span className="bo-step__title">
            <b>
              {s.name}
              {p.first && <em className="bo-step__badge">début</em>}
            </b>
            <small>
              {KIND_LABEL[s.kind]} · {summary(s, steps)}
            </small>
          </span>
        </button>
        <span className="bo-scn__actions">
          <Button variant="ghost" icon={<Icon.play size={15} />} on={playing} title="Jouer cette étape (et la suite)" disabled={!viewer} onClick={() => viewer?.scenario.playStep(s.id)} />
          <Button variant="ghost" icon={<Icon.chevronUp size={15} />} title="Monter" disabled={readOnly || p.index === 0} onClick={() => p.onMove(p.index - 1)} />
          <Button variant="ghost" icon={<Icon.chevronDown size={15} />} title="Descendre" disabled={readOnly || p.index === p.count - 1} onClick={() => p.onMove(p.index + 1)} />
          <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer cette étape" disabled={readOnly} onClick={p.onRemove} />
        </span>
      </header>
      {p.open && (
        <div className="bo-scn__body">
          <label className="bo-cut__row">
            <span>Nom</span>
            <input className="bo-input" value={s.name} disabled={readOnly} onChange={(e) => set({ name: e.currentTarget.value })} />
          </label>

          {s.kind === 'path' && (
            <>
              <Seg
                value={s.style}
                readOnly={readOnly}
                onChange={(style) => set({ style })}
                options={[
                  { value: 'sky', label: 'Arrivée du ciel' },
                  { value: 'points', label: 'Point par point' },
                ]}
              />
              <Slider label="Durée totale" min={0.5} max={30} step={0.1} unit="s" value={sec(s.durationMs)} readOnly={readOnly} onChange={(v) => set({ durationMs: ms(v) })} />
              {s.style === 'sky' ? (
                <>
                  <Slider label="Hauteur de départ (au-dessus du sol)" min={10} max={1000} step={5} value={s.startHeightAboveGround} readOnly={readOnly} onChange={(v) => set({ startHeightAboveGround: v })} />
                  <Slider label="Distance de départ" min={10} max={2000} step={5} value={s.startDistance} readOnly={readOnly} onChange={(v) => set({ startDistance: v })} />
                  <Slider label="Arc parcouru autour du bâtiment" min={-360} max={360} step={1} unit="°" value={s.sweepDeg} readOnly={readOnly} onChange={(v) => set({ sweepDeg: v })} />
                  <p className="bo-scn__help">Descend du ciel en tournant autour du point de focus et finit sur la vue de départ de l’étape suivante (si c’est une prise en main).</p>
                </>
              ) : (
                <Waypoints step={s} readOnly={readOnly} onChange={(v) => set(v)} />
              )}
            </>
          )}

          {s.kind === 'loop' && <LoopPoints stepId={s.id} points={s.points} readOnly={readOnly} onChange={(points) => set({ points })} />}

          {s.kind === 'control' && (
            <>
              <Seg
                value={s.mode}
                readOnly={readOnly}
                onChange={(mode) => set({ mode })}
                options={[
                  { value: 'orbit', label: 'Orbite' },
                  { value: 'firstPerson' as 'orbit', label: '1re personne', disabled: true, title: 'Bientôt' },
                ]}
              />
              <div className="bo-scn__sub">
                <b>Vue de départ</b>
                <small>Repère D dans la vue 3D</small>
              </div>
              <Slider label="Distance au point de focus" min={1} max={2000} step={1} value={s.start.distance} readOnly={readOnly} onChange={(distance) => set({ start: { ...s.start, distance } })} />
              <Slider label="Direction (azimut)" min={-180} max={360} step={1} unit="°" value={s.start.azimuthDeg} readOnly={readOnly} onChange={(azimuthDeg) => set({ start: { ...s.start, azimuthDeg } })} />
              <Slider label="Hauteur (élévation)" min={-89} max={89} step={1} unit="°" value={s.start.elevationDeg} readOnly={readOnly} onChange={(elevationDeg) => set({ start: { ...s.start, elevationDeg } })} />
              <div className="bo-scn__bar">
                <Button icon={<Icon.camera size={15} />} disabled={readOnly || !viewer} title="Vue de départ = position actuelle de la caméra autour du focus" onClick={() => viewer && set({ start: viewer.view.orbitStart() })}>
                  Depuis la caméra
                </Button>
              </div>
              <Slider label="Distance minimale (zoom)" min={0.5} max={500} step={0.5} value={s.minDistance} readOnly={readOnly} onChange={(minDistance) => set({ minDistance })} />
              <Slider label="Distance maximale (zoom)" min={5} max={5000} step={5} value={s.maxDistance} readOnly={readOnly} onChange={(maxDistance) => set({ maxDistance })} />
            </>
          )}

          {s.kind === 'tour' && (
            <label className="bo-cut__row">
              <span>Commencer par l’œuvre</span>
              <select className="bo-input" value={s.startWork} disabled={readOnly} onChange={(e) => set({ startWork: Number(e.currentTarget.value) })}>
                {p.works.map((w, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {w}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="bo-scn__sub">
            <b>Ensuite</b>
          </div>
          {s.kind === 'path' && (
            <>
              <StepSelect label="À la fin" value={s.onEnd} steps={steps} self={s.id} readOnly={readOnly} onChange={(onEnd) => set({ onEnd })} empty="Première prise en main" />
              <Switch label="Le visiteur peut l’interrompre" value={s.interruptible} readOnly={readOnly} onChange={(interruptible) => set({ interruptible })} />
              {s.interruptible && <StepSelect label="Si le visiteur touche" hint="Une prise en main démarre sur place" value={s.onTouch} steps={steps} self={s.id} readOnly={readOnly} onChange={(onTouch) => set({ onTouch })} empty="Première prise en main" />}
            </>
          )}
          {s.kind === 'loop' && <StepSelect label="Si le visiteur touche" hint="Une prise en main démarre sur place" value={s.onTouch} steps={steps} self={s.id} readOnly={readOnly} onChange={(onTouch) => set({ onTouch })} empty="Première prise en main" />}
          {s.kind === 'control' && (
            <>
              <span className="bo-scn__hint">Sans interaction pendant un moment :</span>
              <Seg
                value={s.idle.action}
                readOnly={readOnly}
                onChange={(action) => set({ idle: { ...s.idle, action } })}
                options={[
                  { value: 'none', label: 'Rien' },
                  { value: 'rotate', label: 'Rotation' },
                  { value: 'goto', label: 'Aller à…' },
                ]}
              />
              {s.idle.action !== 'none' && <Slider label="Après" min={1} max={120} step={0.5} unit="s" value={sec(s.idle.afterMs)} readOnly={readOnly} onChange={(v) => set({ idle: { ...s.idle, afterMs: ms(v) } })} />}
              {s.idle.action === 'rotate' && <Slider label="Vitesse de rotation" min={0.05} max={5} step={0.05} unit={null} value={s.autoRotateSpeed} readOnly={readOnly} onChange={(autoRotateSpeed) => set({ autoRotateSpeed })} />}
              {s.idle.action === 'goto' && <StepSelect label="Aller à" value={s.idle.step} steps={steps} self={s.id} readOnly={readOnly} onChange={(step) => set({ idle: { ...s.idle, step } })} />}
            </>
          )}
          {s.kind === 'tour' && <StepSelect label="Bouton de sortie (icône du monument)" value={s.exit} steps={steps} self={s.id} readOnly={readOnly} onChange={(exit) => set({ exit })} empty="Première prise en main" />}

          <div className="bo-scn__sub">
            <b>Découpe</b>
          </div>
          {s.kind !== 'tour' ? (
            <>
              <CutPicker label="Pendant l’étape" value={s.cut} presets={p.presets} readOnly={readOnly} onChange={(cut) => set({ cut })} />
              <CutPicker label="Pendant le raccord qui y mène" value={s.arriveCut} presets={p.presets} readOnly={readOnly} onChange={(arriveCut) => set({ arriveCut })} />
            </>
          ) : (
            <p className="bo-scn__help">La découpe de la visite (sur l’œuvre, entre deux œuvres) se règle dans l’onglet Œuvres. À l’entrée et à la sortie, c’est celle de l’étape de sortie qui s’éteint puis se rallume.</p>
          )}
        </div>
      )}
    </section>
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
  const [open, setOpen] = useState<string | null>(null);

  const setStep = (i: number, next: ScenarioStep) => onChange({ ...s, steps: s.steps.map((x, j) => (j === i ? next : x)) });
  const move = (from: number, to: number) => {
    const steps = [...s.steps];
    const [x] = steps.splice(from, 1);
    steps.splice(to, 0, x);
    onChange({ ...s, steps });
  };
  const remove = (i: number) => {
    const id = s.steps[i].id;
    const clear = (v: string) => (v === id ? '' : v);
    const steps = s.steps
      .filter((_, j) => j !== i)
      .map((x): ScenarioStep => {
        switch (x.kind) {
          case 'path':
            return { ...x, onEnd: clear(x.onEnd), onTouch: clear(x.onTouch) };
          case 'loop':
            return { ...x, onTouch: clear(x.onTouch) };
          case 'control':
            return { ...x, idle: { ...x.idle, step: clear(x.idle.step), action: x.idle.action === 'goto' && x.idle.step === id ? 'none' : x.idle.action } };
          case 'tour':
            return { ...x, exit: clear(x.exit) };
        }
      });
    onChange({ ...s, steps, first: s.first === id ? (steps[0]?.id ?? '') : s.first });
  };
  const add = (kind: StepKind) => {
    const st = newStep(kind);
    if (kind === 'control') {
      // Reprend la vue de départ actuelle de la caméra.
      const start = viewer?.view.orbitStart();
      if (start) (st as ControlStep).start = start;
    }
    onChange({ ...s, steps: [...s.steps, st], first: s.first || st.id });
    setOpen(st.id);
  };
  const hasTour = s.steps.some((x) => x.kind === 'tour');

  return (
    <div className="bo-scn__wrap">
      <div className="bo-scn__bar">
        <Button variant="primary" icon={<Icon.play size={15} />} disabled={!viewer} onClick={() => viewer?.scenario.replay()}>
          Jouer le scénario
        </Button>
        <Button icon={<Icon.stop size={15} />} disabled={!viewer} title="Arrêter et revenir à la première prise en main" onClick={() => viewer?.scenario.goHome()}>
          Arrêter
        </Button>
      </div>
      <p className="bo-scn__help">
        Le scénario enchaîne des étapes. Chacune dit où aller ensuite (à la fin, si le visiteur touche, après une inactivité). Repères dans la vue 3D : D (vue de
        départ), R (point regardé), trajets en violet, boucles en bleu-vert.
      </p>
      <StepSelect label="Commencer par" hint="Après l’écran de démarrage" value={s.first} steps={s.steps} readOnly={readOnly} onChange={(first) => onChange({ ...s, first })} empty="—" />

      <div className="bo-scn__steps">
        {s.steps.map((st, i) => (
          <StepCard
            key={st.id}
            step={st}
            index={i}
            count={s.steps.length}
            steps={s.steps}
            first={st.id === s.first}
            presets={presets}
            works={works}
            open={open === st.id}
            onToggle={() => setOpen(open === st.id ? null : st.id)}
            onChange={(next) => setStep(i, next)}
            onMove={(to) => move(i, to)}
            onRemove={() => remove(i)}
            readOnly={readOnly}
          />
        ))}
      </div>

      <div className="bo-scn__add">
        {STEP_KINDS.filter((k) => k.kind !== 'tour' || !hasTour).map((k) => (
          <Button key={k.kind} variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly} title={k.hint} onClick={() => add(k.kind)}>
            {k.label}
          </Button>
        ))}
      </div>

      <div className="bo-scn__foot">
        <Slider label="Durée des raccords entre étapes" min={0} max={10} step={0.1} unit="s" value={sec(s.blendMs)} readOnly={readOnly} onChange={(v) => onChange({ ...s, blendMs: ms(v) })} />
      </div>
    </div>
  );
}

export const scenarioField: CustomField<S> = {
  type: 'custom',
  label: 'Scénario',
  render: ({ value, onChange, readOnly }) => <ScenarioUI value={value} onChange={onChange} readOnly={readOnly} />,
};

