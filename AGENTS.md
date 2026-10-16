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
  inventář, seznam objektů i save/load menu. Drag/drop musí fungovat
  myší i dotykem; zachovej také klikací a klávesnicovou alternativu.
- SVG editor upravuje stejné souřadnice jako Pixi scéna. Úpravy návrhu jsou
  oddělené od hráčského postupu; náhled používá původní reducer bez zvláštních pravidel.
- Proporce a natočení počítej v `src/game/transforms.ts` pro SVG i Pixi, včetně
  cílení inventáře. Obrázky se standardně vejdou do rámu bez deformace; protažení
  vyžaduje explicitní `imageFit: "stretch"`. `rotation` jsou stupně kolem středu
  `bounds`; validátor hlídá i natočený rám. Zoom a úchyty nepatří do herního JSON.
- Obrázkové hotspoty používají automatické alfa cílení (`hitTest.ts`, cache v
  `alphaMasks.ts`), výchozí `alphaThreshold` je 32/255. `hitTest: "bounds"` výslovně
  zachová ruční obdélník; bez obrázku a polygonu platí rám. Pixi, inventární dropy i SVG
  editor sdílejí stejnou masku a transformace. Rámy/pomocné popisky nesmějí blokovat
  průhledné části; samostatné transformační úchyty a výběr ze seznamu zůstávají.
  Animované cílení sleduje aktuální snímek a idle pohyb. Nečti pixely při pointer
  událostech a nepřidávej obdélníkový fallback pro chybějící masku.
- `hotspot.polygon` obsahuje 3–128 různých bodů `{x,y}` v souřadnicích lokace
  před rotací, uvnitř `bounds`. Má přednost před alfa maskou i `hitTest`; bez něj
  zůstává původní chování. `polygon.ts` sdílí konkávní cílení a kontrolu křížení.
  Změny rámu musí přepočítat body přes `polygonTools.ts`; při úpravě vrcholu
  zachovej světové pozice ostatních bodů i při změně středu rotace. Ovládací
  úchyty patří pouze do editoru, Game Mode žádný obrys polygonu nevykresluje.
- Normální resize zachovává poměr stran i v číselných polích. Tah se ukládá jako
  jediná úprava; Escape/pointercancel nic nemění. Úchyty zobrazuj nad ostatními objekty.
- Zápisy povol pouze v lokálním vývojovém Vite middleware: pevné cílové cesty,
  validace JSON i odkazů/assetů, kontrola revize a atomický zápis. Produkce a
  preview nesmějí mít editorové API ani editorový bundle.
- Editorové E2E zapisují do dočasných kopií projektu, nikdy do pracovních zdrojů.
  Při změně ukládání ověř reálný soubor, reload, konflikt i odmítnutí neplatných dat.

- Hotspot má jediná pravidla `onClick` a volitelné `uses` pro inventář. Žádná
  slovesa / hráčské režimy ani obrysy při hoveru. `onClick: []` je tichá kulisa;
  `message` pravidla je volitelná. Kurzory a portréty se nastavují daty v editoru.
- Inventární `item.image` je samostatná ikonka. Pickup efekt je pouze vizuální,
  spouští ho skutečné získání přes akci, nikoli load/reset nebo přepnutí režimu.

## Animace postav

- Registr `animations` je volitelnou součástí JSON projektu. Klipy odkazují na
  lokální snímky a původní `source`; vazba hotspotu musí používat stejný obrázek.
- Přehrávání je čistě vizuální: talk má přednost před reakcí, blink a idle. Ticker zapínej
  jen pro aktivní postavy, uklízej listenery a respektuj pauzu / reduced motion.
- Hotové PNG sekvence a Pixi/TexturePacker spritesheety importuj lokálně přes
  `dev/animationImport.ts`. Import atomicky uloží celé klipy; oříznuté atlasové
  snímky obnoví na původní plátno, otočená atlasová políčka odmítne.
- Všechny snímky musí mít stejné rozměry a zarovnání jako `source`. Neškáluj
  jednotlivé pózy a neměň anchor. Kontrola rozměrů běží při importu, save i check.
- `durationsMs` je volitelné časování jednotlivých snímků (jinak `fps`), `speed`
  násobí rychlost. Klipy a vazby jsou v projektovém JSON; importní `clip.json`
  je archivní záznam, nikoli druhý zdroj herního obsahu.
- `animation.onClick` / `onUse` spouští jednorázové klipy. Priorita je talk → reakce →
  blink → idle. Vizuální požadavky ani hodiny nepatří do uloženého postupu hráče.
- Animace nepoužívají externí AI API ani video pipeline. `OPENAI_API_KEY` zůstává
  rezervovaný pro budoucí jiné funkce, pouze v prostředí serveru / `.env.local`.
  Klíče nikdy do `VITE_`, klienta nebo autorského JSON.

## Aktuální rozsah

Dvě zkušební lokace: kontextové klikání, inventář a kombinace,
podmíněné dialogy, stav hádanky, dynamické hotspoty, přechody a verzovaný ruční
save/load v localStorage. Herní okno s drag/drop inventářem, dotykem i HTML klávesnicí.
Dev Mode upravuje lokace, hotspoty, assety, předměty, pravidla, dialogy a kombinace;
mapa logiky ukazuje podmínky a efekty. Ukládá se do zdrojového JSON v Gitu. Krátká
kompletní technická hádanka bez skutečného příběhu a finálních assetů.
Animace: import PNG sekvencí a spritesheetů, náhled a úprava časování, náhodné
mrkání, mluvení během dialogu, jednorázové reakce a procedurální idle pohyb.
Animační ateliér demonstruje Codex mrknutí; PNG a konfigurace jsou v Gitu.
Žádné AI API ani FFmpeg nejsou potřeba. Formát a průchod jsou v README.
Chůze postavy, zvuk a lip-sync zatím chybí.
