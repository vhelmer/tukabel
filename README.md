# TUKABEL: Záhada strateného kábla

Základ komediální 2D point-and-click adventury pro třídenní AI hackathon.
TypeScript + React + Vite, scény v PixiJS 8. Kompletně v prohlížeči,
bez backendu a externích služeb za běhu. Obsah i lokální assety žijí v Gitu.

## Spuštění a kontrola

Node.js **20.19+ nebo 22.12+** a npm.

```sh
npm ci
npm run dev
npm run check             # lint, formát, obsah, pravidla, typy a produkční build
npm run validate:content  # odkazy a konzistence skutečných herních definic
npm run test:rules        # reducer, validátor a save/load bez prohlížeče
npm run preview          # lokální náhled již vytvořeného dist/
```

Vite standardně vypíše `http://localhost:5173`. `dist/` lze vystavit na statickém
hostingu, i v podadresáři. `file://` není podporované; použij HTTP server.

## Hratelná ukázka

Dvě zkušební lokace demonstrují rozhovor, podmíněné odpovědi, inventář,
kombinování, použití předmětu, změnu prostředí, přechod a ruční save/load.
Jde o technickou hádanku s dočasným obsahem, nikoli skutečný příběh.

Průchod: promluv se správcem → zeptej se na opravu → požádej o pásku → ukonči
rozhovor → seber kabel u židle → spoj kabel s páskou v inventáři → vyber opravený
kabel a klikni na router → použij dveře do dvora → prozkoumej tabuli.
Lze se vrátit do první místnosti; vyřešený stav zůstává zachovaný.

- Klik/tap provede kontextovou akci objektu. Lišta dovoluje explicitně vybrat
  prozkoumání, sebrání, rozhovor nebo použití.
- Klik na inventář vybere předmět. Další klik ve scéně jej použije; klik na jiný
  předmět v inventáři zkusí kombinaci v libovolném pořadí. Chybný pokus nic nespotřebuje.
  Vybraný předmět lze samostatně prozkoumat. Escape nebo druhý klik výběr zruší.
- Zvýraznění funguje při hoveru, při zaměření HTML tlačítka a přepínačem všech
  hotspotů. Všechny akce mají HTML ovládání přes Tab/Enter, včetně dialogů.
  Rozhovor blokuje interakce se světem; Escape jej ukončí.
- Sebraný kabel zmizí i z canvasu, opravený router dostane zelený indikátor.
  Přechody a reakce mají krátké prolínání respektující omezení pohybu systému.
- **Uložit hru** přepíše jeden lokální slot; **Načíst hru** obnoví i rozmluvený
  dialog. Po reloadu začíná nová hra a uloženou lze načíst tlačítkem. **Nová hra**
  slot nemaže. Není automatické ukládání. Slot patří konkrétnímu prohlížeči a originu.
  Nepřístupné úložiště, cizí verze nebo poškozená data zobrazí zprávu a zachovají hru.

## Mapa projektu a architektura

- `src/game/types.ts` — datové typy obsahu, podmínek, efektů, stavu a příkazů.
- `src/game/content/` — seznam předmětů, dialogy a registr obsahu s kombinacemi.
- `src/game/scenes/` — definice lokací, hotspotů a reakcí.
- `src/game/state.ts` — čistý reducer, vyhodnocení podmínek a aplikace efektů.
- `src/game/validateContent.ts` — kontrola ID, odkazů, rozměrů a pořadí pravidel.
- `src/game/storage.ts` — verzovaná JSON obálka, validace a lokální save/load.
- `src/game/createScene.ts` — Pixi pozadí, lokální sprity, hotspoty a stavové indikátory.
- `src/ui/` — životní cyklus Pixi canvasu, inventář a dialogové UI.
- `src/App.tsx` — React reducer a dočasný stav ovládání (sloveso, výběr, hover).
- `src/assets/` — lokální SVG; pozadí lze nahradit PNG/WebP přes Vite import.
- `tests/` — testy pravidel a skutečné průchody v Chromium.

React vlastní veškerý stav. Pixi dostává definici a stav k vykreslení, vrací pouze
hover/klik. Celá scéna se škáluje ve společných souřadnicích 1280×720. Změna stavu
aktualizuje existující canvas, přechod lokace jej bezpečně vymění. Asynchronní init
je odolný vůči unmountu a StrictMode; observer, aplikace a listenery se uklízejí.
Textury sdílí cache Assets. Statické scény nepotřebují trvalý render loop.

Není zde ECS, event bus, backend ani skriptovací jazyk. Herní příkaz reducer
zpracuje atomicky. Událost je konkrétní seznam efektů; stav hádanky vyjadřují
pojmenované boolean příznaky a vlastnictví předmětů. Pohyb postavy, dabing, zvuk,
více slotů, migrace starších pozic a rozsáhlé animace zatím implementované nejsou.

