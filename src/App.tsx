import { useCallback, useEffect, useReducer, useState } from 'react';
import { content } from './game/content';
import { initialState, matches, reduceGame } from './game/state';
import { loadGame, saveGame } from './game/storage';
import type { GameAction, GameState, Hotspot, Verb } from './game/types';
import { GameCanvas } from './ui/GameCanvas';
import { DialoguePanel } from './ui/DialoguePanel';
import { Inventory } from './ui/Inventory';

const verbs: { id: Verb | 'auto'; label: string }[] = [
  { id: 'auto', label: 'Kontextová akcia' },
  { id: 'look', label: 'Preskúmať' },
  { id: 'take', label: 'Vziať' },
  { id: 'talk', label: 'Hovoriť' },
  { id: 'use', label: 'Použiť' },
];
type AppAction =
  GameAction | { type: 'restore'; state: GameState } | { type: 'reset' };
function reducer(state: GameState, action: AppAction) {
  if (action.type === 'restore') return action.state;
  if (action.type === 'reset') return initialState(content);
  return reduceGame(content, state, action);
}

export function App() {
  const [state, dispatch] = useReducer(reducer, content, initialState);
  const [hovered, setHovered] = useState<Hotspot | null>(null);
  const [selectedItemId, setSelectedItem] = useState<string | null>(null);
  const [verb, setVerb] = useState<Verb | 'auto'>('auto');
  const [showHotspots, setShowHotspots] = useState(false);
  const [storageMessage, setStorageMessage] = useState(
    'Pozícia sa uloží až tlačidlom Uložiť hru.',
  );
  const selectedItem =
    selectedItemId && state.inventory.includes(selectedItemId)
      ? selectedItemId
      : null;
  const scene = content.scenes.find((entry) => entry.id === state.sceneId)!;
  const hotspots = scene.hotspots.filter((hotspot) =>
    matches(state, hotspot.visibleWhen),
  );
  const currentHover = hotspots.find((hotspot) => hotspot.id === hovered?.id);
  const interact = useCallback(
    (hotspot: Hotspot) => {
      dispatch({
        type: 'interact',
        hotspotId: hotspot.id,
        verb: verb === 'auto' ? undefined : verb,
        itemId: selectedItem ?? undefined,
      });
      setHovered(null);
      setSelectedItem(null);
    },
    [verb, selectedItem],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedItem(null);
        dispatch({ type: 'closeDialogue' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  function clearSelection() {
    setSelectedItem(null);
    setHovered(null);
    setVerb('auto');
  }

  return (
    <main className="app">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↯
          </span>
          TUKABEL
        </div>
        <span className="build-badge">HRATEĽNÁ UKÁŽKA / 002</span>
      </header>
      <section className="intro" aria-labelledby="game-title">
        <div>
          <p className="eyebrow">POINT & CLICK · SKÚŠKA SYSTÉMOV</p>
          <h1 id="game-title">
            Malá oprava. <em>Veľké možnosti.</em>
          </h1>
          <p className="intro-copy">
            Porozprávaj sa so správcom, oprav kábel a otvor cestu do dvora.
          </p>
        </div>
        <div className="location-note">
          <span className="status-dot" />
          {state.flags.completed ? 'Ukážka dokončená' : 'Cieľ: otvoriť dvor'}
          <small>Dve lokácie · jedna malá hádanka</small>
        </div>
      </section>
      <section className="game" aria-label="Herná ukážka">
        <div className="scene-toolbar">
          <span>
            <span className="tiny-label">LOKÁCIA</span> /{' '}
            <strong>{scene.title}</strong>
          </span>
          <button
            className="hint-button"
            aria-pressed={showHotspots}
            onClick={() => setShowHotspots((value) => !value)}
          >
            {showHotspots ? 'Skryť predmety' : 'Ukázať predmety'} ↗
          </button>
        </div>
        <GameCanvas
          scene={scene}
          state={state}
          hoveredId={currentHover?.id ?? null}
          selectedId={null}
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
              {state.flags.completed ? 'SKÚŠKA ÚSPEŠNÁ' : 'ČO SA DEJE'}
            </span>
            <p key={state.message} className="message">
              {state.message}
            </p>
          </div>
        </div>
        {state.dialogue && (
          <DialoguePanel content={content} state={state} dispatch={dispatch} />
        )}
        <fieldset className="world-controls" disabled={Boolean(state.dialogue)}>
          <legend className="sr-only">Ovládanie scény</legend>
          <div className="verb-controls" aria-label="Herné akcie">
            {verbs.map((entry) => (
              <button
                key={entry.id}
                aria-pressed={!selectedItem && verb === entry.id}
                onClick={() => {
                  setVerb(entry.id);
                  setSelectedItem(null);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="object-controls" aria-label="Predmety v miestnosti">
            {hotspots.map((hotspot) => (
              <button
                key={hotspot.id}
                className="object-button"
                onClick={() => interact(hotspot)}
                onMouseEnter={() => setHovered(hotspot)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(hotspot)}
                onBlur={() => setHovered(null)}
              >
                {hotspot.label}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Inventory
          content={content}
          state={state}
          selectedItem={selectedItem}
          onSelect={setSelectedItem}
          dispatch={dispatch}
        />
        <div className="save-controls">
          <div>
            <button
              onClick={() => {
                const result = saveGame(content, state);
                setStorageMessage(
                  result.ok
                    ? 'Hra je uložená v tomto prehliadači.'
                    : result.message,
                );
              }}
            >
              Uložiť hru
            </button>
            <button
              onClick={() => {
                const result = loadGame(content);
                if (result.ok) {
                  dispatch({ type: 'restore', state: result.value });
                  clearSelection();
                }
                setStorageMessage(
                  result.ok ? 'Uložená hra je načítaná.' : result.message,
                );
              }}
            >
              Načítať hru
            </button>
            <button
              onClick={() => {
                dispatch({ type: 'reset' });
                clearSelection();
                setShowHotspots(false);
                setStorageMessage(
                  'Nová hra. Ručne uložená pozícia ostáva dostupná.',
                );
              }}
            >
              Nová hra
            </button>
          </div>
          <p role="status" aria-label="Ukladanie">
            {storageMessage}
          </p>
        </div>
      </section>
      <footer className="footer">
        <span>
          {selectedItem
            ? `Použiť: ${content.items.find((item) => item.id === selectedItem)!.label}${currentHover ? ` → ${currentHover.label}` : ''}`
            : currentHover
              ? `${verbs.find((entry) => entry.id === (verb === 'auto' ? currentHover.defaultVerb : verb))!.label}: ${currentHover.label}`
              : 'Klik / dotyk · Tab a Enter · Escape zruší výber alebo rozhovor'}
        </span>
        <span>
          Kontextová akcia vyberie vhodné sloveso. Predmety spojíš dvoma klikmi.
        </span>
      </footer>
    </main>
  );
}
