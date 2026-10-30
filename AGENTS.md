# TUKABEL

Komediální 2D point-and-click adventura „Záhada strateného kábla“, inspirovaná
Poldou a slovenskými internetovými legendami. Třídenní AI hackathon: preferuj
malé funkční změny, konkrétní obsah a minimum režie. Hra běží jen v prohlížeči.

## Konvence

- TypeScript strict, React + Vite, PixiJS 8. Používej npm a commitovaný lockfile.
- React vlastní stav, dialogové překryvy a Dev Mode; Pixi vlastní canvas, scénu,
  HUD, inventář, deník a jejich pointer interakce.
  Nevytvářej obecný engine, ECS, event bus ani backend bez konkrétní potřeby.
- Autorský obsah je v `src/game/content/project.json` (včetně lokací), typy
  v `src/game/types.ts`, Pixi v `src/game/createScene.ts`, React UI v `src/ui/`.
  Editor patří do `src/editor/`, lokální zápisová vrstva do `dev/editorPlugin.ts`.
- Pozadí a hotspoty sdílejí souřadnice definované velikostí lokace (demo 1280×720).
  Škáluj celou scénu, nikoli jednotlivé hotspoty podle velikosti obrazovky.
- Assety drž lokálně v `src/assets/` a importuj přes Vite. SVG jde upravovat kódem;
  pro finální kreslená pozadí lze použít generované PNG/WebP. Bez ručních editorů,
  vzdálených CDN a kopírování cizích herních assetů. Výjimka: release build smí
  načíst volitelnou HD kopii z S3 (`--remote`), hra ale musí plně fungovat ze zipu.
- Nepoužívané generace uklízej přes `npm run assets:clean` (audit), poté
  `-- --apply`. Zachovej aktuální i commitovaný obsah, kódové odkazy, úplné
  používané generace a tranzitivní podklady receptů. Čerstvé výstupy jsou hodinu
  chráněné; úklid je přesune do ignorované `.local-tools/asset-trash/`, odkud je
  obnoví `-- --restore <id>`. Modely a experimenty do úklidu assetů nepatří.
- Kód a identifikátory anglicky, hráčské texty slovensky, Dev Mode UI a komunikace/dokumentace česky.
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

- Minihry žijí v `src/minigames/<id>/` (React overlay vlastní Pixi canvas,
  grafika v `src/assets/minigames/<id>/`). Obsah je spouští efektem `minigame`
  a v `minigames` určí `winFlag`; nové ID přidej do `MINIGAME_IDS`. Stav běžící
  minihry se neukládá a blokuje svět jako dialog.

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
- Rozhovor standardně začíná nabídkou startovního uzlu. `choice.next` přehraje cílovou repliku;
  volby se vracejí až po konci audia nebo kliknutí/tapnutí na titulkovou plochu
  (také Enter/mezerník). Stejná plocha potvrzuje text bez audia a hned zastaví lip-sync.
  Jednořádková ukázka bez navazující větve nabízí Porozprávať sa. `useConversation`
  drží fázi, synchronní zámek a nonce mimo save. `choose.from` chrání před volbou
  ze starého uzlu. Přechody včetně návratu z menu mají 300ms zámek proti dvojkliku
  a dvojitému tapnutí; další tapnutí během zámku jej prodlouží až do klidu vstupu.
  Ignoruj opakování drženého Enteru/mezerníku. Ukončení řídí
  autorská volba bez `next`, nikoli Escape/křížek. Náhled dabingu v editoru má plné
  audio ovládání; hra pouze klikací titulky bez pauza/skip tlačítek a portrétů.
- `dialogue.entry: "speech"` spustí úvodní repliku automaticky, například jako
  reakci na předání předmětu přes existující efekt `dialogue` v `hotspot.uses`.
  V tomto režimu je povolené `choices: []`: konec audia/potvrzení titulků dialog
  zavře; jinak nabídne odpovědi. Výchozí `choices` zachovává nabídku témat.
  Odebrání předmětu a příznaky proveď jednou v původním pravidle, nikdy z audio
  callbacku. Odmítnutí předmět nespotřebuje. Dabovaná reakce uvádí `node.actor`,
  takže stejná postava používá svou mapu úst i mimo hlavní `animation.dialogueId`.
