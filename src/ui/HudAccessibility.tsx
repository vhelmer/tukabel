import { useEffect, useRef } from 'react';
import type { HudController, HudLayout, HudState } from '../game/createHud';

// Semantic/keyboard mirror only: every visible pixel and all pointer interactions
// belong to Pixi. These transparent controls never intercept canvas pointers.
export function HudAccessibility({
  layout,
  hud,
  controller,
}: {
  layout: HudLayout;
  hud: HudState;
  controller: HudController | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const wasBook = useRef(false);
  useEffect(() => {
    if (layout.book && !wasBook.current)
      root.current
        ?.querySelector<HTMLButtonElement>('[data-hud-control="journal-close"]')
        ?.focus();
    else if (!layout.book && wasBook.current)
      root.current
        ?.querySelector<HTMLButtonElement>('[data-hud-control="journal"]')
        ?.focus();
    wasBook.current = Boolean(layout.book);
  }, [layout]);
  const controls = layout.controls.map((c) => (
    <button
      key={c.id}
      data-hud-control={c.id}
      data-inventory-id={c.itemId}
      data-image={c.image}
      aria-label={c.label}
      aria-pressed={c.pressed}
      aria-expanded={
        c.id === 'objects'
          ? hud.objectsOpen
          : c.id === 'menu'
            ? hud.menu
            : c.id === 'journal'
              ? hud.journal
              : c.expanded
      }
      disabled={c.disabled}
      style={{
        position: 'absolute',
        left:
          c.bounds.x -
          (layout.book?.x ??
            (c.itemId || c.id.startsWith('inventory-')
              ? layout.inventory.x
              : 0)),
        top:
          c.bounds.y -
          (layout.book?.y ??
            (c.itemId || c.id.startsWith('inventory-')
              ? layout.inventory.y
              : 0)),
        width: c.bounds.width,
        height: c.bounds.height,
      }}
      onClick={(e) => {
        if (e.detail === 0) controller?.activate(c.id);
      }}
      onFocus={() => controller?.focus(c.id)}
      onBlur={() => controller?.focus(null)}
    >
      {c.label}
    </button>
  ));
  return (
    <div
      className="hud-accessibility"
      ref={root}
      data-width={layout.width}
      data-height={layout.height}
    >
      {layout.book ? (
        <section
          role="dialog"
          aria-label="Denník úloh"
          aria-modal="true"
          style={{
            position: 'absolute',
            left: layout.book.x,
            top: layout.book.y,
            width: layout.book.width,
            height: layout.book.height,
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return;
            const buttons = root.current?.querySelectorAll<HTMLButtonElement>(
              'button:not(:disabled)',
            );
            if (!buttons?.length) return;
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }}
        >
          {controls}
          <h2>Môj pochybný plán</h2>
          <ul aria-label="Zapísané úlohy">
            {(hud.content.tasks ?? [])
              .filter((task) => Object.hasOwn(hud.state.tasks, task.id))
              .map((task) => (
                <li
                  key={task.id}
                  data-task-id={task.id}
                  data-status={hud.state.tasks[task.id]}
                >
                  <span className="sr-only">
                    {hud.state.tasks[task.id] === 'completed'
                      ? 'Splnené: '
                      : 'Aktívne: '}
                  </span>
                  {hud.state.tasks[task.id] === 'completed' ? (
                    <s>{task.text}</s>
                  ) : (
                    task.text
                  )}
                </li>
              ))}
          </ul>
          {!Object.keys(hud.state.tasks).length && (
            <p>Zatiaľ nemám nič zapísané.</p>
          )}
        </section>
      ) : (
        <div
          role="group"
          aria-label="Inventár"
          aria-disabled={Boolean(hud.state.dialogue || hud.menu || hud.journal)}
          style={{
            position: 'absolute',
            left: layout.inventory.x,
            top: layout.inventory.y,
            width: layout.inventory.width,
            height: layout.inventory.height,
          }}
        >
          {controls.filter(
            (_, i) =>
              layout.controls[i]!.itemId ||
              layout.controls[i]!.id.startsWith('inventory-'),
          )}
        </div>
      )}
      {!layout.book &&
        controls.filter(
          (_, i) =>
            !layout.controls[i]!.itemId &&
            !layout.controls[i]!.id.startsWith('inventory-'),
        )}
    </div>
  );
}
