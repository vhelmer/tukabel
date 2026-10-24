import type { GameContent, TaskDefinition } from '../game/types';
import { ConditionField, Field, SelectId } from './fields';
import { nextId } from './model';

export function TasksPanel({
  content,
  selectedId,
  onSelect,
  onChange,
}: {
  content: GameContent;
  selectedId: string;
  onSelect: (id: string) => void;
  onChange: (content: GameContent) => void;
}) {
  const tasks = content.tasks ?? [];
  const task = tasks.find((t) => t.id === selectedId) ?? tasks[0];
  const update = (next: TaskDefinition) =>
    onChange({
      ...content,
      tasks: tasks.map((t) => (t.id === next.id ? next : t)),
    });
  const startMode = !task?.startWhen
    ? 'event'
    : 'all' in task.startWhen && !task.startWhen.all.length
      ? 'initial'
      : 'condition';
  return (
    <section className="content-panel" aria-label="Editor úkolů">
      <h2>Deník úkolů</h2>
      <p className="field-note">
        Jednou zapsané úkoly zůstanou v deníku. Dokončené se přeškrtnou a znovu
        se neotevřou. Texty pro hráče piš slovensky.
      </p>
      <div className="field-row">
        <SelectId
          label="Úkol na úpravu"
          value={task?.id ?? ''}
          values={tasks.map((t) => ({ id: t.id, label: t.text }))}
          empty="Zatím žádné úkoly"
          onChange={onSelect}
        />
        <button
          onClick={() => {
            const id = nextId(
              'task',
              tasks.map((t) => t.id),
            );
            onChange({
              ...content,
              tasks: [
                ...tasks,
                { id, text: 'Nová úloha.', startWhen: { all: [] } },
              ],
            });
            onSelect(id);
          }}
        >
          + Úkol
        </button>
      </div>
      {task && (
        <div className="editor-card" key={task.id}>
          <p className="field-note">Stálé ID: {task.id}</p>
          <Field label="Text v deníku">
            <textarea
              maxLength={500}
              rows={3}
              value={task.text}
              onChange={(e) => update({ ...task, text: e.target.value })}
            />
          </Field>
          <Field label="Kdy přidat úkol">
            <select
              value={startMode}
              onChange={(e) =>
                update({
                  ...task,
                  startWhen:
                    e.target.value === 'event'
                      ? undefined
                      : e.target.value === 'initial'
                        ? { all: [] }
                        : { flag: content.flags[0] ?? '' },
                })
              }
            >
              <option value="initial">Na začátku hry</option>
              <option value="condition">Automaticky podle podmínky</option>
              <option value="event">Efektem akce nebo dialogu</option>
            </select>
          </Field>
          {startMode === 'condition' && (
            <ConditionField
              label="Podmínka přidání úkolu"
              content={content}
              value={task.startWhen}
              onChange={(startWhen) =>
                update({ ...task, startWhen: startWhen ?? { all: [] } })
              }
            />
          )}
          <Field label="Kdy dokončit úkol">
            <select
              value={task.completeWhen ? 'condition' : 'event'}
              onChange={(e) =>
                update({
                  ...task,
                  completeWhen:
                    e.target.value === 'event'
                      ? undefined
                      : { flag: content.flags[0] ?? '' },
                })
              }
            >
              <option value="event">Efektem akce nebo dialogu</option>
              <option value="condition">Automaticky podle podmínky</option>
            </select>
          </Field>
          {task.completeWhen && (
            <ConditionField
              label="Podmínka dokončení úkolu"
              content={content}
              value={task.completeWhen}
              onChange={(completeWhen) =>
                update({ ...task, completeWhen: completeWhen ?? { all: [] } })
              }
            />
          )}
          <p className="field-note">
            U objektu, kombinace nebo dialogové odpovědi zvol efekt „Přidat úkol
            do deníku“ / „Dokončit úkol“ a tento úkol jako cíl. Dokončení lze
            zapsat i před přidáním; objeví se rovnou přeškrtnutý.
          </p>
          <div className="row-actions">
            <button
              disabled={tasks.indexOf(task) === 0}
              onClick={() => {
                const next = [...tasks],
                  index = next.indexOf(task);
                [next[index - 1], next[index]] = [
                  next[index]!,
                  next[index - 1]!,
                ];
                onChange({ ...content, tasks: next });
              }}
            >
              Posunout úkol výš
            </button>
            <button
              className="danger-button"
              onClick={() =>
                onChange({
                  ...content,
                  tasks: tasks.filter((t) => t.id !== task.id),
                })
              }
            >
              Odstranit úkol
            </button>
          </div>
          <p className="field-note">
            Při odstranění používaného úkolu oprav také efekty; validace zabrání
            uložení neplatných odkazů.
          </p>
        </div>
      )}
    </section>
  );
}
