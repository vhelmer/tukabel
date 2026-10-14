import { useEffect, useMemo, useState } from 'react';
import { assetIds } from '../game/assets';
import { validateProject } from '../game/validateProject';
import { initialState } from '../game/state';
import type {
  GameContent,
  GameState,
  Hotspot,
  SceneDefinition,
} from '../game/types';
import { readProject, writeProject } from './api';
import { nextId } from './model';
import { Field, SelectId } from './fields';
import { EditorStage } from './EditorStage';
import { SceneInspector } from './SceneInspector';
import { DialoguesPanel, ItemsPanel, PuzzlesPanel } from './ContentPanels';
import { LogicGraph } from './LogicGraph';
import type { GraphTarget } from './LogicGraph';
import './editor.css';

type Tab = 'scenes' | 'items' | 'dialogues' | 'puzzles' | 'graph';
const serialize = (value: GameContent) => JSON.stringify(value);
const tabs: { id: Tab; label: string }[] = [
  { id: 'scenes', label: 'Lokácie' },
  { id: 'items', label: 'Predmety' },
  { id: 'dialogues', label: 'Dialógy' },
  { id: 'puzzles', label: 'Hádanky' },
  { id: 'graph', label: 'Mapa logiky' },
];

export default function DevWorkspace({
  document,
  onChange,
  sceneId,
  onScene,
  onPreview,
  testState,
}: {
  document: GameContent;
  onChange: (content: GameContent) => void;
  sceneId: string;
  onScene: (id: string) => void;
  onPreview: () => void;
  testState?: GameState;
}) {
  const [tab, setTab] = useState<Tab>('scenes');
  const [graphNodeId, setGraphNodeId] = useState('');
  const [hotspotId, setHotspotId] = useState('');
  const [dialogueId, setDialogueId] = useState(document.dialogues[0]?.id ?? '');
  const [assets, setAssets] = useState<string[]>(assetIds);
  const [revision, setRevision] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState('Načítavam zdrojový projekt…');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<{
    undo: GameContent[];
    redo: GameContent[];
  }>({ undo: [], redo: [] });
  const scene =
    document.scenes.find((entry) => entry.id === sceneId) ?? document.scenes[0];
  const hotspot = scene?.hotspots.find((entry) => entry.id === hotspotId);
  const errors = useMemo(
    () => validateProject(document, assets),
    [document, assets],
  );
  const dirty = saved !== null && serialize(document) !== saved;
  useEffect(() => {
    let disposed = false;
    void readProject()
      .then((response) => {
        if (disposed) return;
        const errors = validateProject(response.content, response.assets);
        if (errors.length) throw new Error(errors.join('\n'));
        setAssets(response.assets);
        setRevision(response.revision);
        setSaved(serialize(response.content));
        onChange(response.content);
        setLoaded(true);
        setMessage(
          'Zdroj načítaný. Úpravy sa zapíšu až tlačidlom Uložiť do projektu.',
        );
      })
      .catch((error: unknown) => {
        if (!disposed)
          setMessage(
            error instanceof Error ? error.message : 'Načítanie zlyhalo.',
          );
      });
    return () => {
      disposed = true;
    };
  }, [onChange]);
  function change(next: GameContent) {
    if (serialize(next) === serialize(document)) return;
    setHistory({ undo: [...history.undo.slice(-49), document], redo: [] });
    onChange(next);
  }
  function updateScene(next: SceneDefinition) {
    change({
      ...document,
      scenes: document.scenes.map((entry) =>
        entry.id === next.id ? next : entry,
      ),
    });
  }
  function updateHotspot(next: Hotspot) {
    if (scene)
      updateScene({
        ...scene,
        hotspots: scene.hotspots.map((entry) =>
          entry.id === next.id ? next : entry,
        ),
      });
  }
  function createHotspot(bounds: Hotspot['bounds']) {
    if (!scene) return;
    const id = nextId(
      'object',
      scene.hotspots.map((entry) => entry.id),
    );
    updateScene({
      ...scene,
      hotspots: [
        ...scene.hotspots,
        {
          id,
          label: 'Nový objekt',
          bounds,
          defaultVerb: 'look',
          actions: { look: [{ message: 'Zatiaľ nenápadný objekt.' }] },
        },
      ],
    });
    setHotspotId(id);
  }
  async function save() {
    if (!revision || errors.length) return;
    setBusy(true);
    const savingDocument = document;
    try {
      const response = await writeProject(savingDocument, revision);
      setRevision(response.revision);
      setSaved(serialize(savingDocument));
      setMessage(
        'Uložené do src/game/content/project.json. Zmeny môžeš commitnúť do Gitu.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Uloženie zlyhalo.');
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const response = await readProject();
      const errors = validateProject(response.content, response.assets);
      if (errors.length) throw new Error(errors.join('\n'));
      setAssets(response.assets);
      setRevision(response.revision);
      setSaved(serialize(response.content));
      change(response.content);
      setLoaded(true);
      setMessage(
        'Zdroj znovu načítaný. Predchádzajúci návrh je dostupný cez Späť.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Načítanie zlyhalo.');
    } finally {
      setBusy(false);
    }
  }
  function navigate(target: GraphTarget) {
    if (target.type === 'scene') {
      onScene(target.sceneId);
      setHotspotId(target.hotspotId);
      setTab('scenes');
    } else if (target.type === 'dialogue') {
      setDialogueId(target.id);
      setGraphNodeId(target.nodeId);
      setTab('dialogues');
    } else setTab('puzzles');
  }
  return (
    <section className="dev-workspace" aria-label="Vývojársky editor">
      <header className="editor-header">
        <div>
          <p className="eyebrow">AUTORSKÝ EDITOR</p>
          <h1>Tvoja scéna. Tvoje pravidlá.</h1>
          <p>Obsah v Gite · náhľad bez zápisu · lokálne ukladanie do zdrojov</p>
        </div>
        <div className="editor-save">
          <span className={dirty ? 'unsaved-badge' : 'saved-badge'}>
            {dirty ? '● Neuložené zmeny' : '✓ Zhodné so zdrojom'}
          </span>
          <button
            className="primary-button"
            disabled={!loaded || busy || errors.length > 0 || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Pracujem…' : 'Uložiť do projektu'}
          </button>
          <button disabled={errors.length > 0 || !loaded} onClick={onPreview}>
            Otestovať odtiaľto ↗
          </button>
        </div>
      </header>
      <div className="editor-status" role="status" aria-label="Stav editora">
        {message}
      </div>
      <div className="editor-nav">
        <div className="editor-tabs">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              aria-pressed={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="row-actions">
          <button
            disabled={!history.undo.length || busy}
            onClick={() => {
              const previous = history.undo.at(-1);
              if (previous) {
                setHistory({
                  undo: history.undo.slice(0, -1),
                  redo: [...history.redo, document],
                });
                onChange(previous);
              }
            }}
          >
            Späť
          </button>
          <button
            disabled={!history.redo.length || busy}
            onClick={() => {
              const next = history.redo.at(-1);
              if (next) {
                setHistory({
                  undo: [...history.undo, document],
                  redo: history.redo.slice(0, -1),
                });
                onChange(next);
              }
            }}
          >
            Znova
          </button>
          <button disabled={busy} onClick={() => void reload()}>
            Zahodiť zmeny a načítať
          </button>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="validation-errors" role="alert">
          <strong>Oprav údaje pred uložením alebo testom:</strong>
          <ul>
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <fieldset className="editor-body" disabled={!loaded || busy}>
        <legend className="sr-only">Úpravy obsahu</legend>
        {tab === 'scenes' && (
          <>
            <div className="scene-selector">
              <SelectId
                label="Aktívna lokácia"
                value={scene?.id ?? ''}
                values={document.scenes.map((entry) => ({
                  id: entry.id,
                  label: entry.title,
                }))}
                onChange={(id) => {
                  onScene(id);
                  setHotspotId('');
                }}
              />
              <button
                onClick={() => {
                  const id = nextId(
                    'scene',
                    document.scenes.map((entry) => entry.id),
                  );
                  change({
                    ...document,
                    scenes: [
                      ...document.scenes,
                      {
                        id,
                        title: 'Nová lokácia',
                        width: 1280,
                        height: 720,
                        background: scene?.background ?? assets[0] ?? '',
                        hotspots: [],
                      },
                    ],
                  });
                  onScene(id);
                  setHotspotId('');
                }}
              >
                + Lokácia
              </button>
              <button
                disabled={!scene || document.scenes.length <= 1}
                className="danger-button"
                onClick={() => {
                  if (scene)
                    change({
                      ...document,
                      scenes: document.scenes.filter(
                        (entry) => entry.id !== scene.id,
                      ),
                    });
                }}
              >
                Odstrániť lokáciu
              </button>
            </div>
            {scene && (
              <div className="scene-editor-layout">
                <div>
                  <EditorStage
                    key={scene.id}
                    scene={scene}
                    selectedId={hotspotId}
                    onSelect={setHotspotId}
                    onBounds={(id, bounds) => {
                      const entry = scene.hotspots.find(
                        (hotspot) => hotspot.id === id,
                      );
                      if (entry) updateHotspot({ ...entry, bounds });
                    }}
                    onCreate={createHotspot}
                  />
                  <div className="hotspot-list">
                    <Field label="Vybraný objekt">
                      <select
                        value={hotspot?.id ?? ''}
                        onChange={(event) => setHotspotId(event.target.value)}
                      >
                        <option value="">Vyber objekt…</option>
                        {scene.hotspots.map((entry) => (
                          <option value={entry.id} key={entry.id}>
                            {entry.label} · {entry.id}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <button
                      onClick={() => {
                        const x = Math.min(100, Math.floor(scene.width / 4));
                        const y = Math.min(100, Math.floor(scene.height / 4));
                        createHotspot({
                          x,
                          y,
                          width: Math.max(1, Math.min(160, scene.width - x)),
                          height: Math.max(1, Math.min(100, scene.height - y)),
                        });
                      }}
                    >
                      + Objekt
                    </button>
                  </div>
                  <p className="field-note">
                    Súradnice patria k pôvodnej veľkosti lokácie. Obrázky a
                    hotspoty sa pri hraní škálujú spolu. ID objektov sú stabilné
                    a automaticky pridelené.
                  </p>
                </div>
                <aside
                  className="editor-inspector"
                  aria-label="Vlastnosti lokácie a objektu"
                >
                  <SceneInspector
                    key={`${scene.id}/${hotspot?.id ?? ''}`}
                    scene={scene}
                    hotspot={hotspot}
                    content={document}
                    assets={assets}
                    onAssets={setAssets}
                    onScene={updateScene}
                    onHotspot={updateHotspot}
                    onAnimationCommit={(animations, hotspot) =>
                      change({
                        ...document,
                        animations,
                        scenes: document.scenes.map((entry) =>
                          entry.id === scene.id
                            ? {
                                ...entry,
                                hotspots: entry.hotspots.map((object) =>
                                  object.id === hotspot.id ? hotspot : object,
                                ),
                              }
                            : entry,
                        ),
                      })
                    }
                    onDelete={() =>
                      updateScene({
                        ...scene,
                        hotspots: scene.hotspots.filter(
                          (entry) => entry.id !== hotspotId,
                        ),
                      })
                    }
                  />
                </aside>
              </div>
            )}
          </>
        )}
        {tab === 'items' && (
          <ItemsPanel
            content={document}
            onChange={change}
            assets={assets}
            onAssets={setAssets}
          />
        )}
        {tab === 'dialogues' && (
          <DialoguesPanel
            key={`${dialogueId}/${graphNodeId}`}
            initialNodeId={graphNodeId}
            content={document}
            onChange={change}
            selectedDialogue={dialogueId}
            onSelectDialogue={setDialogueId}
          />
        )}
        {tab === 'puzzles' && (
          <PuzzlesPanel content={document} onChange={change} />
        )}
        {tab === 'graph' && (
          <LogicGraph
            content={document}
            state={testState ?? initialState(document)}
            onNavigate={navigate}
          />
        )}
      </fieldset>
      <details className="source-preview">
        <summary>Zdrojový JSON · src/game/content/project.json</summary>
        <pre>{JSON.stringify(document, null, 2)}</pre>
      </details>
    </section>
  );
}