- Inventární `item.image` je samostatná ikonka. Pickup efekt je pouze vizuální,
  spouští ho skutečné získání přes akci, nikoli load/reset nebo přepnutí režimu.
- `createHud.ts` kreslí horní HUD, inventář, deník, drag náhled i pickup efekt
  v Pixi vrstvě přímo přes obraz lokace. HUD nesmí rezervovat okraj canvasu ani
  zmenšovat scénu. `hudLayout.ts` sdílí plný viewport a contain rám obrazu;
  HUD kotvi k obrazu i při letterboxu. Kreslené assety jsou v `src/assets/hud/`.
  Polička je nine-slice sprite s pevnými konci; alfa cílení musí invertovat stejné
  natažení z cachované masky, neblokovat průhledná místa a platit také pro drop
  a ruční hover scény. Aktivní ovládací prvky mají vlastní dotykové cíle.
  Inventář stránkuje šipkami, dlouhý deník posouvá obsah pod maskou. Deník pozastaví
  řeč/lip-sync, zablokuje svět a inventář, drží focus a Escape jej zavře.
  Stav otevření/posunu nepatří do save. Tlačítka reagují na Pixi pointerup s prahem
  pohybu a zrušením tahu, bez závislosti na syntetickém clicku po dotyku.
  `HudAccessibility` je pouze neviditelná HTML sémantika/klávesnice se souřadnicemi
  z Pixi, vždy `pointer-events: none`; focus kreslí Pixi. Nepřidávej druhý viditelný
  HTML HUD. Titulky/dialogové volby a save menu zůstávají ve stávajícím React UI.
- Volitelný registr tasks obsahuje id/text/startWhen/completeWhen. Chybějící
  podmínka znamená pouze ruční efekt startTask/completeTask; prázdné all spouští
  okamžitě. Podmínky jsou společné s ostatní logikou. Stav tasks v GameState
  drží jen active/completed; syncTasks po akci stav přidá/dokončí natrvalo.
  Spotřebování předmětu nebo zneplatnění podmínky úkol nesmaže ani neobnoví.
  Dokončení před přidáním zapíše rovnou completed. Verze save 1 přijímá starší
  pozice bez tasks a dopočítá jen postup doložitelný aktuálními podmínkami;
  neplatné stavy a cizí ID odmítá. TasksPanel a EffectsField upravují pouze
  autorský JSON; validace i mapa logiky kontrolují odkazy na úkoly.

## Vrstvy a grafické operace

- `scene.hotspots` je zároveň zásobník vrstev zezadu dopředu; nedrž druhou kolekci
  transformací. `decorative: true` s obrázkem vykresluj, ale vynech ze všech herních
  interakcí, seznamu objektů i dropů. `hidden` platí i ve hře, `opacity` je 0–1;
  nulové krytí neinteraguje. `locked` chrání pouze editor, nikoli herní logiku.
  Pozadí je spodní vrstva s volitelným `backgroundHidden`.
- `SceneArtPanel` používá výběr z `EditorStage`. Souřadnice výběru převáděj přes
  původní obrázek, contain/stretch a inverzní rotaci; mimo obrázek výběr odmítni.
  Výběr nepatří do hráčského save. Živý náhled používá původní `GameCanvas`.
