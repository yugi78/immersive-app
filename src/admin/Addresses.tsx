import { useEffect, useState } from 'react';
import { ONLINE } from '../config/brand';
import { Icon } from './icons';
import { activeProject, projectName } from './project';

/** Une adresse : libellé, explication, URL copiable et ouvrable. */
function Row({ label, hint, url }: { label: string; hint?: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Repli (contexte non sécurisé) : sélection d'un champ temporaire.
      const t = document.createElement('textarea');
      t.value = url;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="bo-addr">
      <div className="bo-addr__head">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="bo-addr__row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button type="button" className="bo-iconbtn" title={copied ? 'Copié' : 'Copier'} aria-label={`Copier : ${label}`} onClick={copy}>
          {copied ? <Icon.check /> : <Icon.copy />}
        </button>
        <a className="bo-iconbtn" href={url} target="_blank" rel="noopener" title="Ouvrir dans un nouvel onglet" aria-label={`Ouvrir : ${label}`}>
          <Icon.external />
        </a>
      </div>
    </div>
  );
}

/**
 * Adresses du projet à transmettre : site avec ou sans écran de démarrage, chaque
 * œuvre, espace client. Ouvert par le bouton « Adresses » et après chaque publication.
 */
export function AddressesDialog({ onClose, published }: { onClose: () => void; published?: boolean }) {
  const { slug, cfg } = activeProject();
  const site = `${ONLINE.site}/${slug}/`;
  const works = cfg.tour?.works ?? [];
  const [showWorks, setShowWorks] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="bo-modal" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bo-modal__card" role="dialog" aria-modal="true" aria-labelledby="bo-addr-title">
        <header className="bo-modal__head">
          <div>
            <h2 id="bo-addr-title">{published ? 'Publié' : 'Adresses du projet'}</h2>
            <p>{published ? 'Le site sera à jour d’ici 1 à 2 minutes, à ces adresses :' : `${projectName()} · à transmettre ou à intégrer`}</p>
          </div>
          <button type="button" className="bo-iconbtn" aria-label="Fermer" onClick={onClose}>
            <Icon.close />
          </button>
        </header>
        <div className="bo-modal__body">
          <Row label="Avec écran de démarrage" hint="Lien à partager" url={site} />
          <Row label="Accès direct" hint="Sans écran de démarrage (intégration, borne)" url={`${site}?direct`} />
          {works.length > 0 && (
            <div className="bo-addr">
              <button type="button" className="bo-addr__toggle" aria-expanded={showWorks} onClick={() => setShowWorks(!showWorks)}>
                {showWorks ? <Icon.chevronUp size={16} /> : <Icon.chevronDown size={16} />}
                Ouvrir directement une œuvre ({works.length})
              </button>
              {showWorks && works.map((w) => <Row key={w.id} label={w.title || w.slug} url={`${site}#${w.slug}`} />)}
            </div>
          )}
          <Row label="Espace client" hint="Connexion, modification du contenu" url={`${ONLINE.admin}/${slug}/admin/`} />
        </div>
      </div>
    </div>
  );
}
