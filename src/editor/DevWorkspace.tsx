import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { copyHotspotBehavior } from './hotspotBehavior';
import { Field, SelectId } from './fields';
import { AnimationStudio } from './AnimationStudio';
import { EditorStage } from './EditorStage';
import { SceneInspector } from './SceneInspector';
import { DialoguesPanel, ItemsPanel, PuzzlesPanel } from './ContentPanels';
import { LogicGraph } from './LogicGraph';
import { LayerPanel } from './LayerPanel';
import { useEditorJobs } from './useEditorJobs';
import { JobTray } from './JobTray';
import { SceneArtPanel } from './SceneArtPanel';
import { SceneLivePreview } from './SceneLivePreview';
import { TasksPanel } from './TasksPanel';
import { WorldMapPanel } from './WorldMapPanel';
import type { Point } from '../game/transforms';
import type { GraphTarget } from './LogicGraph';
import './editor.css';

type Tab =
  | 'animations'
  | 'scenes'
  | 'worldMap'
  | 'items'
  | 'dialogues'
  | 'tasks'
  | 'puzzles'
  | 'graph';
const serialize = (value: GameContent) => JSON.stringify(value);
const tabs: { id: Tab; label: string }[] = [
  { id: 'scenes', label: 'Lokace' },
  { id: 'worldMap', label: 'Mapa lokací' },
  { id: 'animations', label: 'Animace' },
  { id: 'items', label: 'Předměty' },
  { id: 'dialogues', label: 'Dialogy' },
  { id: 'tasks', label: 'Úkoly' },
  { id: 'puzzles', label: 'Hádanky' },
  { id: 'graph', label: 'Mapa logiky' },
];