- `dev/sceneArt.ts` je lokální pipeline: transparentní výřez, periodická deformace
  textury do PNG sekvence, volitelná AI úprava/odstranění/oddělení/nová lokace.
  AI jen po výslovném spuštění, serverové `OPENAI_API_KEY` / `OPENAI_IMAGE_MODEL`,
  jeden požadavek bez retry; provider je oddělený ve `editImage`. Testy mockují fetch.
  Výchozí Image API model je `gpt-image-2.5-sunburst`, kvalita `high` (serverové
  `OPENAI_IMAGE_QUALITY`). Editor nabízí návrat na `gpt-image-1.5`; konkrétní model
  a kvalitu zachyť v úloze a receptu. `artSettings.ts` sdílí podporované kvality,
  neplatné kombinace odmítej před API. `input_fidelity: high` patří jen ke starším
  `gpt-image-1` / `gpt-image-1.5`, u Sunburst jej neposílej. Žádný automatický fallback.
  Produkce žádné grafické API nepotřebuje ani nevystavuje.
- Operace `asset` vytváří nový samostatný transparentní objekt; pozadí používá
  pouze jako referenci a nikdy je nepřepisuje. `dev/generatedAsset.ts` připravuje
  čistou referenci a označené vodítko pro Image API (`background: transparent`,
  bez inpainting masky). Výběr určuje cílový rám, nikoli ořezovou masku. Ořízni
  podle skutečné alfy, zachovej proporce a zarovnej dolní střed; nativní offset
  ulož do `cutoutFrame`. Odmítni prázdný/neprůhledný/useknutý výstup bez retry.
  Archivuj provider PNG i náhled na původním pozadí. Apply přidá přední
  interaktivní vrstvu s prázdným `onClick`; pickup nastavují existující pravidla.
- Nové soubory publikuj atomicky do `src/assets/scene-art/<uuid>/`. Původní soubor
  nepřepisuj; archivuj source, masku a recipe JSON s otiskem zdroje a parametry.
  Recept není druhá definice herního obsahu. Vazby a klipy zapisuje projektový save.
  Maskovaná kompozice musí mimo opravnou masku zůstat pixelově shodná se zdrojem. Náhled se použije
  až vědomou akcí; starý výsledek nesmí přepsat změněný zdroj/transformaci nebo souřadnice lokace.
  Úpravy nesouvisejících objektů a názvu lokace mají zůstat zachované.

- Výchozí oddělení používá binární `object-mask.png` a původní RGB/alfa.
  Měkkou alfu povol jen s explicitními metadaty `objectMask.matting`; maska je
  neprůhledná šedotónová PNG 0–255 v přesných rozměrech a s SHA-256 zdroje.
  V matting režimu je alfa výřezu `min(sourceAlpha, matte)`, nikdy součin dvou
  pokrytí. Ruční polygon bez mattingu zůstává binární pro zpětnou kompatibilitu.
- `npm run setup:matting` připraví lokální ViTMatte a PyMatting. `/art/matte` používá
  trimap ze segmentace + zelené/červené pevné tahy a oranžové nejisté pixely.
  ViTMatte následuje úzký closed-form průchod podle původních barev; samostatný
  closed-form je alternativa. Počítej v původním rozlišení s překrývanými dlaždicemi,
  nikoli zmenšenou maskou. Segmentace/matting negenerují nový objekt.
- RGB plně krytého jádra a vnitřní alfa zdroje zůstávají původní. Volitelné
  odstranění barevného lemu odhaduje foreground pouze na nově částečných hranách
  původně neprůhledného zdroje; vypnutí zachová všechna RGB přesně. Foreground
  v klientovi je jen náhled, export jej bezpečně přepočítá z původního zdroje.
  Po změně masky vyžaduj nový výpočet barev, aby náhled odpovídal exportu.
- Opravná maska pozadí je samostatná binární podpora (`ownership-mask.png` u mattingu)
  s explicitním přesahem. Nezaměňuj ji s jemnou alfou a nevracej za objekt původní
  obrysy. U maskované varianty mimo opravu nic neměň. Statické výřezy ořízni podle
  nenulové alfy; `cutoutFrame` v receptu v3 uchová nativní offset a velikost zdroje.
  `croppedPlacement` sdílí contain/stretch i rotaci původního rámu. Pro diagnostiku
  archivuj `cutout-full.png`; animační sekvence nadále mají celé společné plátno.
  Kontrola reassembly vyžaduje `unexpectedPixels: 0`; zvlášť vykazuje
  `cleanupPixels` v opravném okolí a `edgePixels` na částečných hranách mattingu.
  Ty nelze přesně obnovit z nového pozadí; nulové chyby jádra nedokazují kvalitu hrany.
