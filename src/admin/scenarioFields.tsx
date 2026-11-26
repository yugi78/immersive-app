import type { CustomField } from '@puckeditor/core';
import { useRef, useState, type ReactNode } from 'react';
import type { ScenarioConfig, ScenarioPoint, Vec3 } from '../viewer/config/types';
import { bridge, useViewer } from './bridge';
import { Slider, Switch } from './fields';
import { Icon } from './icons';
import { Button, GizmoButton, XYZ } from './tourFields';

/**
 * Onglet « Scénario » : l'ouverture de l'expérience, en cartes dans l'ordre où elles
 * se jouent (intro → boucle d'attente → prise en main → inactivité), reliées par des
 * raccords. Une seule valeur Puck (`scenario`), au format de content.json.
 */

type S = ScenarioConfig;
const sec = (ms: number) => Math.round(ms / 100) / 10;
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

/** Carte d'une étape : titre, interrupteur (si optionnelle), contenu replié quand elle est désactivée. */
function Card({ title, subtitle, enabled, onToggle, readOnly, children }: { title: string; subtitle: string; enabled?: boolean; onToggle?: (v: boolean) => void; readOnly?: boolean; children: ReactNode }) {
  const on = enabled ?? true;
  return (
    <section className={`bo-scn${on ? '' : ' is-off'}`}>
      <header className="bo-scn__head">
        <span>
          <b>{title}</b>
          <small>{subtitle}</small>
        </span>
        {onToggle && (
          <label className="bo-scn__toggle">
            <input type="checkbox" role="switch" checked={on} disabled={readOnly} aria-label={`${title} : activer`} onChange={(e) => onToggle(e.currentTarget.checked)} />
            <span className="bo-switch__track" aria-hidden="true" />
          </label>
        )}
      </header>
      {on && <div className="bo-scn__body">{children}</div>}
    </section>
  );
}

/** Raccord entre deux cartes. */
function Link({ text }: { text: string }) {
  return (
    <div className="bo-scn__link" aria-hidden="true">
      <span />
      <small>{text}</small>
    </div>
  );
}

/** Liste de points de caméra (position + point regardé + durée), réordonnable. */
function PointsList({ points, onChange, readOnly, closed, markerPrefix }: { points: ScenarioPoint[]; onChange: (p: ScenarioPoint[]) => void; readOnly?: boolean; closed?: boolean; markerPrefix?: string }) {
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
  const add = () => {
    const pose = fromCamera();
    if (!pose) return;
    onChange([...points, { ...pose, durationMs: points.length ? (points.at(-1)?.durationMs ?? 3000) : 3000 }]);
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
              <span className="bo-num">{i + 1}</span>
              {i === 0 && !closed ? (
                <span className="bo-scn__dur">départ</span>
              ) : (
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
              )}
            </span>
            <span className="bo-scn__actions">
              {markerPrefix && <GizmoButton markerKey={`${markerPrefix}${i}`} label="" onMove={(position) => set(i, { position })} />}
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
      <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly || !viewer} onClick={add}>
        Ajouter la vue actuelle
      </Button>
    </div>
  );
}

/**
 * Intro point par point : points de passage de la caméra (comme le parcours d'une
 * œuvre), un point regardé, une durée totale (ajouter des points ne l'allonge pas) et
 * l'arrivée, au choix sur le dernier point ou sur la vue de départ (repère D).
 */
