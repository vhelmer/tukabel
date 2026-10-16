import { useCallback, useEffect, useRef, useState } from 'react';
import { getDialogueNode, matches, reduceGame } from '../game/state';
import type { GameAction, GameContent, GameState } from '../game/types';

// Presentation phases never enter saves. A synchronous gate consumes a click
// before React commits; a short re-arm delay also absorbs double taps/key repeat.
export function useConversation(
  content: GameContent,
  state: GameState,
  dispatch: (action: GameAction) => void,
  paused: boolean,
) {
  const node = getDialogueNode(content, state);
  const key = state.dialogue
    ? `${state.dialogue.id}/${state.dialogue.nodeId}`
    : '';
  const [flow, setFlow] = useState({
    key: '',
    phase: 'entry' as 'entry' | 'speech' | 'choices',
    nonce: 0,
  });
  const phase = flow.key === key ? flow.phase : 'entry';
  const token = `${key}:${flow.nonce}:${phase}`;
  const [armed, setArmed] = useState('');
  const gate = useRef(true);
  useEffect(() => {
    gate.current = true;
    if (!key || paused) return;
    const timer = window.setTimeout(() => {
      gate.current = false;
      setArmed(token);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [token, key, paused]);
  const choices =
    node?.choices.filter((choice) => matches(state, choice.when)) ?? [];
  const ready = armed === token && !paused;
  const reset = useCallback(() => {
    gate.current = true;
    setFlow((previous) => ({
      key: '',
      phase: 'entry',
      nonce: previous.nonce + 1,
    }));
  }, [setFlow]);
  const close = useCallback(() => {
    reset();
    dispatch({ type: 'closeDialogue' });
  }, [dispatch, reset]);
  return {
    phase,
    ready,
    paused,
    node,
    choices,
    intro: phase === 'entry' && !node?.choices.some((choice) => choice.next),
    utteranceKey: `${key}:${flow.nonce}`,
    reset,
    start: () => {
      if (gate.current || paused || phase !== 'entry' || !node) return;
      gate.current = true;
      setFlow((previous) => ({
        key,
        phase: 'speech',
        nonce: previous.nonce + 1,
      }));
    },
    choose: (choiceId: string) => {
      if (gate.current || paused || phase === 'speech' || !state.dialogue)
        return;
      const action: GameAction = {
        type: 'choose',
        choiceId,
        from: state.dialogue,
      };
      const next = reduceGame(content, state, action);
      if (next === state) return;
      gate.current = true;
      setFlow((previous) => ({
        key: next.dialogue ? `${next.dialogue.id}/${next.dialogue.nodeId}` : '',
        phase: 'speech',
        nonce: previous.nonce + 1,
      }));
      dispatch(action);
    },
    finish: () => {
      if (phase !== 'speech') return;
      gate.current = true;
      setFlow((previous) =>
        previous.key === key &&
        previous.nonce === flow.nonce &&
        previous.phase === 'speech'
          ? { ...previous, phase: 'choices' }
          : previous,
      );
    },
    close,
  };
}
