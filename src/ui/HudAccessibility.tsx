import { useEffect, useRef } from 'react';
import type { HudController, HudLayout, HudState } from '../game/createHud';
import { t } from '../game/i18n';

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
  const wasModal = useRef<'map' | 'journal' | null>(null);
  useEffect(() => {
    const current = layout.map ? 'map' : layout.book ? 'journal' : null;
    if (current && current !== wasModal.current)
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-hud-control="${current === 'map' ? 'map-close' : 'journal-close'}"]`,
        )
        ?.focus();
    else if (!current && wasModal.current)
      root.current
        ?.closest('.game-window')
        ?.querySelector<HTMLButtonElement>(
          wasModal.current === 'map'
            ? '.scene-accessibility [data-open-map="true"]'
            : '[data-hud-control="journal"]',
        )
        ?.focus();
    wasModal.current = current;
  }, [layout]);
  const panel = layout.map ?? layout.book;
  const controls = layout.controls.map((c) => (
    <button
      key={c.id}
      data-hud-control={c.id}
      data-inventory-id={c.itemId}
      data-image={c.image}
      aria-label={c.label}
      aria-pressed={c.pressed}
      aria-expanded={
        c.id === 'menu'
          ? hud.menu
          : c.id === 'map'
            ? Boolean(hud.map)
            : c.id === 'journal'
              ? hud.journal
              : c.expanded
      }
      disabled={c.disabled}
      style={{
        position: 'absolute',
        left:
          c.bounds.x -
          (panel?.x ??
            (c.itemId || c.id.startsWith('inventory-')
              ? layout.inventory.x
              : 0)),
        top:
          c.bounds.y -
          (panel?.y ??
            (c.itemId || c.id.startsWith('inventory-')
              ? layout.inventory.y
              : 0)),
        width: c.bounds.width,
        height: c.bounds.height,
        clipPath: c.polygon
          ? `polygon(${c.polygon.map((p) => `${p.x - c.bounds.x}px ${p.y - c.bounds.y}px`).join(',')})`
          : undefined,
      }}
      onKeyDown={(e) => {
        if (e.repeat && (e.key === 'Enter' || e.key === ' '))
          e.preventDefault();
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
      {panel ? (
        <section
          role="dialog"
          aria-label={t(layout.map ? 'Mapa lokácií' : 'Denník úloh')}
          aria-modal="true"
          style={{
            position: 'absolute',
            left: panel.x,
            top: panel.y,
            width: panel.width,
            height: panel.height,
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
          {layout.map ? (
            <h2>{t('Mapa okolia')}</h2>
          ) : (
            <>
              <h2>{t('Môj pochybný plán')}</h2>
              <ul aria-label={t('Zapísané úlohy')}>
                {(hud.content.tasks ?? [])
                  .filter((task) => Object.hasOwn(hud.state.tasks, task.id))
                  .map((task) => (
                    <li
                      key={task.id}
                      data-task-id={task.id}
                      data-status={hud.state.tasks[task.id]}
                    >
                      <span className="sr-only">
                        {t(
                          hud.state.tasks[task.id] === 'completed'
                            ? 'Splnené:'
                            : 'Aktívne:',
                        )}{' '}
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
                <p>{t('Zatiaľ nemám nič zapísané.')}</p>
              )}
            </>
          )}
        </section>
      ) : (
        <div
          role="group"
          aria-label={t('Inventár')}
          aria-disabled={Boolean(
            hud.state.dialogue || hud.menu || hud.journal || hud.map,
          )}
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
      {!panel &&
        controls.filter(
          (_, i) =>
            !layout.controls[i]!.itemId &&
            !layout.controls[i]!.id.startsWith('inventory-'),
        )}
    </div>
  );
}
