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
  `message` pravidla je volitelná. Kurzory se nastavují daty v editoru.
- Rozhovor začíná nabídkou startovního uzlu. `choice.next` přehraje cílovou repliku;
  volby se vracejí až po konci audia nebo kliknutí/tapnutí na titulkovou plochu
  (také Enter/mezerník). Stejná plocha potvrzuje text bez audia a hned zastaví lip-sync.
  Jednořádková ukázka bez navazující větve nabízí Porozprávať sa. `useConversation`
  drží fázi, synchronní zámek a nonce mimo save. `choose.from` chrání před volbou
  ze starého uzlu. Přechody včetně návratu z menu mají 300ms zámek proti dvojkliku
  a dvojitému tapnutí; další tapnutí během zámku jej prodlouží až do klidu vstupu.
  Ignoruj opakování drženého Enteru/mezerníku. Ukončení řídí
  autorská volba bez `next`, nikoli Escape/křížek. Náhled dabingu v editoru má plné
  audio ovládání; hra pouze klikací titulky bez pauza/skip tlačítek a portrétů.
- Inventární `item.image` je samostatná ikonka. Pickup efekt je pouze vizuální,
  spouští ho skutečné získání přes akci, nikoli load/reset nebo přepnutí režimu.

## Animace postav

- Registr `animations` je volitelnou součástí JSON projektu. Klipy odkazují na
  lokální snímky a původní `source`; vazba hotspotu musí používat stejný obrázek.
- Klip může mít `region: {x,y,width,height}` v původních pixelech `source`.
  Lokální oči/ústa/idle/reakce mají nezávislé hodiny; různé přiřazené oblasti
  se nesmějí překrývat. `characterVisual.ts` vykreslí každý pixel právě jednou
  pomocí výřezů textur, včetně částečné alfa a vymazání. Nepřekrývej plné snímky
  běžným source-over blendem. Náhled v záložce Animácie používá stejný Pixi kód.
- Celopostavové klipy bez `region` zachovávají původní prioritu a tvoří základ
  pod lokálními vrstvami. Jemný celkový idle řeš transformací celé sestavy.
  Ticker zapínej jen pro aktivní postavy, uklízej listenery i výřezy textur
  (nikoli sdílené zdroje) a respektuj pauzu / reduced motion.
- Hotové PNG sekvence a Pixi/TexturePacker spritesheety importuj lokálně přes
  `dev/animationImport.ts`. Import atomicky uloží celé klipy; oříznuté atlasové
  snímky obnoví na původní plátno, otočená atlasová políčka odmítne. Blink/talk
  porovnává se zdrojem a hledá oblast změn; `/animations/region` slouží pro
  starší klipy, pouze lokálně a bez externího API.
- Všechny snímky musí mít stejné rozměry a zarovnání jako `source`. Neškáluj
  jednotlivé pózy a neměň anchor. Kontrola rozměrů běží při importu, save i check.
- `durationsMs` je volitelné časování jednotlivých snímků (jinak `fps`), `speed`
  násobí rychlost. Klipy a vazby jsou v projektovém JSON; importní `clip.json`
  je archivní záznam, nikoli druhý zdroj herního obsahu.
- `animation.onClick` / `onUse` spouští jednorázové klipy. `SpeechPlayback`
  (`active`, `timeMs`, volitelný `frameIndex`) připravuje řízení úst zvukovým
  adaptérem. Seek řeči nesmí restartovat oči. Vizuální požadavky ani hodiny
  nepatří do uloženého postupu hráče. Při skrytí Dev Mode odpoj jeho Pixi canvas.
- Animace nepoužívají externí AI API ani video pipeline. `OPENAI_API_KEY` zůstává
  rezervovaný pro budoucí jiné funkce, pouze v prostředí serveru / `.env.local`.
  Klíče nikdy do `VITE_`, klienta nebo autorského JSON.

## Dabing a lip-sync

- `hotspot.animation.voice` je konfigurace hlasu ElevenLabs, `mouthShapes` mapuje
  A–H/X na **nulové indexy** regionálního talk klipu. Chybějící otevřené tvary mají
  fallback C → B → X → 0, zavřené A/X používají klid. Bez mapy běží původní talk.
