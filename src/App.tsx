import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { content } from './game/content';
import { resolveAssets } from './game/assets';
import { initialState, reduceGame } from './game/state';
import { validateProject } from './game/validateProject';
import type { GameAction, GameContent, GameState } from './game/types';
import { GameWindow } from './ui/GameWindow';

const DevWorkspace = import.meta.env.DEV
  ? lazy(() => import('./editor/DevWorkspace'))
  : null;

export function App() {
  const [document, setDocument] = useState<GameContent>(content);
  const [playDocument, setPlayDocument] = useState<GameContent>(content);
  const [state, setState] = useState(() => initialState(content));
  const [sceneId, setSceneId] = useState(content.startScene);
  const [mode, setMode] = useState<'game' | 'dev'>('game');
  const [editorOpened, setEditorOpened] = useState(false);
  const gameContent = useMemo(
    () => resolveAssets(playDocument),
    [playDocument],
  );
  const dispatch = useCallback(
    (action: GameAction) =>
      setState((previous) => reduceGame(gameContent, previous, action)),
    [gameContent],
  );
  const errors = useMemo(() => validateProject(document), [document]);
  function preview() {
    if (errors.length) return;
    setPlayDocument(document);
    setState({
      ...initialState(document),
      sceneId: document.scenes.some((scene) => scene.id === sceneId)
        ? sceneId
        : document.startScene,
    });
    setMode('game');
  }
  return (
    <main className={`app ${mode === 'dev' ? 'dev-mode' : 'game-mode'}`}>
      {DevWorkspace && (
        <nav
          className="mode-bar"
          lang={mode === 'dev' ? 'cs' : 'sk'}
          aria-label={mode === 'dev' ? 'Režim aplikace' : 'Režim aplikácie'}
        >
          <span>
            ↯ TUKABEL <small>WORKSHOP</small>
          </span>
          <div>
            <button
              aria-pressed={mode === 'game'}
              disabled={mode === 'dev' && errors.length > 0}
              onClick={() => {
                if (mode === 'dev') preview();
              }}
            >
              Game Mode
            </button>
            <button
              aria-pressed={mode === 'dev'}
              onClick={() => {
                if (mode === 'dev') return;
                setSceneId(state.sceneId);
                setEditorOpened(true);
                setMode('dev');
              }}
            >
              Dev Mode
            </button>
          </div>
          <span className="mode-note">
            {mode === 'dev' ? 'Úpravy → test → zdrojový JSON' : 'Herný náhľad'}
          </span>
        </nav>
      )}
      {mode === 'game' && (
        <GameWindow
          content={gameContent}
          state={state}
          dispatch={dispatch}
          restore={(saved: GameState) => setState(saved)}
          reset={() => setState(initialState(gameContent))}
        />
      )}
      {DevWorkspace && editorOpened && (
        <div hidden={mode !== 'dev'} className="dev-host">
          <Suspense fallback={<p>Načítavam editor…</p>}>
            <DevWorkspace
              active={mode === 'dev'}
              document={document}
              onChange={setDocument}
              sceneId={sceneId}
              onScene={setSceneId}
              onPreview={preview}
              testState={state}
            />
          </Suspense>
        </div>
      )}
    </main>
  );
}
