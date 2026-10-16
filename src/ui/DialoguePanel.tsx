import { useEffect, useRef, type ReactNode } from 'react';
import { getDialogueNode, matches } from '../game/state';
import type { GameAction, GameContent, GameState } from '../game/types';
import { subtitleText } from '../game/subtitles';

export function DialoguePanel({
  content,
  state,
  dispatch,
  audio,
  subtitle,
}: {
  content: GameContent;
  state: GameState;
  dispatch: (action: GameAction) => void;
  audio?: ReactNode;
  subtitle?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const node = getDialogueNode(content, state);
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    panel.current?.querySelector('button')?.focus();
  }, [state.dialogue?.id, node?.id]);
  if (!node) return null;
  return (
    <div
      className="dialogue-panel"
      role="dialog"
      aria-labelledby="speaker"
      aria-describedby="dialogue-text"
      ref={panel}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const buttons = event.currentTarget.querySelectorAll('button');
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
      <div className="dialogue-heading">
        {node.portrait ? (
          <img className="dialogue-portrait" src={node.portrait} alt="" />
        ) : (
          <span className="dialogue-monogram" aria-hidden="true">
            {node.speaker.slice(0, 1)}
          </span>
        )}
        <div>
          <p className="eyebrow">ROZHOVOR</p>
          <p id="speaker" className="dialogue-speaker">
            {node.speaker}
          </p>
        </div>
      </div>
      <p id="dialogue-text" key={node.id} aria-live="polite" aria-atomic="true">
        {subtitle ?? subtitleText(node)}
      </p>
      {audio}
      <div className="dialogue-choices">
        {node.choices
          .filter((choice) => matches(state, choice.when))
          .map((choice) => (
            <button
              key={choice.id}
              onClick={() => dispatch({ type: 'choose', choiceId: choice.id })}
            >
              {choice.text}
            </button>
          ))}
      </div>
      <button
        className="text-button"
        onClick={() => dispatch({ type: 'closeDialogue' })}
      >
        Ukončiť rozhovor
      </button>
    </div>
  );
}
