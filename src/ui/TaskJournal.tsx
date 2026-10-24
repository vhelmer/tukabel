import type { GameContent, GameState } from '../game/types';
import { useButtonActivation } from './useButtonActivation';

export function NotebookIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M8 4 26 3l1 25-19 1Z"
        fill="currentColor"
        fillOpacity=".18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M11 4v24M5 8h6M5 14h6M5 20h6M5 26h6M15 10l8-1M15 15l7 1M15 21l6-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TaskJournal({
  content,
  state,
  onClose,
}: {
  content: GameContent;
  state: GameState;
  onClose: () => void;
}) {
  const closeButton = useButtonActivation(onClose);
  const entries = (content.tasks ?? []).filter(
    (task) =>
      state.tasks[task.id] === 'active' || state.tasks[task.id] === 'completed',
  );
  const remaining = entries.filter(
    (task) => state.tasks[task.id] === 'active',
  ).length;
  return (
    <div
      className="journal-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Denník úloh"
        className="task-journal"
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const controls = e.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="journal-heading">
          <div>
            <span className="journal-kicker">ZÁPISKY PRE PRÍPAD AMNÉZIE</span>
            <h2>Môj pochybný plán</h2>
          </div>
          <button autoFocus aria-label="Zavrieť denník" {...closeButton}>
            ×
          </button>
        </header>
        <p className="journal-count">
          {remaining
            ? 'Ešte vybaviť: ' + remaining
            : entries.length
              ? 'Všetko odškrtnuté. Zatiaľ.'
              : 'Čakám na prvý dobrý nápad.'}
        </p>
        <div className="journal-pages">
          {!entries.length ? (
            <p className="journal-empty">
              Zatiaľ nemám nič zapísané.
              <br />
              To je samo osebe podozrivé.
            </p>
          ) : (
            <ul aria-label="Zapísané úlohy">
              {entries.map((task) => {
                const done = state.tasks[task.id] === 'completed';
                return (
                  <li
                    key={task.id}
                    data-task-id={task.id}
                    data-status={state.tasks[task.id]}
                    className={done ? 'task-completed' : ''}
                  >
                    <span className="task-mark" aria-hidden="true">
                      {done ? '✓' : '○'}
                    </span>
                    <span className="sr-only">
                      {done ? 'Splnené: ' : 'Aktívne: '}
                    </span>
                    {done ? <s>{task.text}</s> : <span>{task.text}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="journal-footnote">
          Nestratiť. Nezjesť. Nezabudnúť.
        </footer>
      </section>
    </div>
  );
}
