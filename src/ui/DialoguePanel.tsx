import { useEffect, useRef, type ReactNode } from 'react';
import { subtitleText } from '../game/subtitles';
import type { useConversation } from './useConversation';

export function DialoguePanel({
  conversation,
  audio,
  subtitle,
  hasSpeech,
}: {
  conversation: ReturnType<typeof useConversation>;
  audio?: ReactNode;
  subtitle?: string;
  hasSpeech: boolean;
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
          <div className="dialogue-caption">
            <span className="dialogue-speaker">{node.speaker}</span>
            <p id="dialogue-text" aria-live="polite" aria-atomic="true">
              {subtitle ?? subtitleText(node)}
            </p>
          </div>
          <div className="dialogue-line-controls" inert={!ready}>
            {audio}
            {!hasSpeech && (
              <button disabled={!ready} onClick={conversation.finish}>
                Pokračovať
              </button>
            )}
          </div>
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
                onClick={(event) => {
                  if (event.detail <= 1) conversation.choose(choice.id);
                }}
              >
                <span className="choice-mark" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{choice.text}</span>
              </button>
            ))
          )}
          {!conversation.intro && !choices.length && (
            <button
              className="dialogue-choice"
              disabled={!ready}
              onClick={conversation.close}
            >
              Rozlúčiť sa.
            </button>
          )}
        </div>
      )}
      <button
        className="dialogue-close"
        aria-label="Ukončiť rozhovor"
        title="Ukončiť rozhovor (Esc)"
        onClick={conversation.close}
      >
        ×
      </button>
    </div>
  );
}
