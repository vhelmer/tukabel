import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Condition, Effect, GameContent, Rule } from '../game/types';
import { assetUrl } from '../game/assets';
import { importAsset } from './api';

import { replaceAt } from './model';

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="editor-field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </div>
  );
}
export function SelectId({
  label,
  value,
  values,
  onChange,
  empty,
}: {
  label: string;
  value: string;
  values: readonly { id: string; label?: string }[];
  onChange: (id: string) => void;
  empty?: string;
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {value && !values.some((entry) => entry.id === value) && (
          <option value={value}>⚠ {value}</option>
        )}
        {values.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label ?? entry.id} · {entry.id}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function AssetField({
  label,
  value,
  assets,
  onChange,
  onAssets,
  optional = false,
}: {
  label: string;
  value: string;
  assets: readonly string[];
  onChange: (id: string) => void;
  onAssets: (ids: string[]) => void;
  optional?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onChange, onAssets });
  useEffect(() => {
    callbacks.current = { onChange, onAssets };
  }, [onChange, onAssets]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <div className="asset-field">
      <SelectId
        label={label}
        value={value}
        values={assets
          .filter((id) => /\.(svg|png|jpe?g|webp|avif)$/.test(id))
          .map((id) => ({ id }))}
        onChange={onChange}
        empty={optional ? 'Bez obrázku' : undefined}
      />
      {value && (
        <img
          className="asset-preview"
          src={assetUrl(value)}
          alt="Náhled assetu"
        />
      )}
      <label className="upload-button">
        {busy ? 'Importuji…' : 'Importovat PNG / JPEG / WebP'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setMessage('');
            try {
              const result = await importAsset(file);
              callbacks.current.onAssets(result.assets);
              if (!mounted.current) return;
              callbacks.current.onChange(result.id);
              setMessage(`Uložené do src/assets/${result.id}`);
            } catch (error) {
              if (mounted.current)
                setMessage(
                  error instanceof Error ? error.message : 'Import selhal.',
                );
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        />
      </label>
      {message && (
        <p className="field-note" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function ConditionField({
  value,
  onChange,
  content,
  label = 'Podmínka',
  depth = 0,
}: {
  value?: Condition;
  onChange: (value: Condition | undefined) => void;
  content: GameContent;
  label?: string;
  depth?: number;
}) {
  const kind = !value
    ? 'always'
    : 'flag' in value
      ? 'flag'
      : 'item' in value
        ? 'item'
        : 'not' in value
          ? 'not'
          : 'all';
  return (
    <fieldset className="condition-field">
      <legend>{label}</legend>
      <select
        aria-label={`${label}: typ`}
        value={kind}
        onChange={(event) => {
          const type = event.target.value;
          onChange(
            type === 'always'
              ? undefined
              : type === 'flag'
                ? { flag: content.flags[0] ?? '', value: true }
                : type === 'item'
                  ? { item: content.items[0]?.id ?? '' }
                  : type === 'not'
                    ? { not: { flag: content.flags[0] ?? '' } }
                    : { all: [] },
          );
        }}
      >
        <option value="always">Vždy</option>
        <option value="flag">Herní příznak</option>
        <option value="item">Předmět v inventáři</option>
        {depth < 10 && (
          <>
            <option value="not">Negace (NE)</option>
            <option value="all">Všechny podmínky (A)</option>
          </>
        )}
      </select>
      {value && 'flag' in value && (
        <div className="field-row">
          <SelectId
            label="Příznak"
            value={value.flag}
            values={content.flags.map((id) => ({ id }))}
            onChange={(flag) => onChange({ ...value, flag })}
          />
          <Field label="Hodnota">
            <select
              value={String(value.value ?? true)}
              onChange={(event) =>
                onChange({ ...value, value: event.target.value === 'true' })
              }
            >
              <option value="true">Platí</option>
              <option value="false">Neplatí</option>
            </select>
          </Field>
        </div>
      )}
      {value && 'item' in value && (
        <SelectId
          label="Požadovaný předmět"
          value={value.item}
          values={content.items}
          onChange={(item) => onChange({ item })}
        />
      )}
      {value && 'not' in value && (
        <ConditionField
          content={content}
          value={value.not}
          onChange={(child) => onChange(child ? { not: child } : undefined)}
          label="Nesmí platit"
          depth={depth + 1}
        />
      )}
      {value && 'all' in value && (
        <>
          {value.all.map((child, index) => (
            <div className="condition-child" key={index}>
              <ConditionField
                content={content}
                value={child}
                depth={depth + 1}
                onChange={(next) =>
                  onChange({
                    all: next
                      ? replaceAt(value.all, index, next)
                      : value.all.filter((_, position) => position !== index),
                  })
                }
                label={`Podmínka ${index + 1}`}
              />
              <button
                onClick={() =>
                  onChange({
                    all: value.all.filter((_, position) => position !== index),
                  })
                }
              >
                Odebrat podmínku
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onChange({
                all: [...value.all, { flag: content.flags[0] ?? '' }],
              })
            }
          >
            + Podmínka
          </button>
        </>
      )}
    </fieldset>
  );
}
export function EffectsField({
  value = [],
  onChange,
  content,
}: {
  value?: readonly Effect[];
  onChange: (effects: readonly Effect[]) => void;
  content: GameContent;
}) {
  const firstId = (type: Effect['type']) =>
    type === 'flag'
      ? (content.flags[0] ?? '')
      : type === 'scene' || type === 'unlockScene'
        ? (content.scenes[0]?.id ?? '')
        : type === 'dialogue'
          ? (content.dialogues[0]?.id ?? '')
          : type === 'startTask' || type === 'completeTask'
            ? (content.tasks?.[0]?.id ?? '')
            : type === 'minigame'
              ? (content.minigames?.[0]?.id ?? '')
              : (content.items[0]?.id ?? '');
  return (
    <fieldset className="effects-field">
      <legend>Efekty (v pořadí)</legend>
      {value.map((effect, index) => {
        const values =
          effect.type === 'flag'
            ? content.flags.map((id) => ({ id }))
            : effect.type === 'scene' || effect.type === 'unlockScene'
              ? content.scenes.map((scene) => ({
                  id: scene.id,
                  label: scene.title,
                }))
              : effect.type === 'dialogue'
                ? content.dialogues
                : effect.type === 'startTask' || effect.type === 'completeTask'
                  ? (content.tasks ?? []).map((task) => ({
                      id: task.id,
                      label: task.text,
                    }))
                  : effect.type === 'minigame'
                    ? (content.minigames ?? []).map((game) => ({
                        id: game.id,
                      }))
                    : content.items;
        return (
          <div className="effect-row" key={index}>
            <div className="field-row">
              <Field label="Efekt">
                <select
                  value={effect.type}
                  onChange={(event) => {
                    const type = event.target.value as Effect['type'];
                    onChange(
                      replaceAt(
                        value,
                        index,
                        type === 'flag'
                          ? { type, id: firstId(type), value: true }
                          : { type, id: firstId(type) },
                      ),
                    );
                  }}
                >
                  <option value="flag">Nastavit příznak</option>
                  <option value="addItem">Přidat předmět</option>
                  <option value="removeItem">Odebrat předmět</option>
                  <option value="scene">Změnit lokaci</option>
                  <option value="unlockScene">Odemknout lokaci na mapě</option>
                  <option value="dialogue">Otevřít dialog</option>
                  <option value="startTask" disabled={!content.tasks?.length}>
                    Přidat úkol do deníku
                  </option>
                  <option
                    value="completeTask"
                    disabled={!content.tasks?.length}
                  >
                    Dokončit úkol
                  </option>
                  <option
                    value="minigame"
                    disabled={!content.minigames?.length}
                  >
                    Spustit minihru
                  </option>
                </select>
              </Field>
              <SelectId
                label="Cíl efektu"
                value={effect.id}
                values={values}
                onChange={(id) =>
                  onChange(replaceAt(value, index, { ...effect, id }))
                }
              />
            </div>
            {effect.type === 'flag' && (
              <Field label="Nová hodnota">
                <select
                  value={String(effect.value)}
                  onChange={(event) =>
                    onChange(
                      replaceAt(value, index, {
                        ...effect,
                        value: event.target.value === 'true',
                      }),
                    )
                  }
                >
                  <option value="true">Platí</option>
                  <option value="false">Neplatí</option>
                </select>
              </Field>
            )}
            <div className="row-actions">
              <button
                disabled={index === 0}
                onClick={() => {
                  const next = [...value];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  onChange(next);
                }}
              >
                ↑ Efekt
              </button>
              <button
                onClick={() =>
                  onChange(value.filter((_, position) => position !== index))
                }
              >
                Odebrat efekt
              </button>
            </div>
          </div>
        );
      })}
      <button
        onClick={() =>
          onChange([
            ...value,
            { type: 'flag', id: firstId('flag'), value: true },
          ])
        }
      >
        + Efekt
      </button>
    </fieldset>
  );
}
export function RulesField({
  value = [],
  onChange,
  content,
}: {
  value?: readonly Rule[];
  onChange: (rules: readonly Rule[]) => void;
  content: GameContent;
}) {
  return (
    <div className="rules-field">
      <p className="field-note">
        Vyhraje první splněné pravidlo. Pravidlo „Vždy“ patří poslední.
      </p>
      {value.map((rule, index) => (
        <details className="rule-card" key={index} open>
          <summary>
            Pravidlo {index + 1} · {rule.when ? 'podmíněné' : 'vždy'}
          </summary>
          <Field label="Reakce">
            <textarea
              value={rule.message ?? ''}
              onChange={(event) =>
                onChange(
                  replaceAt(value, index, {
                    ...rule,
                    message: event.target.value,
                  }),
                )
              }
            />
          </Field>
          <ConditionField
            content={content}
            value={rule.when}
            onChange={(when) =>
              onChange(replaceAt(value, index, { ...rule, when }))
            }
          />
          <EffectsField
            content={content}
            value={rule.effects}
            onChange={(effects) =>
              onChange(replaceAt(value, index, { ...rule, effects }))
            }
          />
          <div className="row-actions">
            <button
              disabled={index === 0}
              onClick={() => {
                const next = [...value];
                [next[index - 1], next[index]] = [
                  next[index]!,
                  next[index - 1]!,
                ];
                onChange(next);
              }}
            >
              ↑ Pravidlo
            </button>
            <button
              onClick={() =>
                onChange(value.filter((_, position) => position !== index))
              }
            >
              Odebrat pravidlo
            </button>
          </div>
        </details>
      ))}
      <button
        onClick={() => onChange([...value, { message: 'Nová reakcia.' }])}
      >
        + Pravidlo
      </button>
    </div>
  );
}