- `dev/inpaint.ts` sdílí přípravu modelového plátna, návrat i kompozici. Zachovej
  přesnou geometrii celého zdroje v letterboxu; jinou velikost odpovědi archivuj,
  ale blokuj Apply, nikdy ji potichu neroztahuj. Zmenšení opravné masky zachovává
  tenké části konzervativním pokrytím. `repairFeather` (výchozí 2 px, 0–32, nejvýše
  přesah) tvoří inward přechod k nule na vnější hranici; objekt zůstává plně opravený.
  Částečnou alfu míchej přes premultiplied příspěvky, PNG ukládej straight RGBA.
- Odstranění/oddělení archivuje `debug` v receptu: skutečný vstup/masku API,
  surovou odpověď, kontrolní návrat bez AI, vrácený výsledek a finální kompozici.
  `debugOnly` připraví stejné kroky bez API a bez možnosti Apply. `InpaintInspector`
  je pouze Dev Mode. Při hodnocení odlišuj chybu škálování, změnu chráněného
  kontextu modelu a změny mimo opravnou masku maskované kompozice (musí být 0). Nulové metriky
  nedokazují správný výběr ani barevnou návaznost. Bez automatického color matchingu.
- Odstranění/oddělení nabízí `backgrounds.restored` (výchozí `provider-restored.png`)
  a `backgrounds.masked` (`image.png`). Restored je celé zarovnané pozadí AI a může
  měnit chráněný kontext; maskovaná varianta vrací originál mimo opravu, včetně
  případných zbytků stínu. Volbu promítni do náhledu i projektového JSON. Surový
  `provider-returned.png` s letterboxem nikdy nepřiřazuj přímo. `artHistory.ts`
  načítá pouze známé PNG z reálných UUID adresářů, se stejným zdrojem i hashem,
  bez API kreditů a bez změny archivů nebo projektu. Metriky reassembly patří
  maskované kompozici, nikoli celému restored pozadí.
- `npm run setup:sam3` připraví oddělený CPU runtime a schválené váhy facebook/sam3.
  `--runtime-only` nestahuje váhy; `--check-access` ověří token a přístup bez vah.
  Instalátor znovu používá ověřený runtime, rozlišuje HTTP 401/403 a nevypisuje
  token ani odpověď poskytovatele. `setup_sam3.py` sdílí kontrolu úplnosti všech
  částí checkpointu s detekcí dostupnosti v `segment.py`.
  HF_TOKEN je pouze pro explicitní instalátor;
  SAM3_PYTHON / SAM3_MODEL jsou serverové cesty. `sam3_adapter.py` používá lokální
  Sam3TrackerModel/Processor, safetensors a native-size masky; žádný vzdálený kód.
  Zachovej SAM 2 pro porovnání, tvrdé tahy, detailní průchod i samostatný matting.
  Bez schválených vah neslibuj ověřenou kvalitu a nepřepínej model potichu.
- `dev/artSource.ts` sdílí bezpečné načtení/normalizaci; `dev/objectMask.ts` ověřuje
  PNG a hash před placeným voláním. `dev/segmentation.ts` spouští pevné Python
  helpery bez shellu, timeout 300 s, uklízí dočasné soubory. Žádné automatické
  stahování ani vzdálený modelový kód; váhy a venv jsou v ignorovaném `.local-tools/`,
  které Vite nesleduje. Modely/AI API nejsou součástí produkce.
