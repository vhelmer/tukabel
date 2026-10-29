import { useEffect, useRef, type ReactNode } from 'react';
import { subtitleText } from '../game/subtitles';
import type { useConversation } from './useConversation';

export function DialoguePanel({
  conversation,
  audio,
  subtitle,
  needsAudioGesture = false,
  onAdvance,
}: {
  conversation: ReturnType<typeof useConversation>;
  audio?: ReactNode;
  subtitle?: string;
  needsAudioGesture?: boolean;
  onAdvance: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const { node, phase, choices, ready } = conversation;
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    if (ready)
      panel.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus();
  }, [phase, ready, conversation.utteranceKey]);
  if (!node) return null;
  const speaking = phase === 'speech';
  return (
    <div
      className={`dialogue-panel ${speaking ? 'is-speaking' : 'is-choosing'}`}
      role="dialog"
      aria-label="Rozhovor"
      aria-modal="true"
      inert={conversation.paused}
      aria-hidden={conversation.paused}
      ref={panel}
      onPointerDownCapture={conversation.guardRepeatedPointer}
      onKeyDown={(event) => {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          return;
        }
        if (event.key !== 'Tab') return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      {speaking ? (
        <>
          <button
            key={conversation.utteranceKey}
            type="button"
            className="dialogue-caption"
            aria-label={
              needsAudioGesture ? 'Spustiť dabing' : 'Dokončiť repliku'
            }
            aria-describedby="dialogue-text"
            title={
              needsAudioGesture
                ? 'Kliknutím alebo dotykom spustíš dabing'
                : 'Kliknutím alebo dotykom dokončíš repliku'
            }
            disabled={!ready}
            onClick={onAdvance}
          >
            <span className="dialogue-speaker">{node.speaker}</span>
            <span id="dialogue-text" aria-live="polite" aria-atomic="true">
              {subtitle ?? subtitleText(node)}
            </span>
          </button>
          {audio}
        </>
      ) : (
        <div className="dialogue-choices" aria-label="Možnosti rozhovoru">
          {conversation.intro ? (
            <button
              className="dialogue-choice"
              disabled={!ready}
              onClick={conversation.start}
            >
              Porozprávať sa.
            </button>
          ) : (
            choices.map((choice, index) => (
              <button
                key={choice.id}
                className="dialogue-choice"
                disabled={!ready}
                onClick={() => conversation.choose(choice.id)}
              >
                <span className="choice-mark" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{choice.text}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