function IntroWaypoints({ intro, onChange, readOnly }: { intro: S['intro']; onChange: (v: Partial<S['intro']>) => void; readOnly?: boolean }) {
  const viewer = useViewer();
  const ed = viewer?.editor;
  const pts = intro.waypoints;
  const latest = useRef(pts);
  latest.current = pts;
  const [drag, setDrag] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const focus = viewer ? (viewer.reference.focus.toArray().map((x) => Math.round(x * 100) / 100) as Vec3) : ([0, 0, 0] as Vec3);
  const look = intro.look ?? focus;
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
  const roleOf = (j: number) => (j === 0 ? 'Départ' : j === pts.length - 1 && !intro.endAtHome ? 'Arrivée' : 'Passage');

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
              <GizmoButton markerKey={`scn:intro:${j}`} label="" onMove={(v) => set(j, v)} />
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
      {pts.length === 0 && <p className="bo-scn__warn">Aucun point : l’intro démarre directement sur la vue de départ.</p>}

      <Switch
        label="Arriver sur la vue de départ"
        hint="Le trajet se termine sur la vue de départ de la prise en main (repère D), sans raccord"
        value={intro.endAtHome}
        readOnly={readOnly}
        onChange={(endAtHome) => onChange({ endAtHome })}
      />

      <div className="bo-scn__sub">
        <b>Point regardé</b>
        <small>{intro.look ? 'Repère R dans la vue 3D' : 'Le point de focus (centre de la vue extérieure)'}</small>
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
        <GizmoButton markerKey="scn:look" onMove={(v) => onChange({ look: v })} />
        {intro.look && (
          <Button variant="ghost" title="Revenir au point de focus" disabled={readOnly} onClick={() => onChange({ look: null })}>
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
  const patch = <K extends keyof S>(k: K, v: Partial<S[K]>) => onChange({ ...s, [k]: { ...(s[k] as object), ...v } } as S);
  const loopOk = s.loop.enabled && s.loop.points.length >= 3;
  const blend = `raccord ${fmtS(s.blendMs)}`;

  return (
    <div className="bo-scn__wrap">
      <div className="bo-scn__bar">
        <Button variant="primary" icon={<Icon.play size={15} />} disabled={!viewer} onClick={() => viewer?.scenario.replay()}>
          Jouer le scénario
        </Button>
        <Button icon={<Icon.stop size={15} />} disabled={!viewer} title="Arrêter et revenir à la vue de départ" onClick={() => viewer?.scenario.goHome()}>
          Vue de départ
        </Button>
      </div>
      <p className="bo-scn__help">
        Placez la caméra (orbite ou vol libre), puis ajoutez la position actuelle. Les repères du scénario s’affichent dans la vue 3D : D (vue de départ), R (point regardé), points de l’intro en violet, de la boucle en bleu-vert.
      </p>

      <Card
        title="Intro"
        subtitle="Jouée une fois à l’arrivée"
        enabled={s.intro.enabled}
        onToggle={(enabled) => patch('intro', { enabled })}
        readOnly={readOnly}
      >
        <Seg
          value={s.intro.kind}
          readOnly={readOnly}
          onChange={(kind) => patch('intro', { kind })}
          options={[
            { value: 'sky', label: 'Arrivée du ciel' },
            { value: 'points', label: 'Point par point' },
          ]}
        />
        <Slider label="Durée totale" min={0.5} max={30} step={0.1} unit="s" value={sec(s.intro.durationMs)} readOnly={readOnly} onChange={(v) => patch('intro', { durationMs: ms(v) })} />
        {s.intro.kind === 'sky' ? (
          <>
            <Slider label="Hauteur de départ (au-dessus du sol)" min={10} max={1000} step={5} value={s.intro.startHeightAboveGround} readOnly={readOnly} onChange={(v) => patch('intro', { startHeightAboveGround: v })} />
            <Slider label="Distance de départ" min={10} max={2000} step={5} value={s.intro.startDistance} readOnly={readOnly} onChange={(v) => patch('intro', { startDistance: v })} />
            <Slider label="Arc parcouru autour du bâtiment" min={-360} max={360} step={1} unit="°" value={s.intro.sweepDeg} readOnly={readOnly} onChange={(v) => patch('intro', { sweepDeg: v })} />
            <p className="bo-scn__help">Descend du ciel en tournant autour du point de focus et finit sur la vue de départ.</p>
          </>
        ) : (
          <IntroWaypoints intro={s.intro} readOnly={readOnly} onChange={(v) => patch('intro', v)} />
        )}
        <Switch label="Le visiteur peut l’interrompre" hint="Sinon la caméra reste pilotée jusqu’à la fin" value={s.intro.interruptible} readOnly={readOnly} onChange={(interruptible) => patch('intro', { interruptible })} />
      </Card>

      <Link text={blend} />

      <Card
        title="Boucle d’attente"
        subtitle="Jouée en boucle tant que personne ne touche"
        enabled={s.loop.enabled}
        onToggle={(enabled) => patch('loop', { enabled })}
        readOnly={readOnly}
      >
        <PointsList closed markerPrefix="scn:loop:" points={s.loop.points} readOnly={readOnly} onChange={(points) => patch('loop', { points })} />
        {s.loop.points.length < 3 && <p className="bo-scn__warn">Au moins 3 points pour former une boucle.</p>}
        <p className="bo-scn__help">Au moindre geste du visiteur, il prend la main sur place.</p>
      </Card>

      <Link text={blend} />

      <Card title="Prise en main" subtitle="Le visiteur pilote la caméra">
        <Seg
          value={s.control.mode}
          readOnly={readOnly}
          onChange={(mode) => patch('control', { mode })}
          options={[
            { value: 'orbit', label: 'Orbite' },
            { value: 'firstPerson' as 'orbit', label: '1re personne', disabled: true, title: 'Bientôt' },
          ]}
        />
        <div className="bo-scn__sub">
          <b>Vue de départ</b>
          <small>Aussi la vue de retour en fin de visite guidée</small>
        </div>
        <Slider label="Distance au point de focus" min={1} max={2000} step={1} value={s.control.start.distance} readOnly={readOnly} onChange={(distance) => patch('control', { start: { ...s.control.start, distance } })} />
        <Slider label="Direction (azimut)" min={-180} max={360} step={1} unit="°" value={s.control.start.azimuthDeg} readOnly={readOnly} onChange={(azimuthDeg) => patch('control', { start: { ...s.control.start, azimuthDeg } })} />
        <Slider label="Hauteur (élévation)" min={-89} max={89} step={1} unit="°" value={s.control.start.elevationDeg} readOnly={readOnly} onChange={(elevationDeg) => patch('control', { start: { ...s.control.start, elevationDeg } })} />
        <div className="bo-scn__bar">
          <Button icon={<Icon.camera size={15} />} disabled={readOnly || !viewer} title="Vue de départ = position actuelle de la caméra autour du focus" onClick={() => viewer && patch('control', { start: viewer.view.orbitStart() })}>
            Depuis la caméra
          </Button>
          <Button icon={<Icon.eye size={15} />} disabled={!viewer} onClick={() => viewer?.scenario.goHome()}>
            Aperçu
          </Button>
        </div>
        <div className="bo-scn__sub">
          <b>Limites du zoom</b>
        </div>
        <Slider label="Distance minimale" min={0.5} max={500} step={0.5} value={s.control.minDistance} readOnly={readOnly} onChange={(minDistance) => patch('control', { minDistance })} />
        <Slider label="Distance maximale" min={5} max={5000} step={5} value={s.control.maxDistance} readOnly={readOnly} onChange={(maxDistance) => patch('control', { maxDistance })} />
      </Card>

      <Link text="si personne ne touche" />

      <Card title="Inactivité" subtitle="Quand le visiteur ne touche plus à rien">
        <Seg
          value={s.idle.action}
          readOnly={readOnly}
          onChange={(action) => patch('idle', { action })}
          options={[
            { value: 'none', label: 'Rien' },
            { value: 'rotate', label: 'Rotation' },
            { value: 'loop', label: 'Retour boucle', disabled: !loopOk, title: loopOk ? undefined : 'Activez une boucle d’attente d’au moins 3 points' },
          ]}
        />
        {s.idle.action === 'loop' && !loopOk && <p className="bo-scn__warn">Sans boucle d’attente valide, rien ne se passe.</p>}
        {s.idle.action !== 'none' && (
          <Slider label="Après" min={1} max={120} step={0.5} unit="s" value={sec(s.idle.afterMs)} readOnly={readOnly} onChange={(v) => patch('idle', { afterMs: ms(v) })} />
        )}
        {s.idle.action === 'rotate' && (
          <Slider label="Vitesse de rotation" min={0.05} max={5} step={0.05} unit={null} value={s.control.autoRotateSpeed} readOnly={readOnly} onChange={(autoRotateSpeed) => patch('control', { autoRotateSpeed })} />
        )}
      </Card>

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
