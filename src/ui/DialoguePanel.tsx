import { useEffect, useRef } from 'react';
import { getDialogueNode, matches } from '../game/state';
import type { GameAction, GameContent, GameState } from '../game/types';

export function DialoguePanel({
  content,
  state,
  dispatch,
}: {
  content: GameContent;
  state: GameState;
  dispatch: (action: GameAction) => void;
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
    >
      <p className="eyebrow" id="speaker">
        {node.speaker}
      </p>
      <p id="dialogue-text">{node.text}</p>
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
