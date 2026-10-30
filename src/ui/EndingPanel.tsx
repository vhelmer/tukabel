import { useEffect, useRef } from 'react';
import type { EndingDefinition } from '../game/types';
import './ending.css';
import { t } from '../game/i18n';

export function EndingPanel({
  ending,
  onMenu,
  onReset,
  onFinish,
}: {
  ending: EndingDefinition;
  onMenu: () => void;
  onReset: () => void;
  onFinish?: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [ending.id]);
  return (
    <div className="ending-overlay">
      <section
        ref={panel}
        className="ending-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ending.title}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls =
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <h1>Koniec</h1>
        <p>{ending.text}</p>
        <div className="ending-actions">
          <button onClick={onMenu}>{t('Menu a uložené hry')}</button>
          {onFinish ? (
            <button onClick={onFinish}>{t('Dokončiť hru')}</button>
          ) : (
            <button onClick={onReset}>{t('Nová hra')}</button>
          )}
        </div>
      </section>
    </div>
  );
}