## Tvorba obsahu

Obsah zapisuj jako typované **TypeScriptové datové objekty**, bez callbacků a
vedlejších účinků. Je to čitelná alternativa JSON s komentáři, kontrolou typů a
přímými Vite importy assetů; změna obsahu nevyžaduje změnu reduceru ani UI.
Novou lokaci přidej do `src/game/scenes/` a registru `content.scenes`. Postavy jsou
hotspoty s akcí `talk`; jejich texty patří do `content/dialogues.ts`. Položky
inventáře přidej do `content/items.ts`. Hráčské texty piš slovensky.

Každá lokace/předmět/dialog má stabilní globální ID. Hotspoty jsou unikátní v lokaci,
uzly v dialogu a odpovědi v uzlu. Příznaky předem registruj v `content.flags`;
nepřítomný příznak má hodnotu `false`. Definice jsou readonly, hráčský stav obsahuje
jen ID lokace, seznam předmětů, příznaky, aktivní dialogový uzel a poslední zprávu.

Podmínky: `{ flag: 'powered' }`, `{ flag: 'powered', value: false }`,
`{ item: 'tape' }`, `{ not: condition }`, `{ all: [condition, ...] }`.
Nepřítomná podmínka vždy platí. Stejné podmínky používají `visibleWhen`,
`tintWhen`, pravidla akcí i dialogové odpovědi.

Akce `look/take/talk/use` mají seřazená pravidla `{ when?, message, effects? }`.
**První vyhovující pravidlo vyhrává**; bezpodmínečnou reakci dej poslední.
`defaultVerb` určuje kontextový klik. `uses` mapuje ID předmětu na pravidla jeho
použití. Nedefinovaná akce/kombinace má bezpečnou výchozí reakci. Pravidla kombinací
jsou v registru a jsou symetrická; spotřebu ingrediencí zapiš explicitně efekty.

Efekty (v uvedeném pořadí):

```ts
[
  { type: 'removeItem', id: 'fixedCable' },
  { type: 'flag', id: 'powered', value: true },
  { type: 'addItem', id: 'tape' },
  { type: 'scene', id: 'courtyard' },
  { type: 'dialogue', id: 'caretaker' },
];
```

Používej jen efekty potřebné pro danou akci. `addItem` nevytvoří duplicitní předmět.
Jednorázový pickup schovej přes příznak `visibleWhen`; jeho `image` je samostatný
lokální sprite, takže se schová spolu s hotspotem. Věc, která má zmizet, nekresli do
trvalého pozadí. Rozměry sprite odpovídají bounds hotspotu. `tintWhen` rozsvítí
jednoduchý zelený indikátor (pro složitější změnu použij podmíněné hotspoty/sprity).

Dialog má `start` a uzly `{ id, speaker, text, choices }`. Odpověď má `id`, `text`,
volitelnou podmínku, efekty, zprávu a `next` (ID uzlu stejného dialogu). Bez `next`
rozhovor skončí; efekty mohou otevřít jiný dialog. V každém uzlu ponech dostupný
odchod; UI navíc vždy dovolí rozhovor ukončit bez efektu. Hlášení výsledku akce
patří do `message`, promluva postavy do `text`.

`npm run validate:content` přes Vite načte skutečné definice a odmítne chybné
odkazy v podmínkách/efektech, chybějící dialogové uzly, duplicity ID i kombinací,
chybějící kontextové akce, zastíněná pravidla a hotspoty mimo scénu. Běží v `check`
a obsah se kontroluje také při startu hry. TypeScript hlídá tvar autorských dat.
Validátor nedokazuje řešitelnost hádanek; tu ověřuj automatickým průchodem.
Při nekompatibilní změně obsahu změň `content.id`; při změně struktury save zvyš
verzi obálky a klíč v `storage.ts`. Zatím se staré pozice odmítají bez migrace.

## Ověření v prohlížeči

```sh
npx playwright install chromium
npm run test:e2e
```

Na minimálním Linuxu lze použít `npx playwright install --with-deps chromium`.
Nebo nastav `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome`.
Testy spustí vlastní Vite server a nemají přístup k produkci. Desktop a dotykový
profil ověřují kompletní hádanku, změnu velikosti canvasu, chybné použití,
opakovaný dialog, přechody tam/zpět, save/load po reloadu, klávesnici, poškozené
úložiště a obnovu po chybě assetu. Při selhání uloží screenshot/trace do
ignorovaného `test-results/`.

Instrukce pro agenty jsou v [AGENTS.md](AGENTS.md).
