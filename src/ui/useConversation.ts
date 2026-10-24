import { useCallback, useEffect, useRef, useState } from 'react';
import { getDialogueNode, matches, reduceGame } from '../game/state';
import type { GameAction, GameContent, GameState } from '../game/types';

const INPUT_QUIET_MS = 300;

// Presentation phases never enter saves. A synchronous gate consumes a click
// before React commits; a quiet period also absorbs repeated taps/key repeat.
export function useConversation(
  content: GameContent,
  state: GameState,
  dispatch: (action: GameAction) => void,
  paused: boolean,
) {
  const node = getDialogueNode(content, state);
  const autoEntry =
    content.dialogues.find((d) => d.id === state.dialogue?.id)?.entry ===
    'speech';
  const key = state.dialogue
    ? `${state.dialogue.id}/${state.dialogue.nodeId}`
    : '';
  const [flow, setFlow] = useState({
    key: '',
    phase: 'entry' as 'entry' | 'speech' | 'choices',
    nonce: 0,
  });
  const phase = flow.key === key ? flow.phase : autoEntry ? 'speech' : 'entry';
  const token = `${key}:${flow.nonce}:${phase}`;
  const [armed, setArmed] = useState({ token: '', paused });
  // Invalidate readiness when the menu changes, even if this is the same line.
  if (armed.paused !== paused) setArmed({ token: '', paused });
  const gate = useRef(true);
  const activeLine = useRef('');
  const unblockAt = useRef(0);
  useEffect(() => {
    gate.current = true;
    activeLine.current = phase === 'speech' ? token : '';
    if (!key || paused) return;
    unblockAt.current = performance.now() + INPUT_QUIET_MS;
    let timer: number;
    const arm = () => {
      const remaining = unblockAt.current - performance.now();
      if (remaining > 0) {
        timer = window.setTimeout(arm, remaining);
        return;
      }
      gate.current = false;
      setArmed({ token, paused });
    };
    timer = window.setTimeout(arm, INPUT_QUIET_MS);
    return () => window.clearTimeout(timer);
  }, [token, key, paused, phase]);
  const choices =
    node?.choices.filter((choice) => matches(state, choice.when)) ?? [];
  const ready = armed.token === token && !paused;
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
  const finish = () => {
    if (phase !== 'speech' || activeLine.current !== token) return;
    activeLine.current = '';
    gate.current = true;
    if (!choices.length) {
      close();
      return;
    }
    setFlow((previous) =>
      previous.key !== key && autoEntry
        ? { key, phase: 'choices', nonce: previous.nonce }
        : previous.key === key &&
            previous.nonce === flow.nonce &&
            previous.phase === 'speech'
          ? { ...previous, phase: 'choices' }
          : previous,
    );
  };
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
    finish,
    guardRepeatedPointer: () => {
      if (gate.current) unblockAt.current = performance.now() + INPUT_QUIET_MS;
    },
    advance: (stop: () => void) => {
      if (gate.current || paused || phase !== 'speech') return;
      gate.current = true;
      stop();
      finish();
    },
  };
}
