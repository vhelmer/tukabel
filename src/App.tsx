import { useCallback, useState } from 'react';
import { demoScene } from './game/scenes/demoScene';
import type { Hotspot } from './game/types';
import { GameCanvas } from './ui/GameCanvas';

const initialMessage =
  'Každá veľká záhada sa začína malým kliknutím. Vyskúšaj predmety v miestnosti.';

export function App() {
  const [hovered, setHovered] = useState<Hotspot | null>(null);
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [interactions, setInteractions] = useState(0);
  const [showHotspots, setShowHotspots] = useState(false);

  const interact = useCallback((hotspot: Hotspot) => {
    setSelected(hotspot);
    setInteractions((count) => count + 1);
  }, []);

  function reset() {
    setSelected(null);
    setHovered(null);
    setInteractions(0);
    setShowHotspots(false);
  }

  return (
    <main className="app">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↯
          </span>
          <span>TUKABEL</span>
        </div>
        <span className="build-badge">
          TECHNICKÉ DEMO <span aria-hidden="true">/</span> 001
        </span>
      </header>
      <section className="intro" aria-labelledby="game-title">
        <div>
          <p className="eyebrow">POINT & CLICK · SLOVENSKÝ CHAOS</p>
          <h1 id="game-title">
            Záhada strateného <em>kábla.</em>
          </h1>
          <p className="intro-copy">
            Veľké problémy. Malé predmety. Podozrivo veľa antén.
          </p>
        </div>
        <div className="location-note">
          <span className="status-dot" />
          {demoScene.title}
          <small>Jedna miestnosť. Tri klikateľné predmety.</small>
        </div>
      </section>
      <section className="game" aria-label="Interaktívna skúšobňa">
        <div className="scene-toolbar">
          <span>
            <span className="tiny-label">LOKÁCIA 00</span> / {demoScene.title}
          </span>
          <button
            className="hint-button"
            aria-pressed={showHotspots}
            onClick={() => setShowHotspots((value) => !value)}
          >
            {showHotspots ? 'Skryť predmety' : 'Ukázať predmety'}
            <span aria-hidden="true"> ↗</span>
          </button>
        </div>
        <GameCanvas
          scene={demoScene}
          hoveredId={hovered?.id ?? null}
          selectedId={selected?.id ?? null}
          showHotspots={showHotspots}
          onHover={setHovered}
          onInteract={interact}
        />
        <div className="interaction-panel">
          <div
            className="reaction"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="eyebrow">
              {selected
                ? `OBZERAŤ · ${selected.label.toUpperCase()}`
                : 'ROZHLIADNI SA'}
            </span>
            <p>{selected?.response ?? initialMessage}</p>
          </div>
          <div className="interaction-count">
            <strong>{String(interactions).padStart(2, '0')}</strong>
            <span>interakcií</span>
          </div>
        </div>
        <div className="object-controls" aria-label="Predmety v miestnosti">
          <span className="tiny-label">OBZERAŤ</span>
          {demoScene.hotspots.map((hotspot, index) => (
            <button
              key={hotspot.id}
              className={
                selected?.id === hotspot.id
                  ? 'object-button selected'
                  : 'object-button'
              }
              onClick={() => interact(hotspot)}
              onMouseEnter={() => setHovered(hotspot)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(hotspot)}
              onBlur={() => setHovered(null)}
            >
              <span className="object-number">0{index + 1}</span>
              {hotspot.label}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
          <button className="reset-button" onClick={reset}>
            Reset ukážky
          </button>
        </div>
      </section>
      <footer className="footer">
        <span>
          {hovered
            ? `Obzrieť: ${hovered.label}`
            : 'Klikni na predmet · alebo použi Tab a Enter'}
        </span>
        <span>Základ adventúry · príbeh ešte len príde</span>
      </footer>
    </main>
  );
}