export default function DevWorkspace({
  active,
  document,
  onChange,
  sceneId,
  onScene,
  onPreview,
  testState,
}: {
  active: boolean;
  document: GameContent;
  onChange: (content: GameContent) => void;
  sceneId: string;
  onScene: (id: string) => void;
  onPreview: () => void;
  testState?: GameState;
}) {
  const jobQueue = useEditorJobs(active);
  const [selectedJob, setSelectedJob] = useState('');
  const [tab, setTab] = useState<Tab>('scenes');
  const [taskId, setTaskId] = useState('');
  const [graphNodeId, setGraphNodeId] = useState('');
  const [hotspotId, setHotspotId] = useState('');
  const [behaviorCopy, setBehaviorCopy] = useState<{
    sceneId: string;
    document: GameContent;
    source: Hotspot;
  }>();
  const [artSelection, setArtSelection] = useState<{
    scope: string;
    points: readonly Point[];
  }>();
  const [livePreview, setLivePreview] = useState(false);
  const [dialogueId, setDialogueId] = useState(document.dialogues[0]?.id ?? '');
  const [assets, setAssets] = useState<string[]>(assetIds);
  const addAssets = useCallback((ids: string[]) => {
    setAssets((current) =>
      ids.every((id) => current.includes(id))
        ? current
        : [...new Set([...current, ...ids])],
    );
  }, []);
  const [revision, setRevision] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState('Načítám zdrojový projekt…');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<{
    undo: GameContent[];
    redo: GameContent[];
  }>({ undo: [], redo: [] });
  const scene =
    document.scenes.find((entry) => entry.id === sceneId) ?? document.scenes[0];
  const hotspot = scene?.hotspots.find((entry) => entry.id === hotspotId);
  // Changing the editing context invalidates the tool, including a later undo
  // back to the same document. The pending operation never enters project JSON.
  if (
    behaviorCopy &&
    (behaviorCopy.document !== document ||
      behaviorCopy.sceneId !== scene?.id ||
      !active ||
      tab !== 'scenes' ||
      livePreview ||
      busy)
  )
    setBehaviorCopy(undefined);
  useEffect(() => {
    if (!behaviorCopy) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBehaviorCopy(undefined);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [behaviorCopy]);
  const artScope = `${scene?.id}/${hotspot?.id ?? ''}`;
  const selection =
    artSelection?.scope === artScope ? artSelection.points : undefined;
  const selectArea = (points?: readonly Point[]) =>
    setArtSelection(points ? { scope: artScope, points } : undefined);
  const errors = useMemo(
    () => validateProject(document, assets),
    [document, assets],
  );
  const actors = document.scenes.flatMap((s) =>
    s.hotspots
      .filter((h) => h.image)
      .map((h) => ({
        scene: s,
        hotspot: h,
        key: JSON.stringify([s.id, h.id]),
      })),
  );
  const actor =
    actors.find(
      (a) => a.scene.id === scene?.id && a.hotspot.id === hotspotId,
    ) ??
    actors.find((a) => a.scene.id === scene?.id) ??
    actors[0];
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
          'Zdroj načtený. Úpravy se zapíšou až tlačítkem Uložit do projektu.',
        );
      })
      .catch((error: unknown) => {
        if (!disposed)
          setMessage(
            error instanceof Error ? error.message : 'Načítání selhalo.',
          );
      });
    return () => {
      disposed = true;
    };
  }, [onChange]);
  function change(next: GameContent) {
    setBehaviorCopy(undefined);
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
  function selectHotspot(id: string) {
    if (!behaviorCopy) {
      setHotspotId(id);
      return;
    }
    if (
      !scene ||
      behaviorCopy.sceneId !== scene.id ||
      behaviorCopy.document !== document ||
      id === behaviorCopy.source.id
    )
      return;
    const target = scene.hotspots.find((entry) => entry.id === id);
    if (!target) return;
    if (target.locked) {
      setMessage(
        'Cílová vrstva je zamknutá. Nejdřív ji odemkni nebo vyber jinou.',
      );
      return;
    }
    updateHotspot(copyHotspotBehavior(behaviorCopy.source, target));
    setHotspotId(id);
    setMessage(
      `Chování z „${behaviorCopy.source.label}“ zkopírované na „${target.label}“. Původní objekt zůstal zachovaný; operaci vrátí Zpět.`,
    );
  }
  function createHotspot(
    bounds: Hotspot['bounds'],
    polygon?: Hotspot['polygon'],
  ) {
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
          polygon,
          onClick: [{ message: 'Zatiaľ nenápadný objekt.' }],
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
        'Uložené do src/game/content/project.json. Změny můžeš commitnout do Gitu.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Uložení selhalo.');
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
      setMessage('Zdroj znovu načtený. Předchozí návrh je dostupný přes Zpět.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Načítání selhalo.');
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
    } else if (target.type === 'worldMap') {
      setTab('worldMap');
    } else if (target.type === 'tasks') {
      setTaskId(target.id);
      setTab('tasks');
    } else setTab('puzzles');
  }
  return (
    <section
      className={`dev-workspace ${tab === 'animations' ? 'animation-mode' : ''}`}
      lang="cs"
      aria-label="Vývojářský editor"
    >
      <header className="editor-header">
        <div>
          <p className="eyebrow">AUTORSKÝ EDITOR</p>
          <h1>
            {tab === 'animations'
              ? 'Animační studio'
              : 'Tvá scéna. Tvá pravidla.'}
          </h1>
          <p>Obsah v Gitu · náhled bez zápisu · lokální ukládání do zdrojů</p>
        </div>
        <div className="editor-save">
          <span className={dirty ? 'unsaved-badge' : 'saved-badge'}>
            {dirty ? '● Neuložené změny' : '✓ Zhodné s zdrojem'}
          </span>
          <button
            className="primary-button"
            disabled={!loaded || busy || errors.length > 0 || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Pracuji…' : 'Uložit do projektu'}
          </button>
          <button disabled={errors.length > 0 || !loaded} onClick={onPreview}>
            Otestovat odsud ↗
          </button>
        </div>
      </header>
      <div className="editor-status" role="status" aria-label="Stav editoru">
        {message}
      </div>
      <JobTray
        jobs={jobQueue.jobs}
        error={jobQueue.error}
        onAction={(id, action) => void jobQueue.action(id, action)}
        onOpen={(job) => {
          const target = document.scenes.find(
            (s) => s.id === job.context.sceneId,
          );
          if (
            !target ||
            (job.context.targetId &&
              !target.hotspots.some((h) => h.id === job.context.targetId))
          ) {
            setMessage(
              'Cíl úlohy už v návrhu neexistuje. Výsledek se nepoužil; grafické assety zůstávají v src/assets/scene-art/.',
            );
            return;
          }
          onScene(job.context.sceneId);
          setHotspotId(job.context.targetId);
          setTab(
            job.kind === 'art' ||
              (job.kind === 'codex' && job.context.mode === 'scene')
              ? 'scenes'
              : 'animations',
          );
          setSelectedJob(job.id);
        }}
      />
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
            Zpět
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
            Znovu
          </button>
          <button disabled={busy} onClick={() => void reload()}>
            Zahodit změny a načíst
          </button>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="validation-errors" role="alert">
          <strong>Oprav údaje před uložením nebo testem:</strong>
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
                label="Aktivní lokace"
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
                + Lokace
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
                Odstranit lokaci
              </button>
            </div>
            {scene && (
              <div className="scene-editor-layout with-layers">
                <LayerPanel
                  scene={scene}
                  selectedId={hotspotId}
                  assets={assets}
                  onAssets={addAssets}
                  onSelect={selectHotspot}
                  onChange={updateScene}
                />
                <div className="scene-art-canvas">
                  <div className="row-actions scene-view-switch">
                    <button
                      aria-pressed={livePreview}
                      onClick={() => setLivePreview(!livePreview)}
                    >
                      {livePreview
                        ? 'Zpět na úpravy vrstev'
                        : 'Živý náhled animací'}
                    </button>
                  </div>
                  {livePreview ? (
                    active && (
                      <SceneLivePreview content={document} sceneId={scene.id} />
                    )
                  ) : (
                    <EditorStage
                      key={scene.id}
                      scene={scene}
                      selectedId={hotspotId}
                      onSelect={selectHotspot}
                      pickTargetSourceId={behaviorCopy?.source.id}
                      onPickTarget={selectHotspot}
                      onHotspot={updateHotspot}
                      onCreate={createHotspot}
                      selection={selection}
                      onSelection={selectArea}
                    />
                  )}
                  <div className="hotspot-list">
                    <Field label="Vybraný objekt">
                      <select
                        value={hotspot?.id ?? ''}
                        onChange={(event) => selectHotspot(event.target.value)}
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
                      disabled={!behaviorCopy && (!hotspot || livePreview)}
                      aria-pressed={Boolean(behaviorCopy)}
                      onClick={() =>
                        setBehaviorCopy(
                          behaviorCopy || !hotspot
                            ? undefined
                            : { sceneId: scene.id, document, source: hotspot },
                        )
                      }
                    >
                      {behaviorCopy ? 'Zrušit kopírování' : 'Kopírovat chování'}
                    </button>
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
                  {behaviorCopy && (
                    <p
                      className="field-note"
                      role="status"
                      aria-label="Kopírování chování"
                    >
                      Kopíruješ z „{behaviorCopy.source.label}“. Klikni na
                      cílový objekt ve scéně nebo v seznamu vrstev. Podmínky
                      viditelnosti, kliknutí, použití inventáře a kurzor nahradí
                      cílová pravidla. Grafika, umístění a animace cíle zůstanou
                      zachované. Escape kopírování zruší.
                    </p>
                  )}
                  <SceneArtPanel
                    key={`${artScope}/${hotspot?.image ?? ''}`}
                    active={active}
                    content={document}
                    assets={assets}
                    jobs={jobQueue.jobs}
                    selectedJob={selectedJob}
                    onSubmitted={(job) => {
                      setSelectedJob(job.id);
                      jobQueue.add(job);
                    }}
                    onDismiss={(id) => void jobQueue.action(id, 'dismiss')}
                    scene={scene}
                    hotspot={hotspot}
                    selection={selection}
                    onSelection={selectArea}
                    onChange={change}
                    onAssets={addAssets}
                    onScene={onScene}
                    onSelect={setHotspotId}
                  />
                  <p className="field-note">
                    Souřadnice patří k původní velikosti lokace. Obrázky a
                    hotspoty se při hraní škálují společně. ID objektů jsou
                    stabilní a automaticky přidělené.
                  </p>
                </div>
                <aside
                  className="editor-inspector"
                  aria-label="Vlastnosti lokace a objektu"
                >
                  <fieldset disabled={hotspot?.locked}>
                    <legend className="sr-only">Vlastnosti vrstvy</legend>
                    <SceneInspector
                      key={`${scene.id}/${hotspot?.id ?? ''}`}
                      scene={scene}
                      hotspot={hotspot}
                      content={document}
                      assets={assets}
                      onAssets={addAssets}
                      onScene={updateScene}
                      onHotspot={updateHotspot}
                      onOpenAnimations={() => setTab('animations')}
                      onDelete={() =>
                        updateScene({
                          ...scene,
                          hotspots: scene.hotspots.filter(
                            (entry) => entry.id !== hotspotId,
                          ),
                        })
                      }
                    />
                  </fieldset>
                </aside>
              </div>
            )}
          </>
        )}
        {tab === 'worldMap' && (
          <WorldMapPanel
            content={document}
            assets={assets}
            onAssets={addAssets}
            onChange={change}
          />
        )}
        {tab === 'animations' && (
          <>
            <div className="scene-selector">
              <SelectId
                label="Animovaná postava"
                value={actor?.key ?? ''}
                values={actors.map((a) => ({
                  id: a.key,
                  label: `${a.scene.title} · ${a.hotspot.label}`,
                }))}
                empty="Vyber postavu s obrázkem"
                onChange={(key) => {
                  const next = actors.find((a) => a.key === key);
                  if (next) {
                    onScene(next.scene.id);
                    setHotspotId(next.hotspot.id);
                  }
                }}
              />
            </div>
            {actor ? (
              <AnimationStudio
                active={active}
                sceneId={actor.scene.id}
                jobs={jobQueue.jobs}
                selectedJob={selectedJob}
                onSubmitted={(job) => {
                  setSelectedJob(job.id);
                  jobQueue.add(job);
                }}
                onDismiss={(id) => void jobQueue.action(id, 'dismiss')}
                onNode={(dialogueId, node) =>
                  change({
                    ...document,
                    dialogues: document.dialogues.map((d) =>
                      d.id === dialogueId
                        ? {
                            ...d,
                            nodes: d.nodes.map((n) =>
                              n.id === node.id ? node : n,
                            ),
                          }
                        : d,
                    ),
                  })
                }
                key={`${actor.key}/${actor.hotspot.image}`}
                hotspot={actor.hotspot}
                content={document}
                assets={assets}
                onAssets={addAssets}
                onHotspot={(next) =>
                  change({
                    ...document,
                    scenes: document.scenes.map((s) =>
                      s.id === actor.scene.id
                        ? {
                            ...s,
                            hotspots: s.hotspots.map((h) =>
                              h.id === next.id ? next : h,
                            ),
                          }
                        : s,
                    ),
                  })
                }
                onCommit={(animations, next) =>
                  change({
                    ...document,
                    animations,
                    scenes: document.scenes.map((s) =>
                      s.id === actor.scene.id
                        ? {
                            ...s,
                            hotspots: s.hotspots.map((h) =>
                              h.id === next.id ? next : h,
                            ),
                          }
                        : s,
                    ),
                  })
                }
              />
            ) : (
              <p>Nejprve přidej do lokace objekt s obrázkem postavy.</p>
            )}
          </>
        )}
        {tab === 'items' && (
          <ItemsPanel
            content={document}
            onChange={change}
            assets={assets}
            onAssets={addAssets}
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
        {tab === 'tasks' && (
          <TasksPanel
            content={document}
            selectedId={taskId}
            onSelect={setTaskId}
            onChange={change}
          />
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
