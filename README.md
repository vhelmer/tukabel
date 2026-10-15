# TUKABEL: Záhada strateného kábla

Prohlížečová point-and-click adventura a lokální vizuální editor pro třídenní
AI hackathon. TypeScript + React + Vite + PixiJS 8. Herní obsah i assety jsou v Gitu.
Produkční hra je statická aplikace bez backendu; editor zapisuje pouze při lokálním vývoji.

## Spuštění a kontrola

Node.js **20.19+ nebo 22.12+** a npm:

```sh
npm ci
npm run dev
npm run check             # lint, formát, validace JSON/odkazů, pravidla, typy, build
npm run validate:content  # skutečný projekt včetně dostupnosti assetů
npm run test:rules        # reducer, validátor, save/load a souřadnice bez prohlížeče
npm run preview          # produkční hra z dist/, bez editoru a zápisového API
```

Vite standardně vypíše `http://localhost:5173`. Pro editor používej lokální HTTP
adresu `localhost` nebo `127.0.0.1`, nikoli síťovou IP. `dist/` funguje na statickém
hostingu i v podadresáři. `file://` není podporované.

## Dev Mode: tvorba → test → Git

1. V lokální aplikaci přepni **Dev Mode**. Editor načte aktuální zdroj a jeho revizi.
2. V **Lokácie** vyber nebo vytvoř lokaci. Přiřaď pozadí a původní rozměry.
   **Nakresliť hotspot** vytvoří obdélník tažením v obrázku. Klik oblast vybere,
   tažení ji posune, dolní pravý roh mění velikost. Souřadnice lze zadat i číselně.
   Editor ukazuje i podmíněně skryté objekty; editace nespouští herní akce.
3. V inspektoru nastav jméno, obrázek, viditelnost, kontextové sloveso a pravidla
   `look/take/talk/use`. Podmínky i efekty mají formuláře a výběr existujících ID.
   Pravidla a efekty lze přidávat, odstraňovat a přesouvat nahoru.
   Sekce použití inventáře nastavuje reakce na konkrétní předmět.
4. V **Predmety** vytvoř inventární položky, popisy a symboly/obrázky.
   **Dialógy** spravují rozhovory, uzly, odpovědi, další uzly, podmínky a efekty.
   **Hádanky** obsahují herní příznaky, kombinace, úvodní zprávu a výchozí lokaci.
5. **Mapa logiky** zobrazuje podmínky → konkrétní akce/odpovědi → efekty včetně
   inventáře, příznaků, lokací a pokračování dialogů. Filtruj podle ID/textu,
   klikem otevři definici. Zelená hodnotí podmínky vůči poslednímu hernímu náhledu;
   graf nenahrazuje kontrolu pořadí pravidel ani důkaz řešitelnosti hádanky.
6. **Game Mode** nebo **Otestovať odtiaľto** spustí aktuální návrh od začátku
   vybrané lokace, s prázdným inventářem a nenastavenými příznaky. Zápis na disk
   není potřeba. Návrat do Dev Mode zachová rozpracovaný obsah. Chybná data
   blokují test i uložení a editor zobrazí konkrétní chyby.
7. **Uložiť do projektu** skutečně zapíše `src/game/content/project.json`.
   Zdroj se ukládá jako formátovaný JSON atomickým přejmenováním dočasného souboru.
   Uložení neobnovuje stránku a zachová pracovní návrh. **Späť / Znova** drží
   posledních 50 úprav v paměti; jeden dokončený tah hotspotu je jedna úprava.
8. Prohlédni `git diff` a commitni JSON a případné nové assety. Editor Git příkazy
   nespouští. Neuložený návrh se při obnovení stránky ztratí.

Změní-li soubor jiná záložka nebo coding agent, server vrátí konflikt a novější
soubor nepřepíše. **Zahodiť zmeny a načítať** explicitně převezme zdroj z disku;
předchozí návrh ještě lze vrátit přes Späť. Automatické slučování změn není implementované.
ID nových objektů jsou automatická a stabilní. Při mazání používaného předmětu,
příznaku nebo dialogu oprav i související odkazy, případně operaci vrať.