- `DialogueNode.actor` odkazuje na `{sceneId,hotspotId}`, `speech` obsahuje lokální
  `audio`, volitelný `lipSync` a kopii `text`. Změněný text označí audio za zastaralé;
  runtime jej nehraje. Nové audio musí odpojit staré časování.
- ElevenLabs a Rhubarb patří pouze do `dev/speech.ts` za lokální editorové API.
  `ELEVENLABS_API_KEY` a `RHUBARB_BIN` jsou serverové env hodnoty, nikdy `VITE_`.
  Generaci spouštěj jen výslovně, bez automatických retry; testy mockují provider.
- Vstup je WAV PCM 16-bit, max. 180 s / 20 MB. TTS PCM 22050 Hz se obalí WAV
  hlavičkou bez FFmpeg. Rhubarb běží bez shellu s `-r phonetic`, timeoutem a
  pevnými argumenty. Výsledky ukládej atomicky do `src/assets/speech/`.
- Save a check musí ověřit skutečný WAV a cue JSON včetně délky a audio SHA-256.
  Pozice úst vychází přímo z `HTMLAudioElement.currentTime`, oči mají vlastní hodiny.
  Uklízej audio, fetch, visibility listener i původní nahrávku při změně repliky;
  pozastav při menu/skrytí a respektuj blokovaný autoplay. Playhead neukládej do save.
- Dabing rozšiřuje existující animační studio. Import/generace zapisuje assety;
  vazby na repliky, hlasy a mapy se zapíší až přes Uložiť do projektu.
- `DialogueNode.text` zachovává TTS tagy. `subtitle` je volitelný přepis; bez něj
  `subtitles.ts` odstraní hranaté závorky i jejich obsah. TTS používá endpoint
  `with-timestamps`; `speech.alignment` odkazuje na místní `alignment.json` s vazbou
  SHA-256 na WAV. `speech.subtitles` drží upravitelné úseky a otisk zobrazeného textu.
  Přepis titulků nesmí restartovat audio ani zneplatnit Rhubarb. Cizojazyčný přepis
  nebo WAV bez zarovnání používá označený odhad; neprezentuj jej jako přesné časování.
  Save/check kontroluje překryvy i délku WAV. Hraní i náhled čtou `audio.currentTime`.
- Modely TTS načítej z `/v1/models`; chybějící metadata podpory tagů/rychlosti
  doplňuje malá sdílená tabulka `modelFeatures` v `speech.ts`. Neznámým modelům
  neslibuj audio tagy. Generování ani hledání zarovnání nikdy automaticky neopakuj.

## Aktuální rozsah

Dvě zkušební lokace: kontextové klikání, inventář a kombinace,
podmíněné dialogy, stav hádanky, dynamické hotspoty, přechody a verzovaný ruční
save/load v localStorage. Herní okno s drag/drop inventářem, dotykem i HTML klávesnicí.
Dev Mode upravuje lokace, hotspoty, assety, předměty, pravidla, dialogy a kombinace;
mapa logiky ukazuje podmínky a efekty. Ukládá se do zdrojového JSON v Gitu. Krátká
kompletní technická hádanka bez skutečného příběhu a finálních assetů.
Animace: import PNG sekvencí a spritesheetů, náhled a úprava časování, náhodné
mrkání, mluvení během dialogu, jednorázové reakce a procedurální idle pohyb.
Samostatné animační štúdio a ateliér demonstrují současné Codex mrknutí, ústa
během dialogu a idle pohyb; PNG a konfigurace jsou v Gitu.
Dabing: vývojové ElevenLabs TTS nebo WAV import, Rhubarb phonetic, mapování tvarů úst
na talk snímky. Ateliér obsahuje místní eSpeak nahrávku se skutečnou Rhubarb analýzou.
Produkce potřebuje jen lokální assety; FFmpeg není potřeba. Formát a průchod jsou v README.
Chůze postavy a generování finálního dabingu zatím chybí.
