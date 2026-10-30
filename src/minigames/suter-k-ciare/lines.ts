// Slovak commentary by the Detské ihrisko kids. They are only heard, never drawn.
export type Speaker = 'spluch' | 'nika' | 'bela';

export type Cue =
  | 'intro'
  | 'yourTurn'
  | 'playerGreat'
  | 'playerGood'
  | 'playerMeh'
  | 'playerOver'
  | 'opponentGreat'
  | 'opponentGood'
  | 'opponentMeh'
  | 'opponentOver'
  | 'win'
  | 'lose'
  | 'draw'
  | 'nobody';

export const OPPONENT: Speaker = 'spluch';

export const NAMES: Record<Speaker, string> = {
  spluch: 'Špľuch',
  nika: 'Nika',
  bela: 'Béla',
};

type Line = [Speaker, string];

export const LINES: Record<Cue, Line[]> = {
  intro: [
    ['nika', 'Čiaru som kreslila ja. Kto ju prehodí, do tej čiary spadne.'],
    ['spluch', 'Tri šutre. Kto bližšie k čiare, ten pohladká tehlu.'],
    ['bela', 'Ja to rozhodujem zhora. Odtiaľto ste všetci rovnako malí.'],
  ],
  yourTurn: [
    ['spluch', 'No, hádž. Tehla sa nudí.'],
    ['nika', 'Ty si na rade. Len netraf mňa.'],
    ['bela', 'Hádž. Ak trafíš mňa, poistka to nekryje.'],
  ],
  playerGreat: [
    ['nika', 'Na milimeter! Tú čiaru si ide zarámovať.'],
    ['bela', 'Zhora to vyzerá ako zázrak. Zdola asi tiež.'],
    ['spluch', 'To bola náhoda. Tehla to videla inak.'],
  ],
  playerGood: [
    ['bela', 'Ujde to. Ako polievka z vrecka.'],
    ['nika', 'Nie zlé. Na dospeláka.'],
  ],
  playerMeh: [
    ['nika', 'To si hodil, alebo ti to vypadlo z vrecka?'],
    ['spluch', 'Moja tehla hádže ďalej. A nemá ruky.'],
    ['bela', 'Zhora vidím, že si to pokazil. Aj zdola.'],
  ],
  playerOver: [
    ['nika', 'Prehodené! Moja čiara plače.'],
    ['bela', 'Až do žihľavy. Tam už ležia tri lopty a jeden dedko.'],
    ['spluch', 'Hahaha, rovno k pohrebákovi!'],
  ],
  opponentGreat: [
    ['spluch', 'Učte sa. Tehla ma trénovala.'],
    ['nika', 'Špľuch trafil. Svet sa končí.'],
  ],
  opponentGood: [
    ['spluch', 'Ani som sa nesnažil. Snažím sa iba v nedeľu.'],
    ['bela', 'Hm. Špľuch vie aj niečo iné než padať.'],
  ],
  opponentMeh: [
    ['nika', 'Špľuch, ty si ako hojdačka. Nehýbeš sa správnym smerom.'],
    ['bela', 'Hehe. Aj tehla by to hodila lepšie.'],
    ['spluch', 'Šmyklo sa mi! Potil som sa aj za tú bramboru!'],
  ],
  opponentOver: [
    ['spluch', 'To bol vietor! Fúkalo od kostola!'],
    ['nika', 'Špľuch prehodil. Zapisujem do knihy hanby.'],
  ],
  win: [
    ['nika', 'Vyhral si! Špľuch ide domov plakať do tehly.'],
    ['spluch', 'Však som ti dal vyhrať... Tehla to potvrdí.'],
  ],
  lose: [
    ['spluch', 'Choď domov. Tehla sa ti smeje.'],
    ['bela', 'Prehral si so Špľuchom. To sa nedá ani zhora.'],
  ],
  draw: [['nika', 'Remíza. Obaja ste rovnako nanič. Kreslím vám medailu.']],
  nobody: [['bela', 'Nikto netrafil. Idem radšej spadnúť z preliezačky.']],
};

/** Returns the line plus its index, which keys the recorded voice. */
export function pickLine(
  cue: Cue,
  rng: () => number = Math.random,
): [Speaker, string, number] {
  const options = LINES[cue];
  const index = Math.floor(rng() * options.length);
  return [...options[index]!, index];
}