Existující obrázky se vybírají ze `src/assets/`. PNG/JPEG/WebP do 6 MB lze importovat
přímo z formuláře; import ihned vytvoří nový soubor v `src/assets/imported/` a přiřadí
jej. Nový soubor má jedinečné jméno, nic nepřepisuje. Importované soubory zůstávají
na disku i při vrácení úpravy; nepoužité případně ručně odstraň. SVG a AVIF lze přidat
přímo do repozitáře. Názvy assetů používej bez mezer a diakritiky (`a-z`, číslice,
`_`, `-`, podadresáře). Assety se při buildu importují přes Vite; žádné CDN.

## Game Mode

Herní okno se vejde do viewportu: nahoře je název lokace a menu, uprostřed scéna
s popisky, reakcemi a dialogy, dole lišta sloves a inventář. Herní prvky nejsou pod
canvasem mimo hlavní okno. Na úzkém displeji mají lišty vlastní horizontální posun;
na nízkém displeji se inventář a akce skládají vedle sebe. Celá scéna se škáluje
se zachováním poměru stran, včetně hotspotů. Letterbox okraje nejsou interaktivní.

- Klik/tap provede kontextovou akci; sloveso lze zvolit explicitně.
- Inventární předmět **přetáhni na druhý předmět** pro kombinaci nebo **do scény**
  pro použití. Pointer capture funguje myší i dotykem. Náhled taženého předmětu,
  zvýraznění cíle a reakce potvrzují výsledek. Neplatný/cancelovaný drop nic nespotřebuje.
- Alternativa bez přetahování: vyber předmět a klikni na cíl. Tab/Enter ovládá
  skutečná HTML tlačítka; **Objekty** otevře seznam objektů uvnitř scény.
  Vybranou položku lze prozkoumat tlačítkem nebo dvojklikem.
- Escape ruší výběr/tah, zavírá menu nebo rozhovor. Dialog blokuje akce světa.
  **Ukázať predmety** zvýrazní hotspoty. Krátké přechody respektují reduced motion.
- **Menu** obsahuje ruční **Uložiť hru**, **Načítať hru** a **Nová hra**. Postup
  zůstává v jednom verzovaném localStorage slotu daného originu, oddělený od obsahu.
  Načítá se až na požádání a obnovuje i rozmluvený dialog. Nová hra slot nemaže.
  Poškozené, nekompatibilní či nedostupné úložiště nepřepíše aktuální postup.

Ukázkový průchod: správce → dotaz na opravu → vyžádat pásku → ukončit rozhovor →
sebrat kabel u židle → přetáhnout pásku na kabel → opravený kabel na router → dveře
do dvora → tabule. Lze se vrátit; vyřešený stav zůstává. Jde o technickou hádanku
se dvěma lokacemi, bez finálního příběhu a assetů. Chůze postavy a zvuk zatím chybí;
mrkání, dialogové snímky a jemné idle pohyby lze přiřadit v editoru.

## Obsah a architektura

- `src/game/content/project.json` — **jediný zdroj autorského obsahu**: lokace,
  objekty, předměty, dialogy, příznaky, kombinace a animace. Jeden soubor zjednodušuje atomický
  zápis a kontrolu konfliktů; nevznikají rozporné částečné zápisy několika souborů.
- `src/game/content/index.ts` — validované načtení JSON.
- `src/game/assets.ts` — mapa stabilních ID assetů na Vite URL pro runtime.
- `src/game/types.ts` — smlouva obsahu, podmínek, efektů, příkazů a hráčského stavu.
- `src/game/validateProject.ts` — runtime kontrola struktury JSON a lokálních assetů.
- `src/game/validateContent.ts` — ID, odkazy, rozměry, pořadí pravidel, duplicity.
- `src/game/state.ts` — původní čistý reducer; stejná pravidla v náhledu i produkci.
- `src/game/storage.ts` — save/load postupu; nikdy neukládá definice obsahu.
- `src/game/createScene.ts` — Pixi pozadí, sprity, hotspoty a stavové indikátory.
- `src/game/animation.ts` — vizuální hodiny, náhodné mrkání a priorita klipů.
- `src/ui/` — herní okno, životní cyklus canvasu, dialogy, inventář a pointer drag/drop.
- `src/editor/` — pouze vývojový editor, SVG autorování oblastí, formuláře a graf.
- `dev/editorPlugin.ts` — lokální Vite middleware pro načtení/zápis a import assetů.
- `dev/animationService.ts`, `animationVideo.ts`, `falVideo.ts` — vývojové fal.ai úlohy,
  archivace MP4, FFmpeg extrakce a klíčování celých snímků přes Sharp. Bez runtime závislosti.
