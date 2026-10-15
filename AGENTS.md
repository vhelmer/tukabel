# TUKABEL

Komediální 2D point-and-click adventura „Záhada strateného kábla“, inspirovaná
Poldou a slovenskými internetovými legendami. Třídenní AI hackathon: preferuj
malé funkční změny, konkrétní obsah a minimum režie. Hra běží jen v prohlížeči.

## Konvence

- TypeScript strict, React + Vite, PixiJS 8. Používej npm a commitovaný lockfile.
- React vlastní UI a stav; Pixi vlastní canvas, vykreslování a pointer interakce.
  Nevytvářej obecný engine, ECS, event bus ani backend bez konkrétní potřeby.
- Autorský obsah je v `src/game/content/project.json` (včetně lokací), typy
  v `src/game/types.ts`, Pixi v `src/game/createScene.ts`, React UI v `src/ui/`.
  Editor patří do `src/editor/`, lokální zápisová vrstva do `dev/editorPlugin.ts`.
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

- Autorský obsah piš jako čitelný JSON bez callbacků do jediného
  `src/game/content/project.json`. Nedrž paralelní TypeScriptové definice obsahu.
  Stabilní ID assetů jsou cesty relativní k `src/assets/`, nikoli URL.
- Pravidla akcí vybírají první vyhovující podmínku; bezpodmínečný fallback patří
  poslední. Podmínky a efekty jsou společné pro akce, kombinace i dialogy.
- Nové příznaky registruj v `flags` projektu. ID drž stabilní; při nekompatibilní
  změně obsahu změň ID projektu. Definice nemutuj, postup mění pouze čistý reducer.
- Sebratelné objekty kresli samostatným `image` a skrývej přes `visibleWhen`,
  nikoli jako součást trvalého pozadí. UI výběr nepatří do uložené pozice.
- `npm run check` zahrnuje i validaci skutečného obsahu a testy pravidel.
  Řešitelnost nové hádanky ověř průchodem v `tests/scene.spec.ts`.

## Editor a herní UI

- Game Mode drží veškeré hraní uvnitř jednoho okna: scéna, reakce, dialog,
  inventář, slovesa, seznam objektů i save/load menu. Drag/drop musí fungovat
  myší i dotykem; zachovej také klikací a klávesnicovou alternativu.
- SVG editor upravuje stejné souřadnice jako Pixi scéna. Úpravy návrhu jsou
  oddělené od hráčského postupu; náhled používá původní reducer bez zvláštních pravidel.
- Zápisy povol pouze v lokálním vývojovém Vite middleware: pevné cílové cesty,
  validace JSON i odkazů/assetů, kontrola revize a atomický zápis. Produkce a
  preview nesmějí mít editorové API ani editorový bundle.
- Editorové E2E zapisují do dočasných kopií projektu, nikdy do pracovních zdrojů.
  Při změně ukládání ověř reálný soubor, reload, konflikt i odmítnutí neplatných dat.

## Animace postav

- Registr `animations` je volitelnou součástí JSON projektu. Klipy odkazují na
  lokální snímky a původní `source`; vazba hotspotu musí používat stejný obrázek.
- Přehrávání je čistě vizuální: talk má přednost před blink a idle. Ticker zapínej
  jen pro aktivní postavy, uklízej listenery a respektuj pauzu / reduced motion.
- Animace generuj výhradně přes fal.ai image-to-video nad celým assetem, bez masek,
  inpaintingu či generování dílčích póz. `FAL_KEY` patří pouze serveru / `.env.local`.
  `OPENAI_API_KEY` ponech pro jiné budoucí funkce; animace jej nesmějí používat.
- Původní MP4, odeslaný PNG, exportované snímky a metadata jsou v `src/assets/animations/`.
  FFmpeg a klíčování celých snímků běží pouze v `dev/`; produkce přehrává lokální PNG.
  Zachovej poměr stran a kontrolu zdroje/revizí. Neslibuj vizuální konzistenci modelu.
- Testy nesmějí účtovat živé API požadavky. Používej kontrolované odpovědi modelu
  a dočasné assety; bez skutečného klíče netvrď, že byla ověřena kvalita generování.

## Aktuální rozsah

Dvě zkušební lokace: kontextové akce i explicitní slovesa, inventář a kombinace,
podmíněné dialogy, stav hádanky, dynamické hotspoty, přechody a verzovaný ruční
save/load v localStorage. Herní okno s drag/drop inventářem, dotykem i HTML klávesnicí.
Dev Mode upravuje lokace, hotspoty, assety, předměty, pravidla, dialogy a kombinace;
mapa logiky ukazuje podmínky a efekty. Ukládá se do zdrojového JSON v Gitu. Krátká
kompletní technická hádanka bez skutečného příběhu a finálních assetů.
Animace: fal.ai video celého assetu, video náhled, výběr úseku a PNG export,
náhodné mrkání, mluvení během dialogu a procedurální idle pohyb. MP4, PNG i metadata
se ukládají do Gitu; živé generování vyžaduje serverový FAL_KEY. Podrobnosti formátu a průchod
jsou v README. Chůze postavy a zvuk zatím chybí.
