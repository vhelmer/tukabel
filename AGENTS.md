# TUKABEL

Komediální 2D point-and-click adventura „Záhada strateného kábla“, inspirovaná
Poldou a slovenskými internetovými legendami. Třídenní AI hackathon: preferuj
malé funkční změny, konkrétní obsah a minimum režie. Hra běží jen v prohlížeči.

## Konvence

- TypeScript strict, React + Vite, PixiJS 8. Používej npm a commitovaný lockfile.
- React vlastní UI a stav; Pixi vlastní canvas, vykreslování a pointer interakce.
  Nevytvářej obecný engine, ECS, event bus ani backend bez konkrétní potřeby.
- Definice lokací patří do `src/game/scenes/`, typy do `src/game/types.ts`,
  propojení Pixi do `src/game/createScene.ts`, React UI do `src/ui/`.
- Pozadí a hotspoty sdílejí souřadnice definované velikostí lokace (demo 1280×720).
  Škáluj celou scénu, nikoli jednotlivé hotspoty podle velikosti obrazovky.
- Assety drž lokálně v `src/assets/` a importuj přes Vite. SVG jde upravovat kódem;
  pro finální kreslená pozadí lze použít generované PNG/WebP. Bez ručních editorů,
  vzdálených CDN a kopírování cizích herních assetů.
- Kód a identifikátory anglicky, hráčské texty slovensky, komunikace/dokumentace česky.
- U asynchronního Pixi init/load ošetři unmount; při úklidu odpoj ResizeObserver,
  listenery a znič aplikaci. React StrictMode zůstává zapnutý.

## Workflow

- `README.md` obsahuje spuštění, mapu projektu a aktuální rozsah. Aktualizuj jej
  při změně architektury nebo příkazů; nevytvářej paralelní Markdown dokumentaci.
- `npm run check` ověří lint, formát, typy a produkční build. Pro změny Pixi/React
  propojení nebo ovládání spusť `npm run test:e2e` (instalace Chromium v README).
  Lokální testy nemají přístup k produkci a lze je spouštět samostatně.
- Po dokončení logického celku vytvoř stručný commit v angličtině. Stageuj konkrétní
  soubory a zachovej rozpracované uživatelské změny. Lokální `.codex/` necommituj.
- Aktuální stav musí být dohledatelný v kódu, README a Git historii; nespoléhej
  na kontext předchozí session. Skills přidej až pro prokázaný opakovaný workflow,
  nikoli pro běžné přidání hotspotu nebo spuštění npm příkazů.

## Herní obsah a stav

- Autorský obsah piš jako readonly TypeScriptová data bez callbacků: lokace v
  `src/game/scenes/`, předměty/dialogy/registr v `src/game/content/`. Vše v Gitu.
- Pravidla akcí vybírají první vyhovující podmínku; bezpodmínečný fallback patří
  poslední. Podmínky a efekty jsou společné pro akce, kombinace i dialogy.
- Nové příznaky registruj v `content.flags`. ID drž stabilní; při nekompatibilní
  změně obsahu změň `content.id`. Definice nemutuj, postup mění pouze čistý reducer.
- Sebratelné objekty kresli samostatným `image` a skrývej přes `visibleWhen`,
  nikoli jako součást trvalého pozadí. UI výběr nepatří do uložené pozice.
- `npm run check` zahrnuje i validaci skutečného obsahu a testy pravidel.
  Řešitelnost nové hádanky ověř průchodem v `tests/scene.spec.ts`.

## Aktuální rozsah

Dvě zkušební lokace: kontextové akce i explicitní slovesa, inventář a kombinace,
podmíněné dialogy, stav hádanky, dynamické hotspoty, přechody a verzovaný ruční
save/load v localStorage. Ovládání canvasem, dotykem i HTML klávesnicí. Krátká
kompletní technická hádanka bez skutečného příběhu a finálních assetů.
Podrobnosti formátu a průchod jsou v README. Pohyb postavy a zvuk zatím chybí.