- `tests/` — pravidla, průchody hry, izolované testy editoru a produkčního buildu.

React vlastní obsah návrhu, herní stav a UI. Pixi vykresluje a obsluhuje kliky
herní scény; editor pro své geometrické nástroje používá SVG nad stejnými souřadnicemi.
Při hraní se změny postupu promítají do existujícího canvasu. Přechod/remount
bezpečně uklízí observer, listenery a asynchronní Pixi aplikaci ve StrictMode.
Statické scény nemají trvalý render loop. Není zde ECS, event bus ani obecný engine.

Editor se načítá přes podmínku `import.meta.env.DEV`; jeho JS/CSS ani API klient
se do produkčního bundlu nedostanou. Middleware používá pouze `configureServer`,
nikoli preview. Přijímá jen loopback Host a spojení; zápisy navíc vyžadují shodný
Origin a vlastní hlavičku editoru. Cílový JSON má pevnou cestu, klient neposílá
libovolné cesty k zápisu. Server validuje celý projekt znovu, porovnává SHA-256
revizi zdroje a serializuje souběžné požadavky. Import má limit velikosti, kontrolu
obrazového formátu a povolených přípon. Produkční hosting nic z toho nepotřebuje.

### Datový kontrakt

JSON obsahuje `id`, `startScene`, `initialMessage`, `flags`, `scenes`, `items`,
`dialogues`, `combinations` a volitelné `animations`. Nový obsah lze vytvořit editorem nebo přímo úpravou
JSON; žádné callbacky ani kód do obsahu nepatří. Texty pro hráče jsou slovensky,
ID a kód anglicky. Definice se nemutují. Stav hráče obsahuje jen ID lokace, inventář,
boolean příznaky, aktivní dialogový uzel a poslední zprávu. Výběry UI se neukládají.

Podmínky: `{ "flag": "powered" }`, `{ "flag": "powered", "value": false }`,
`{ "item": "tape" }`, `{ "not": condition }`, `{ "all": [condition, ...] }`.
Bez podmínky pravidlo platí vždy. Nepřítomný příznak je false. Podmínky používají
pravidla, dialogové odpovědi, `visibleWhen` i `tintWhen`.

Pravidlo má `when?`, `message`, `effects?`. **První vyhovující vyhrává**, takže
bezpodmínečná reakce patří poslední. `defaultVerb` určuje kontextový klik;
`uses` mapuje ID inventárních položek na pravidla použití. Kombinace jsou symetrické.
Efekty v pořadí mění příznak (`flag`, `id`, `value`), přidají/odeberou položku
(`addItem`/`removeItem`, `id`), přepnou lokaci (`scene`, `id`) nebo otevřou dialog
(`dialogue`, `id`). Spotřebu ingrediencí zapisuj explicitně efekty; duplicitní
inventární položky nevznikají. Chybějící akce má bezpečnou obecnou reakci.

Sebratelné věci mají samostatný `image` a `visibleWhen`, nejsou zapečené do pozadí.
Obrázek objektu sdílí jeho `bounds`. Inventární `image` je volitelný. `tintWhen`
rozsvítí jednoduchý zelený indikátor. ID obrázků jsou cesty relativně k `src/assets/`.
Dialog má `start` a uzly `id/speaker/text/choices`; odpověď má `id/text`, případně
`when/effects/message/next`. Bez `next` rozhovor skončí. UI navíc vždy dovolí odchod.

Validátor kontroluje tvar JSON, neznámá pole, lokální assety, stabilní/duplicitní ID,
neexistující odkazy, výchozí akce, dialogové uzly, kombinace, zastíněná pravidla
a hotspoty mimo scénu. Řešitelnost se ověřuje průchodem. Při nekompatibilní změně
obsahu změň `id` projektu; strukturu uložených pozic verzuj v `storage.ts`.
Starší nekompatibilní pozice se odmítají, migrace zatím nejsou implementované.

## Prohlížečové testy

```sh
npx playwright install chromium
npm run test:e2e          # nejprve vytvoří čerstvý produkční build
```