- SAM dostává celý zdroj kvůli kontextu; `refineEdges` dotáhne binární masku
  GrabCutem v pásmu 12 původních pixelů. Tahy jsou pevné podmínky; `detailPass`
  přidává analýzu výřezu s kontrolou překryvu. Matting je samostatný vědomý krok,
  nepřidávej měkkou alfu plošným rozmazáním či zvětšením objektu.
- `MaskEditor` pracuje v pixelech zdroje nezávisle na zoomu; undo vrací celé tahy,
  segmentaci, matting i barvy. Pointercancel/Escape tah vrátí. Ruční štětec a import
  šedotónové PNG fungují bez Pythonu. Kontroluj hrany na bílé i černé a alfa náhledu;
  porovnávej původní raster, reassembly i diff. `npm run compare:matting` porovná
  stejné SAM masky čtyřmi postupy proti známým kresleným obrysům; výsledky dvou
  ukázek nejsou obecnou zárukou. Testuj PNG/Canvas/Pixi včetně vnitřní alfy a rotace.

- Grafické operace a textová réžie používají `/jobs` a `dev/editorJobs.ts`: nejvýše
  20 úloh, jeden runner současně, mimo zámek projektových revizí. Fronta v paměti
  Vite přežije reload klienta, nikoli restart serveru; žádné automatické retry.
  Čekající lze zrušit, běžící se dokončí. Úlohy samy nikdy nemění projektový JSON.
  Výsledky otevři podle zachyceného cíle; zaniklý či změněný cíl nepřepisuj.
- **dev/codexAgent.ts** spouští skutečný místní codex exec (GPT-6.1-Sol / high),
  pouze výslovnou úlohou codex v Dev Mode. CODEX_BIN je serverová cesta;
  používá uložené přihlášení CLI bez OPENAI_API_KEY a bez uživatelského configu.
  Agent pracuje nad kopií v dočasné složce mimo repo, workspace-write, bez
  eskalací, síťových příkazů a dalších agentů. Nepoužívej shellovou interpolaci,
  automatické retry nebo neomezená oprávnění. Přenášej jen omezené zprávy JSONL,
  nikoli stderr, výstupy příkazů či reasoning. Běžícího Codexe lze zastavit;
  abort / zavření serveru ukončí procesní skupinu a nesmí zablokovat frontu.
  PNG snímky, zdroj, zadání, skripty a recept publikuj atomicky do
  src/assets/codex/UUID/. Recept není druhý zdroj herního obsahu.
  Ověř skutečné PNG, plátno, původní alfu postavy, krajní snímky mrknutí,
  odlišné pózy, nezávislé oblasti očí/úst a shodu mimo výběr. Zdroj kontroluj
  hashem, cíl fingerprintem. CodexPanel používá stejný projektový návrh,
  validaci i Pixi náhled; Apply je jeden undo krok a zachová nesouvisející editace.
  Agent sám nemění projektový JSON. Testy mockují běh CLI a nikdy samy
  nespouštějí placené generování.
- `dev/animationDirection.ts` převádí text jen na omezený návrh existujících
  blink/talk/idle klipů, intervalů a celkového motion. Serverové `OPENAI_API_KEY`
  a `OPENAI_ANIMATION_MODEL`; Responses Structured Outputs + vlastní validace.
  Nepouštěj modelový kód ani libovolné nástroje. Nevydávej nastavení za generování
  snímků/hlavy. Náhled používá `CombinedPreview`, Apply projde stejnou validací jako
  Save a tvoří jeden undo krok. Zachovej voice/mapu úst, pokud talk klip zůstává.
  Polling musí zachovat identity nezměněných výsledků, jinak restartuje Pixi hodiny.

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
- `animation.gesture` s `gestureIntervalMs` přehraje klip jednou a čeká náhodně
  od jeho konce (výchozí 2000–5000 ms). Sdílí pauzu a renderer s očima/ústy;
  celopostavové řeči/reakci ustoupí a po ní znovu čeká. Codex úloha `gesture`
  vytváří `expression` bez regionu, s přesným zdrojovým prvním/posledním snímkem.
  Pohyb končetin smí změnit alfu, nikoli plátno nebo ukotvení hlavy. Přiřazené
  regiony očí/úst posílá editor jako `protectedRegions`; runner odmítne jejich
  změnu. Přiřazení gesta zachová hlas, mapu úst a všechny ostatní vazby.
