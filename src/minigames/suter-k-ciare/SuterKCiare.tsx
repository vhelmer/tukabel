// Self-contained minigame component. Render it inside any sized container; the
// 1280×720 scene scales to fit. React owns overlays, Pixi owns the canvas.
import { useEffect, useRef, useState } from 'react';
import { createGame, formatDistance, type GameHandle } from './createGame.ts';
import { unlockAudio } from './audio.ts';
import { NAMES, OPPONENT } from './lines.ts';
import type { MatchResult } from './match.ts';
import playgroundUrl from '../../assets/minigames/suter-k-ciare/playground.webp';
import './suterKCiare.css';
import { t } from '../../game/i18n';

export interface SuterKCiareProps {
  /** Called once per finished match (also after "Ešte raz"). */
  onFinish?: (result: MatchResult) => void;
  /** Shows a "Späť" button on the intro and result cards. */
  onExit?: () => void;
  /** Skip the intro card, e.g. when the host already explained the rules. */
  autoStart?: boolean;
}

interface Remark {
  id: number;
  name: string;
  text: string;
}

const TITLES: Record<MatchResult['outcome'], string> = {
  win: 'Vyhral si!',
  lose: 'Prehral si.',
  draw: 'Remíza.',
  nobody: 'Nikto netrafil.',
};

const VERDICTS: Record<MatchResult['outcome'], string> = {
  win: 'Špľuch ide domov plakať do tehly.',
  lose: 'Špľuch sa bude chváliť do Vianoc. Tehla tiež.',
  draw: 'Rovnako dobrí. Alebo rovnako zlí. Nika vám kreslí medailu.',
  nobody: 'Všetky šutre v žihľave. Čiara zostala nedotknutá ako panna.',
};

/** `**bold**` marks emphasis inside one translated sentence. */
function rich(text: string) {
  return text
    .split('**')
    .map((part, index) => (index % 2 ? <b key={index}>{part}</b> : part));
}

export function SuterKCiare({ onFinish, onExit, autoStart }: SuterKCiareProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameHandle | undefined>(undefined);
  const onFinishRef = useRef(onFinish);
  const [started, setStarted] = useState(!!autoStart);
  const [result, setResult] = useState<MatchResult>();
  const [remark, setRemark] = useState<Remark>();

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    let handle: GameHandle | undefined;
    let remarkTimer: number | undefined;
    let remarkId = 0;
    void createGame(hostRef.current!, {
      onFinish(r) {
        setResult(r);
        onFinishRef.current?.(r);
      },
      onSay(_speaker, name, text, seconds) {
        const id = ++remarkId;
        setRemark({ id, name, text });
        window.clearTimeout(remarkTimer);
        remarkTimer = window.setTimeout(
          () => setRemark((r) => (r?.id === id ? undefined : r)),
          seconds * 1000,
        );
      },
    }).then((h) => {
      if (cancelled) h.destroy();
      else gameRef.current = handle = h;
    });
    return () => {
      cancelled = true;
      window.clearTimeout(remarkTimer);
      handle?.destroy();
      gameRef.current = undefined;
    };
  }, [started]);

  const start = () => {
    unlockAudio();
    setStarted(true);
    hostRef.current?.focus({ preventScroll: true });
  };
  const again = () => {
    setResult(undefined);
    setRemark(undefined);
    gameRef.current?.restart();
    hostRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="skc">
      <div
        className="skc-stage"
        ref={hostRef}
        role="application"
        aria-label={t('Mierenie hodu')}
        aria-hidden={!started || Boolean(result)}
        tabIndex={started && !result ? 0 : -1}
      />
      {remark && !result && (
        <div className="skc-reaction" key={remark.id}>
          <b>{remark.name}</b>
          <p>{remark.text}</p>
        </div>
      )}
      {!started && (
        <div
          className="skc-overlay skc-intro"
          style={{ backgroundImage: `url(${playgroundUrl})` }}
        >
          <div className="skc-card">
            <h1>{t('Šuter k čiare')}</h1>
            <p>
              {rich(
                t(
                  'Hoď šuter **čo najbližšie k čiare**, ale **neprehoď ju**. Ty aj {name} máte po tri šutre, platí najlepší platný hod.',
                  { name: t(NAMES[OPPONENT]) },
                ),
              )}
            </p>
            <p className="skc-how">
              {rich(
                t('Chyť myšou kdekoľvek, **potiahni dozadu** ako prak a pusť.'),
              )}
              <br />
              {t(
                'Dĺžka ťahu je sila, sklon je výška. Nízky hod sa dlho šúcha, vysoký zastane skôr.',
              )}
              <br />
              {rich(
                t(
                  'Klávesnica: **↑ ↓ uhol, ← → sila**, Shift mení hodnoty rýchlejšie. **Enter alebo medzerník** hodí šuter.',
                ),
              )}
            </p>
            <div className="skc-buttons">
              <button onClick={start}>{t('Hádzať')}</button>
              {onExit && (
                <button className="skc-secondary" onClick={onExit}>
                  {t('Späť')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {result && (
        <div className="skc-overlay">
          <div className="skc-card">
            <h1>{t(TITLES[result.outcome])}</h1>
            <p>{t(VERDICTS[result.outcome])}</p>
            <table>
              <tbody>
                <tr>
                  <th>{t('Ty')}</th>
                  <td>{formatDistance(result.playerBest)}</td>
                </tr>
                <tr>
                  <th>{t(NAMES[OPPONENT])}</th>
                  <td>{formatDistance(result.opponentBest)}</td>
                </tr>
              </tbody>
            </table>
            <div className="skc-buttons">
              <button onClick={again}>{t('Ešte raz')}</button>
              {onExit && (
                <button className="skc-secondary" onClick={onExit}>
                  {t('Späť')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