Na minimálním Linuxu případně `npx playwright install --with-deps chromium`, nebo:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e
```

Testy samy spustí servery. Desktop i dotykový profil ověřují kompletní průchod,
skutečný drag/drop, použití ve scéně, klávesnici, změnu rozměrů, save/load a chyby
assetů. Editorové testy používají **dočasné kopie zdrojů**: kreslí, přesouvají,
importují obrázek, vytvářejí dialogy, kontrolují JSON na disku, reload, konflikt
a odmítnutí neplatného zápisu. Reálný projekt ani produkci nemění. Produkční test
ověřuje nepřítomnost editoru i zápisového API. Screenshoty/trace jsou v ignorovaném
`test-results/`, náhledy editoru a grafu také při úspěšném průchodu.
Animační testy používají skutečné testovací MP4: video náhled, extrakci, klíčování,
opakované zpracování bez AI, reload a mrkání/mluvení v Pixi i ve statickém buildu
dočasné hry. Testují také fal.ai HTTP adaptér. Nevolají placené AI API a nehodnotí
kvalitu skutečného modelu.

Instrukce pro agenty jsou v [AGENTS.md](AGENTS.md).

## Animace postav v Dev Mode: celý asset → fal.ai video → PNG

1. V **Lokácie** vyber postavu a přiřaď statický PNG/WebP asset; SVG se převede na
   PNG bez ořezu. Otevři **Animácie postavy · fal.ai**. Vyber **Mrkanie**, **Idle**
   nebo **Rozprávanie**; výběr doplní prompt, který můžeš upravit.
2. Zvol délku 2/3/5 sekund a pozadí. Pro průhledný asset použij magentu nebo zelenou,
   podle toho, kterou barvu postava nepoužívá. **Ponechať pozadie** zachová neprůhledné
   video. Již neprůhledné pozadí vstupního obrázku se samo neodstraní.
3. **Vygenerovať / regenerovať video** odešle celý obrázek do fal.ai. Stav ukazuje
   frontu, generování a stahování; úlohu lze zrušit. Jde o jedno placené video bez
   automatického opakování. Zrušení nezaručuje zastavení již běžícího výpočtu ani
   vrácení ceny. Původní MP4, odeslaný PNG a `video.json` se uloží ihned po úspěchu.
4. Přehraj video. Podle pohybu zvol začátek/konec úseku, exportní fps (1–24)
   a sílu odstranění pozadí. **Uložiť herné snímky** provede lokální FFmpeg extrakci;
   zůstává celé zarámování postavy, nejdelší strana má nejvýše 512 px. Limit je
   120 snímků. Úsek i klíčování lze opakovat bez dalšího AI požadavku.
5. Přehraj PNG náhled a proklikej snímky. Pro krátké mrknutí vyber úsek obsahující
   otevření → zavření → otevření očí; server mrknutí automaticky nedetekuje.
   Posuď podobu postavy, hrany, pozadí a začátek/konec. Export potlačuje barevný
   přesah klíče v komprimovaných hranách. Videomodel nezaručuje
   identitu pixelů ani plynulou smyčku. Klíčování může odstranit stejnou barvu
   z oblečení nebo ponechat barevné okraje; změň sílu/barvu či prompt a zkontroluj náhled.
6. **Priradiť postave** přidá definici a nastaví automatické mrkání / dialogovou
   animaci / základní idle. Dolaď interval mrkání nebo dialog. **Game Mode**
   ihned přehraje návrh; **Uložiť do projektu** zapíše definici do zdrojového JSON.
7. Commitni `project.json` i nové adresáře v `src/assets/animations/`. MP4 archiv,
   vstup a metadata jsou v adresáři úlohy; každý úspěšný export má samostatný
   adresář s PNG a `generation.json` (časový úsek, fps, klíčování, hash zdroje,
   model, ID fal.ai požadavku a odkaz na MP4). Nic se nepřepisuje ani automaticky nemaže.

Úlohy a jejich nastavení jsou v paměti vývojového serveru (nejvýše 20 posledních).
Návrat z Game Mode na poslední úlohu naváže. Po restartu serveru zůstávají soubory
na disku a uložené definice v projektu; původní video lze stále přehrát u uloženého
klipu. Neuložený návrh a možnost znovu exportovat starou úlohu se restartem ztratí.
Ruční import/úpravy PNG a **Pohyb bez AI** (dýchání/kývání) nadále fungují bez klíče.
Dosavadní PNG assety zůstávají použitelné; staré generování po částech bylo odstraněno.
Případná stará `generation` metadata v definici klipu je potřeba odstranit, samotné
`source`, `frames` a `fps` zůstávají kompatibilní. Staré archivní soubory se nemění.

### Konfigurace

V existujícím ignorovaném `.env.local` **doplň** (soubor nepřepisuj):

```dotenv
FAL_KEY=tvuj_fal_klic
```

Pro novou instalaci můžeš zkopírovat `.env.example`. Restartuj `npm run dev`.
`OPENAI_API_KEY` v `.env.local` zůstává zachovaný pro případné budoucí funkce;
animace jej vůbec nečtou. Nikdy nepoužívej `VITE_` prefix. Klíče ani fal.ai
podepsané URL se neukládají do obsahu, metadat, odpovědí či produkčního bundlu.
Účet fal.ai potřebuje kredit a přístup k modelu. Bez `FAL_KEY` vrací API 503;
neexistuje simulované generování. Automatické testy klíč nikdy nepoužívají.

Použitý model je [Wan 2.2 5B image-to-video](https://fal.ai/models/fal-ai/wan/v2.2-5b/image-to-video/api),
580p, 24 fps, pevný poměr `1:1`, bez interpolace a rozšiřování promptu. Celý asset
se doplní pozadím na čtverec; export snímků odstraní pouze tyto přidané okraje
a obnoví původní poměr stran. Režim `auto` na distribuovaném GPU endpointu některé
rozměry odmítá chybou 422. Validační chyby v editoru uvádějí konkrétní pole a zprávu,
bez vrácení vstupního obrázku či klíče. Krátký
výstup a menší model omezují cenu; aktuální cenu ověř v modelové stránce fal.ai.
Server používá nativní HTTP frontu: submit → status → result → download,
[viz dokumentace fronty](https://fal.ai/docs/documentation/model-apis/inference/queue).
Klíč se odesílá jen `queue.fal.run`; media se stahují bez klíče z fal CDN / Google
Storage. Doba čekání je nejvýše 15 minut, velikost videa 60 MB. Zdroj je statický
PNG/WebP/SVG do 2048 × 2048 px / 6 MB; po dobu úlohy jej chrání kontrola SHA-256.

FFmpeg je **vývojová** npm závislost `ffmpeg-static`, dodaná při `npm ci`.
Pokud platforma nemá podporovanou binárku, nastav `FFMPEG_PATH` v prostředí procesu
na absolutní cestu k vlastnímu FFmpeg s PNG a H.264 podporou, například
`FFMPEG_PATH=/usr/bin/ffmpeg npm run dev`. Editor před placeným
požadavkem kontroluje dostupnost binárky. Zpracování běží bez shellu s limitem
60 sekund. Produkce nepotřebuje FFmpeg, fal.ai ani jakékoli AI API.

### Formát a přehrávání

Projekt má volitelný registr `animations`. Klip obsahuje `id`, `label`, `source`
(ID původního assetu), `kind` (`blink/talk/expression/idle`), `frames` (ID lokálních
obrázků, 1–120 snímků) a `fps` (1–30). Opakované ID snímku je v pořádku. Hotspot s `image` může
mít `animation`: `idle`, `idleLoop`, `blink`, `blinkIntervalMs: [min, max]`, `talk`,
`dialogueId` a `motion: "breath" | "sway"`. Zdroj klipu musí odpovídat obrázku postavy.
Přehrávání má prioritu talk → blink → idle / originál; náhodné čekání mrknutí je
ve výchozím nastavení 3–7 sekund. Mluvení běží při aktivním přiřazeném dialogu;
bez explicitního `dialogueId` se odvodí z efektů akcí `talk`. Nejde o audio lipsync.
Pohyby i snímky jsou vizuální stav, nikoli součást uloženého postupu. Pixi ticker
se spouští jen pro viditelné animované postavy, pauzuje v menu/skryté záložce a
respektuje reduced motion. Statické scény nadále zůstávají bez trvalého loopu.

Metadata `generation` u nových klipů obsahují `provider: "fal"`, `model`, `prompt`,
`sourceHash`, `requestId`, `video` (lokální MP4 ID), `duration`, `background`,
`trimStart` a `trimEnd`. Validator kontroluje i dostupnost MP4. Přehrávač potřebuje
jen snímky a fps; archiv videa se během hry nestahuje. Žádné masky, inpainting,
projekce původního alfa kanálu ani záruka pixelové shody se zde nepoužívají.
