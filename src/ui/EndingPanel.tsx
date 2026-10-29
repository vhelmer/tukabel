import { useEffect, useRef } from 'react';
import type { EndingDefinition } from '../game/types';
import './ending.css';

export function EndingPanel({
  ending,
  onMenu,
  onReset,
}: {
  ending: EndingDefinition;
  onMenu: () => void;
  onReset: () => void;
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
        aria-labelledby="ending-title"
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
        <span className="ending-kicker">Záhada strateného kábla</span>
        <h1 id="ending-title">{ending.title}</h1>
        <p>{ending.text}</p>
        <span className="ending-finish">Koniec</span>
        <div className="ending-actions">
          <button onClick={onMenu}>Menu a uložené hry</button>
          <button onClick={onReset}>Nová hra</button>
        </div>
      </section>
    </div>
  );
}