- Import a přehrávání animací nepoužívají AI API ani video pipeline. Textová réžie
  pouze navrhuje jejich konfiguraci. `OPENAI_API_KEY` používají volitelné grafické
  úpravy a textová réžie pouze na serveru / v `.env.local`.
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

<!-- azg:start -->

# Azet Games (azg)

This project uses the Azet Games CMS (https://azet-games-cms.rin.rinapps.dev). Its documentation is downloaded in `.azg/docs/`
(refresh with `azg docs pull`; one document: `azg docs <slug>`). **Read it before you change anything.**

Read first, by task:

- What the platform offers today (status, how, limits): [What you can use](.azg/docs/capabilities.md).
- Building or changing a game: [Hackathon guide](.azg/docs/hackathon.md), [SDK contract](.azg/docs/sdk-contract.md), [Manifest](.azg/docs/manifest.md); leaderboards, nickname, points, cloud save, currency and shop: [Game services](.azg/docs/game-services.md); events: [Event catalog](.azg/docs/events.md).
- Setting up a tenant (landing, looks, Puzzlr games, challenges, badges, tournaments, moderation, tokens): [Admin guide](.azg/docs/admin.md) and [API](.azg/docs/api.md).
- The `azg` commands and exit codes: [CLI](.azg/docs/cli.md).

Rules that always hold:

- A game talks to the platform only through `@azet/games-sdk` (`game.*`); it never sets scores on boards itself — results go through `game.complete()` or the backend's `submitResult`.
- No cookies, `localStorage`, `sessionStorage` or IndexedDB: the game runs on an opaque origin where they fail; keep data with `game.store`.
- No personal data in events or props; Slovak text for players, English in code and docs.
- `azg validate` and `azg contract` must pass before `azg publish`; versions are immutable.
- The API acts with the logged-in token (`azg whoami`, `azg api ops` lists what it may call, `azg api call <METHOD> <path>` calls any endpoint of the API doc); in production tenants agent writes become proposals.

All documents:

- [How it works](.azg/docs/overview.md) – The flow of a game and the parts of the platform.
- [Admin guide](.azg/docs/admin.md) – Set up a tenant step by step: members, tokens for agents, looks, landing, Puzzlr games, challenges, badges, tournaments, moderation.
- [Hackathon guide](.azg/docs/hackathon.md) – From zero to a live game, with and without programming.
- [What you can use](.azg/docs/capabilities.md) – Every platform feature for a game: status today, how to use it, limits, and what is not available.
- [SDK contract](.azg/docs/sdk-contract.md) – The game ↔ shell protocol, limits and error codes.
- [Game services](.azg/docs/game-services.md) – Player, nickname, points, leaderboards, cloud save, currency and shop from a game and its backend.
- [Manifest](.azg/docs/manifest.md) – azet-game.yaml: settings, scoring, assets.
- [CLI](.azg/docs/cli.md) – Every azg command and exit code.
- [Event catalog](.azg/docs/events.md) – Every event the platform records, its fields and limits.
- [API](.azg/docs/api.md) – REST endpoints, scopes, upload and downloads.
- [Architecture](.azg/docs/architecture.md) – Components, data model and security.
- [Deploy](.azg/docs/deploy.md) – Hosts, Helm chart, Vault and CI.
- [Engineering](.azg/docs/engineering.md) – Code standards and quality gates.
- [PRD](.azg/docs/prd.md) – Requirements and acceptance criteria.
- [Decisions](.azg/docs/decisions.md) – Why things are the way they are.
- [Build plan](.azg/docs/build-plan.md) – Phases, status and human prerequisites.

<!-- azg:end -->
