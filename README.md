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
   **Nakresliť hotspot** vytvoří obdélník tažením v obrázku. Klik na viditelnou část obrázku objekt vybere a tažení jej posune.
   Levý horní úchyt přesouvá celý rám (i u průhledného assetu), dolní pravý roh
   proporcionálně mění velikost obrázku. Pro výběr překrytého objektu použij seznam.
   Kruh nad rámem otáčí kolem středu; Shift zarovnává po 15°. Escape nebo zrušení
   dotyku vrátí rozpracovaný tah. Každý dokončený tah je jedna úprava ve Späť/Znova.
   Číselná šířka/výška v inspektoru se také mění společně. **Rám podľa obrázka**
   přizpůsobí klikací rám viditelné velikosti assetu bez změny jeho zobrazení.
   **Deformovať** explicitně povolí nezávislou šířku/výšku a protažení obrázku;
   návrat na **Proporčne** obnoví nativní proporce. Hotspot bez obrázku má volné rozměry.
   **Priblíženie scény** (50–200 %) a posun ve výřezu mění pouze pohled editoru.
   Na dotyku zapni **Posun pohľadu** a tažením posuň zvětšený výřez; pro úpravy
   objektů režim zase vypni. Myší používej posuvníky nebo kolečko.
   **Pomôcky scény** vypne rámy, popisky a úchyty pro kontrolu čistého obrázku.
   Editor ukazuje i podmíněně skryté objekty; editace nespouští herní akce.
   **Nakresliť polygón** přidává vrcholy kliknutím nebo dotykem přímo nad pozadím.
   Klik na první bod, Enter nebo **Dokončiť polygón** pod scénou uzavře tvar;
   Backspace odebere poslední bod, Escape návrh zruší. Vrcholy lze táhnout,
   **+** na hraně přidá nový bod a vybraný vrchol lze odebrat tlačítkem či Delete
   (zůstávají alespoň tři). Tab a šipky umožňují úpravy klávesnicí, Shift posouvá
   po deseti jednotkách. Tažení uvnitř přesune celý polygon; platí i stávající
   úchyty přesunu, velikosti a rotace. **Previesť na polygón / Použiť obdĺžnik**
   převede vybraný rám oběma směry. Křížící se hrany se neuloží. Jeden dokončený
   tah nebo úprava bodů je jedna změna ve Späť/Znova.
3. V inspektoru nastav jméno, obrázek, viditelnost a pravidla **Kliknutie na objekt**.
   Prázdný seznam je tichá interaktivní kulisa; komentář je volitelný.
   Podmínky i efekty mají formuláře a výběr existujících ID.
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
s popisky, reakcemi a dialogy, dole inventář. Všechny herní prvky jsou uvnitř
hlavního okna. Na úzkém displeji má inventář horizontální posun. Celá scéna se
škáluje se zachováním poměru stran, včetně hotspotů; letterbox není interaktivní.

- Klik/tap provede první splněné pravidlo `onClick`: komentář, sebrání, rozhovor,
  přechod nebo jiný efekt. Hráč nepřepíná slovesa. Prázdné `onClick: []` je tichý
  objekt bez vlivu na postup; Škrabanec v ukázkové místnosti to demonstruje.
- Hover zobrazí pouze název. Objekty nemají obrys ani přepínač odhalující hotspoty.
  Kurzor je ruka, animovaná pusa nebo šipka odchodu. V editoru zvol typ, vlastní
  `cursorImage`, klip `cursorAnimation`, velikost 16–96 px a souřadnice špičky.
  Animované kurzory používají běžný registr klipů; bez samostatného obrázku vezmou
  zdroj klipu. Snímky a source podléhají stejné kontrole rozměrů jako postavy.
- Inventární předmět **přetáhni na druhý předmět** nebo **do scény**. Pointer
  capture podporuje myš i dotyk; vizuální náhled předmětu a cíl potvrzují drop.
  Neplatný/cancelovaný drop nic nespotřebuje. Inventář má vlastní `item.image`
  (**Inventárová ikonka**); nemusí odpovídat obrázku hotspotu. Nový předmět krátce
  povyroste, zprůhlední a přeletí do kapsy. Načtení uložené hry tento efekt nespouští.
- Alternativa bez tažení: klikni/tapni na předmět a následně na cíl. Výběr zároveň
  zobrazí jeho popis. Tab/Enter ovládá skutečná HTML tlačítka; **Objekty** nabízí
  přístupný seznam všech viditelných interaktivních oblastí včetně nepodstatných.
- Reakce se zobrazují v kreslené bublině; prázdný komentář žádnou bublinu nevytvoří.
  Dialog má portrét (`portrait` u uzlu), řečníka a větvené odpovědi na pergamenu
  uvnitř scény. Portrét se nastavuje v editoru dialogů; není povinný.
- Escape ruší výběr/tah, zavírá menu nebo rozhovor. Dialog blokuje akce světa.
  Efekty a animace respektují reduced motion; drag/drop zůstává funkční.
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
- `src/game/characterVisual.ts` — skládání lokálních animačních oblastí bez změny
  zarovnání nebo násobení průhlednosti; `animation.ts` řídí nezávislé hodiny.
- `src/game/transforms.ts` — společné proporce, natočení a geometrie rámů.
- `src/game/hitTest.ts`, `alphaMasks.ts`, `polygon.ts` — společné cílení alfa masek
  a polygonů, cache pixelů a kontrola geometrie pro Pixi, dropy a SVG editor.
- `src/editor/polygonTools.ts`, `PolygonHandles.tsx` — úpravy geometrie a úchyty vrcholů.
- `src/game/animation.ts` — vizuální hodiny, náhodné mrkání a priorita klipů.
- `src/ui/` — herní okno, životní cyklus canvasu, dialogy, inventář a pointer drag/drop.
- `src/editor/` — pouze vývojový editor, SVG autorování oblastí, formuláře a graf.
  `SceneImage.tsx` používá stejnou geometrii jako Pixi; `transformTools.ts` počítá
  proporcionální tahy a limity scény. Zoom, pomůcky a rozpracovaný tah jsou jen UI stav.
- `dev/editorPlugin.ts` — lokální Vite middleware pro načtení/zápis a import assetů.
- `dev/animationImport.ts` — lokální import PNG sekvencí a atlasů přes Sharp, obnova
  plátna oříznutých snímků, atomický zápis a kontrola rozměrů. Bez runtime závislosti.
- `dev/speech.ts` — vývojové ElevenLabs TTS, WAV import, Rhubarb a validace souborů.
- `src/game/speech.ts`, `src/ui/DialogueAudio.tsx` — časování tvarů a přehrávání lokálního dabingu.
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

Pravidlo má `when?`, `message?`, `effects?`. **První vyhovující vyhrává**, takže
bezpodmínečná reakce patří poslední. `hotspot.onClick` definuje kliknutí;
`uses` mapuje ID inventárních položek na pravidla použití. Kombinace jsou symetrické.
Efekty v pořadí mění příznak (`flag`, `id`, `value`), přidají/odeberou položku
(`addItem`/`removeItem`, `id`), přepnou lokaci (`scene`, `id`) nebo otevřou dialog
(`dialogue`, `id`). Spotřebu ingrediencí zapisuj explicitně efekty; duplicitní
inventární položky nevznikají. Chybějící akce má bezpečnou obecnou reakci.

Sebratelné věci mají samostatný `image` a `visibleWhen`, nejsou zapečené do pozadí.
Obrázek objektu se proporcionálně vejde doprostřed jeho `bounds`; stejný výpočet
`src/game/transforms.ts` používá SVG editor i Pixi. Volitelné `imageFit: "stretch"`
umožní záměrné protažení. `rotation` jsou stupně po směru hodin kolem středu rámu;
rotuje se obrázek i klikací oblast, včetně cílení inventáře. Natočený rám musí
zůstat uvnitř lokace. Starší objekty bez `imageFit` nyní zachovávají nativní proporce
i ve hře; pro původní protažený vzhled nastav explicitně `stretch`.
Obrázky automaticky reagují jen na pixely s alfa hodnotou alespoň 32/255;
průhledné okraje, díry a volný prostor při `contain` propouštějí hover, kliky
i dropy na další objekt pod nimi. To platí pro PNG/WebP i rasterizované SVG.
V inspektoru **Klikateľná oblasť** přepíná automatickou masku a ruční obdélník:
`hitTest: "bounds"` dává přednost celému autorskému `bounds` včetně rotace.
Bez obrázku a polygonu se používá obdélník; `hitTest: "alpha"` nebo chybějící nastavení
volí automatickou masku. `alphaThreshold` lze nastavit na celé číslo 1–255.
Editor používá stejnou detekci pro výběr i hover; rámy a popisky ji nepřekrývají,
transformační úchyty jsou samostatné ovládací prvky. Ve hře maska sleduje právě
vykreslený snímek i procedurální pohyb. Alfa data se čtou jednou na URL, sdílejí
mezi režimy a drží v cache s limitem 32 MiB mimo reference aktivních scén.
Čtení canvasu ani GPU neprobíhá při pointer událostech. Chyba načtení nikdy
nezmění průhledný obrázek v obdélníkový cíl.

Volitelný `hotspot.polygon` je pole `{ "x": 300, "y": 170 }` v původních
souřadnicích lokace, před aplikací `rotation`. První bod se na konci neopakuje.
`bounds` je transformační rám obsahující všechny body; editor jej při změně
vrcholů oblasti bez obrázku dopočítá. Při přesunu či změně rozměrů rámu se body
přepočítají společně, rotace zůstává kolem jeho středu. Změna vrcholu nemění
polohu ostatních vrcholů ani u natočeného polygonu. U objektu s obrázkem zůstává
obrazový rám při úpravě vrcholů zachovaný. Polygon má přednost před alfa maskou
i `hitTest`; jde o pevnou ruční oblast, nikoli animovanou masku. Podporované jsou
jednoduché konkávní i konvexní tvary se 3–128 různými body bez křížení a nulové
plochy. Rám včetně rotace musí zůstat uvnitř lokace. Body se při editaci ukládají
s přesností na tisíciny jednotky; zoom a velikost obrazovky JSON nikdy nemění.
Pixi, editor i inventární drop používají stejný test; při překryvu vítězí poslední
viditelný hotspot v poli. Game Mode žádné obrysy polygonů nekreslí.

Inventární `image` je volitelný. `tintWhen`
rozsvítí jednoduchý zelený indikátor. ID obrázků jsou cesty relativně k `src/assets/`.
Dialog má `start` a uzly `id/speaker/text/choices`; odpověď má `id/text`, případně
`when/effects/message/next`. Bez `next` rozhovor skončí. UI navíc vždy dovolí odchod.

Validátor kontroluje tvar JSON, neznámá pole, lokální assety, stabilní/duplicitní ID,
neexistující odkazy, kurzory, dialogové uzly, kombinace, zastíněná pravidla
a hotspoty mimo scénu. Řešitelnost se ověřuje průchodem. Při nekompatibilní změně
obsahu změň `id` projektu; strukturu uložených pozic verzuj v `storage.ts`.
Starší nekompatibilní pozice se odmítají, migrace zatím nejsou implementované.

Migrace ovládání: `defaultVerb` a slovník `actions` byly nahrazeny `onClick`.
Projektové příklady jsou převedené; staré vlastní JSON převeď výběrem původních
pravidel výchozího slovesa do `onClick`. `uses` i podmínky a efekty se nemění.
Animační vazby dřívějšího `onInteract` převeď na `onClick` / `onUse`.
Uložený hráčský postup zůstává kompatibilní, protože ID a herní příznaky se nemění.

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
Interakční testy ověřují let do inventáře, vlastní animovaný kurzor a portrét po
uložení/reloadu; kontextový průchod zahrnuje i tichou kulisu.
Transformační testy navíc ověřují PNG/WebP/SVG, rotaci, zamknuté proporce, explicitní
deformaci, undo/redo a rušení tahů. Porovnávají obraz SVG editoru a Pixi i po změně
viewportu / zoomu a ověřují kliky a inventární dropy na otočenou oblast. Validace
obsahu používá vlastní dočasnou Vite cache, aby nenarušila současně běžící hru.
`tests/alpha.spec.ts` vytváří překryté PNG s velkými průhlednými okraji a několika
úrovněmi alfa. Ověřuje hover, klik, inventární drop, práh po save/reloadu, ruční
rám, zoom editoru, aktuální animační snímek i reduced motion na myši a dotyku.
`tests/polygon.spec.ts` ověřuje kreslení a úpravy konkávních polygonů na myši
i dotyku, undo/redo, rušení, konverzi obdélníku, zápis/reload, odmítnutí neplatné
geometrie serverem, překryvy, hover, kliky a inventární dropy i po rotaci a zoomu.
Animační testy importují skutečné Codex PNG i atlas, porovnávají všechny pixely,
kontrolují velikosti pláten, časování, pořadí, chyby a atomický zápis. V prohlížeči
ověřují náhled, reload, mrkání, interakční reakce a dialogové přehrávání v Pixi
včetně statického buildu, pauzy a reduced motion. `layered-animation.spec.ts`
kontroluje současné oči/ústa, zachování alfa a ignorování změn mimo oblast,
klikání skrz vymazanou oblast, celý editorový workflow a skutečnou Codex postavu
během dialogu. Nepoužívají žádné externí API.

Instrukce pro agenty jsou v [AGENTS.md](AGENTS.md).

## Animace postav v Dev Mode: hotové PNG a spritesheety

1. V **Lokácie** vyber postavu a stiskni **Otvoriť animačné štúdio**, nebo otevři
   samostatnou záložku **Animácie** a vyber **Animovaná postava**. Celý pracovní
   prostor nabízí velký Pixi náhled, přiřazení vlevo a knihovnu/nastavení vpravo.
   Na menší obrazovce se části skládají pod sebe. **Priblíženie postavy** zvětší
   detail tváře až 4×. Všechny pózy musí mít stejné plátno,
   pozici postavy a průhledné okraje jako zdroj; individuální ořez nebo změna
   rozměrů způsobuje poskakování a import jej proto odmítne.
2. Vyber typ (blink / talk / idle / expression), název a **PNG snímky alebo atlas**.
   PNG sekvence se řadí přirozeně podle názvů (`frame-2` před `frame-10`).
   Pro spritesheet vyber jediný PNG a jeho JSON do **Spritesheet metadáta**.
   Podporovaný je Pixi/TexturePacker objekt `frames`, volitelné `animations`,
   `duration`, `sourceSize` a `spriteSourceSize`. Vyber sekvenci, pokud jich atlas
   obsahuje víc. Oříznuté snímky se doplní průhlednými okraji podle metadat;
   otočená políčka atlasu (`rotated: true`) nejsou podporovaná — exportuj bez rotace.
3. **Importovať animáciu** validuje soubory a uloží nový adresář
   `src/assets/animations/<uuid>/` se snímky `frame-001.png` atd. Celý adresář se
   zveřejní atomicky až po úspěšném importu. Limit je 120 snímků, 32 MB vstupu
   a 64 milionů pixelů výsledných pláten. Nic se automaticky neškáluje.
   Původní PNG sekvence se kopíruje bajtově přesně. U atlasu se archivuje i
   `atlas.png` + `atlas.json`; `clip.json` je importní záznam se SHA-256 zdroje.
   Jediná aktuální konfigurace hry nadále patří do `project.json`.
   U blink/talk import navíc porovná snímky s originálem a najde oblast změn.
   Stejnou kontrolu pro starší klip spustí **Zistiť zmenenú oblasť**. Transparentní
   RGB šum se nepočítá jako změna. Při příliš rozsáhlých změnách vymez oblast
   ručně v původních pixelech; okolí mimo ni se při přehrávání ignoruje.
4. Přehrávej náhled, vybírej snímky, měň pořadí, fps nebo délku konkrétního snímku.
   Atlasová `duration` se zachová. **Rýchlosť prehrávania (×)** násobí rychlost
   celého klipu; **Rovnomerné časovanie podľa fps** odstraní individuální délky.
   **Opakovať klip** řídí náhled, idle a talk; jednorázový idle drží poslední pózu.
5. **Priradiť postave** uloží klip do návrhu a podle typu jej přiřadí jako blink,
   talk, idle nebo reakci při kliknutí (expression). Existující klipy vybírej v **Animácia na úpravu**; změny klipu
   potvrď **Pridať / aktualizovať animáciu** nebo znovu **Priradiť postave**.
   Jedna postava může mít různé kompatibilní klipy pro každý způsob spouštění.
6. Nastav automatické mrkání (náhodný interval), animaci během konkrétního dialogu,
   základní idle nebo **Animácia pri interakcii** pro kliknutí nebo použití předmětu. Reakce
   i mrknutí se přehrají jednou a vrátí svou oblast k základu. Lokální mrkání
   pokračuje i během mluvení. Procedurální pohyb se aplikuje na celou sestavu.
   **Kombinácia postavy** umožňuje zvlášť testovat oči, ústa a idle, pozastavit
   přehrávání, vynutit **Mrknúť teraz** a zobrazit oblasti. Testovací přepínače
   nemění přiřazení. **Vybraný klip** nabízí samostatný náhled a časovou osu.
7. **Game Mode** nebo **Otestovať odtiaľto** okamžitě testuje návrh.
   **Uložiť do projektu** zapíše konfiguraci a vazby do JSON; potom commitni JSON
   i nové assety. Neuložené změny klipu zůstanou jen v panelu. Při odstranění
   definice se soubory automaticky nemažou; jiné postavy je mohou stále používat.

První příklad: v editoru zvol lokaci **Animačný ateliér**, pak
**Otestovať odtiaľto**. Postava z `woman.png` náhodně mrká po 3–6 s a mrkne také
při kliknutí. Kliknutí spustí technický dialog s nezávislou animací úst;
mrkání i idle pohyb pokračují. Dva nové lokální snímky úst reprodukuje
`python3 experiments/woman-blink/generate_talk.py` (Pillow); zachovávají alfa kanál
celého zdroje a pixely mimo ústa. Pět póz vychází z `experiments/woman-blink/output/`; shodné
otevřené a přivřené pózy sdílejí PNG. Otevřené pózy mají krátké prodlevy,
protože čekání mezi mrknutími zajišťuje vazba, nikoli samotný klip.
Celý import si vyzkoušíš výběrem týchž pěti PNG nebo `spritesheet.png` + JSON.

### Formát a přehrávání

`animations[]` obsahuje `id`, `label`, `source`, `kind`, `frames`, `fps` (1–30),
volitelně `durationsMs` (jedna délka 10–60000 ms pro každý snímek), `speed` (0.1–4)
a `loop` (výchozí true). `region: {"x":394,"y":173,"width":100,"height":36}`
vymezuje nezávislou oblast v původních pixelech `source`. Region musí být celočíselný
obdélník uvnitř zdroje; všechny snímky dál používají celé původní plátno. Různé
přiřazené lokální klipy se nesmějí překrývat. Opakované odkazy na stejný snímek
jsou v pořádku. Klipy bez `region` zachovávají původní celopostavové přehrávání.
Vazba `hotspot.animation` používá `blink`, `blinkIntervalMs: [min,max]`, `idle`,
volitelné `idleLoop` přepsání smyčky, `talk`, `dialogueId`, `onClick: "clip-id"`, `onUse: "clip-id"` a volitelný `motion: "breath" | "sway"`. Zdroj každého přiřazeného
klipu musí odpovídat `hotspot.image`. Rozměry všech snímků kontroluje import,
uložení projektu a `npm run validate:content`; runtime navíc odmítne deformovat
postavu při chybně změněném assetu. Zarovnání kresby uvnitř plátna je odpovědnost autora.

Přehrávač zachovává pozici, natočení a velikost zdrojového obrázku. Lokální
blink, talk, idle a reakce mají nezávislé hodiny. Celopostavové starší klipy tvoří
základ s původní prioritou talk → reakce → blink → idle; aktivní lokální vrstvy
se skládají nad ním. Tělo a části obličeje se dělí podél hran oblastí na navazující
výřezy sdílených textur (`characterVisual.ts`): každý pixel se vykreslí jednou.
Zachová se i částečná průhlednost nebo vymazané pixely, bez duplikování těla pod
překryvem. Výřezy se cachují, bez čtení GPU/canvasu při přehrávání. Alfa cílení
vybírá stejné snímky/oblasti jako renderer. Při úklidu se ničí jen výřezy, nikoli
sdílené zdrojové textury.

Pro jemný pohyb celé postavy používej `motion`; všechny části se pohybují společně.
Celopostavový idle klip kombinuj s lokální tváří pouze tehdy, pokud její poloha ve
snímcích zůstává stejná. Editor nepřidává automatické sledování obličeje ani kosti.
Náhled klipu i kombinace používá tentýž Pixi renderer jako hra; při přepnutí do
Game Mode se editorový canvas odpojí, rozpracovaná nastavení zůstanou zachovaná.
Ticker respektuje pauzu, skrytou záložku a reduced motion.

Animace obrázků nepoužívají AI služby, video ani FFmpeg. Produkce přehrává místní
obrázky, audio a časování bez editoru a zápisového API. Staré archivní soubory se
automaticky nemažou. `OPENAI_API_KEY` zůstává rezervovaný pro jiné budoucí funkce.

### Dabing ElevenLabs a Rhubarb Lip Sync

1. Do ignorovaného `.env.local` přidej `ELEVENLABS_API_KEY=...` a restartuj Vite.
   Klíč potřebuje **Text to Speech** (`text_to_speech`), **Voices: Read**
   (`voices_read`) a **Models: Read** (`models_read`). Při 401 `missing_permissions`
   doplň oprávnění v ElevenLabs → Developers → API Keys → (…) → Edit.
   Editor nyní ukáže konkrétní chybějící oprávnění. Nikdy nepoužívej
   prefix `VITE_`. Žádný klíč nepatří do projektového JSON ani do produkce.
2. Stáhni a rozbal [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync/releases)
   pro svůj systém. Zachovej i jeho doprovodný adresář `res/`. Nastav
   `RHUBARB_BIN=/absolutni/cesta/rhubarb` (Windows: `rhubarb.exe`), nebo jej přidej
   do PATH; restartuj Vite. Ověřeno s 1.14.0. Binárku lze držet v ignorovaném `.local-tools/`; necommituje se a produkce ji nepotřebuje.
3. V **Animácie** vyber postavu. Vlevo otevři **Hlas ElevenLabs**, stiskni
   **Načítať hlasy a modely** a přiřaď Voice ID a vyber **Model ElevenLabs**.
   Seznam obsahuje všechny TTS modely vrácené `/v1/models`; ID lze vložit i přímo.
   Bez API jsou k dispozici označené předvolby, jejich dostupnost ověří server.
   Katalog vrací prvních 100 hlasů. Vyber model/hlas vhodný pro slovenštinu.
   [Eleven v3, v4 a v4 Turbo podporují audio tagy](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-and-v4)
   jako `[laughs]`, `[crying]` a `[whispers]`; editor je označuje v seznamu.
   Nastav stabilitu, podobnost, rychlost 0.7–1.2 a podle možností modelu výraznost
   a speaker boost. Eleven v3 používá stabilitu 0 / 0.5 / 1. Server před generováním
   ověří schopnosti modelu a odešle pouze podporované volitelné parametry.
   U v3/v4 se neposílá speed; style a speaker boost řídí schopnosti vrácené API.
   Nedostupná pole jsou vypnutá.
   Při 402 ověř tarif a kredity: [hlasy z Voice Library nejsou na bezplatném tarifu dostupné přes API](https://elevenlabs.io/docs/eleven-creative/voices/voice-library),
   i když je lze přehrát na webu. Vyber hlas dostupný pro svůj tarif nebo importuj WAV.
4. Otevři **Dabing a lip-sync**. Vyber repliku z existujících dialogů a uprav text
   (nové uzly a větvení dál vytvářej v **Dialógy**). Potvrď zaškrtávátko placeného
   generování této repliky a stiskni **Vygenerovať dabing ElevenLabs**. Po úspěchu
   se potvrzení zruší; změna textu sama žádné API volání nevyvolává. Požadavky se
   automaticky neopakují. Samotné načtení katalogu negeneruje audio.
5. Alternativně **Nahrať WAV** importuje vlastní nahrávku bez API. Vstup je
   nekomprimovaný WAV PCM 16-bit, mono/stereo, 8–48 kHz, max. 20 MB / 180 s.
   Jiné kodeky nejprve exportuj do tohoto formátu. ElevenLabs vrací `pcm_22050`,
   server doplní WAV hlavičku — není potřeba FFmpeg ani placený 44.1kHz WAV export.
6. **Analyzovať Rhubarb** spustí místní CLI s `-r phonetic -f json --threads 2`.
   Režim phonetic nevyžaduje anglický text a je vhodný pro slovenské repliky.
   Analýza má timeout 120 s, běží bez shellu a dostává pouze ověřený lokální WAV.
7. Vlevo v **Tvary úst Rhubarb** přiřaď snímky regionálního klipu **Rozprávanie**.
   Vyplň alespoň X (klid) a C (otevřená ústa). A/B/C/D/E/F/G/H/X odpovídají
   [tvarům Rhubarbu](https://github.com/DanielSWolf/rhubarb-lip-sync#mouth-shapes).
   Chybějící A použije X → A → snímek 1; ostatní otevřené tvary C → B → X → snímek 1.
   Bez mapování se při přehrávání zvuku použije běžná smyčka talk.
8. Přehrávej/pozastavuj audio v náhledu, posouvej jeho čas a přibliž tvář. Oči
   náhodně mrkají a idle pokračuje nezávisle. **Uložiť do projektu** zapíše vazby,
   hlas a mapování do JSON. **Game Mode** okamžitě přehraje tentýž návrh.

**Titulky** se upravují ve stejném panelu pod správou dabingu. `text` uzlu je
původní text pro TTS včetně tagů. Hráč ve výchozím stavu vidí text bez hranatých
závorek a jejich obsahu (včetně vnořených tagů). Volitelné **Vlastný text titulkov**
(`subtitle` uzlu, také v záložce Dialógy) jej nahradí; prázdné pole obnoví automatiku.
Změna titulků neznehodnotí audio ani lip-sync.

Nové generování používá [Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
a uloží `alignment.json` s časy znaků a SHA-256 audia. Titulky se dělí podle
interpunkce a celých slov do úseků přibližně do 78 znaků. Pokud očištěný text odpovídá
zarovnání, úseky sledují skutečné časy řeči včetně přestávek. Importované/starší WAV,
chybějící zarovnání nebo odlišný vlastní přepis používají **označený odhad** podle
délky textu; nejde o rozpoznání řeči. Nové audio kvůli titulkům automaticky nevzniká.

V seznamu úseků můžeš změnit text, začátek/konec v sekundách a posunout náhled.
**Rozdeliť úsek** dělí v pozici kurzoru v textu, jinak u nejbližšího prostředního
slova; **Zlúčiť** spojí následující úsek. **Obnoviť automatické titulky** zahodí ruční
časování a přepočte úseky lokálně. Poté použij **Uložiť do projektu**. Úseky jsou
v `speech.subtitles` (`text` je otisk výchozího zobrazeného textu, `timing` původ
časování, `cues` obsahuje `start`, `end`, `text`). Změna celého textu titulků dočasně
použije nové automatické úseky místo starých ručních; pro jejich zápis stiskni obnovu.
Save/check odmítne překryvy a časy mimo skutečnou délku WAV, stejně jako zarovnání
patřící k jinému audiu. Pozice titulků i úst sleduje stejné `audio.currentTime`:
pauza, seek, menu, přeskočení a změna repliky zůstávají synchronní. Na konci nebo po
přeskočení zůstane poslední úsek, při chybě zvuku je dostupný celý očištěný text.

Audio a archivní údaje generování vznikají atomicky v `src/assets/speech/<uuid>/`.
Analýza ukládá nový `track.lipsync.json`; původní asset se nepřepisuje. Commitni nové
adresáře i `project.json`. Vrácení úpravy/odpojení dabingu soubory nemaže.
Konfigurace repliky vypadá například takto:

```json
{
  "actor": { "sceneId": "animation-lab", "hotspotId": "blink-character" },
  "speech": {
    "audio": "speech/animation-demo/audio.wav",
    "lipSync": "speech/animation-demo/track.lipsync.json",
    "text": "Ahoj. Mrkám a rozprávam. Oči a ústa fungujú nezávisle."
  }
}
```

`actor` určuje konkrétní postavu pro daný uzel; při generování/importu se přiřadí
vybraná postava. **Priradiť hovoriacu postavu** ji změní bez generování audia.
`speech.text` je kopie namluveného textu: po editaci repliky editor ukáže upozornění
a hra staré audio nepřehraje. Nová generace/import staré časování odpojí. Uložit lze
záměrně i rozpracovaný zastaralý dabing. Save/check ověřují skutečný WAV, délku a
SHA-256 vazbu synchronizačního souboru na audio, lokální cesty, postavu a indexy snímků.

`DialogueAudio.tsx` poskytuje Pixi živý `SpeechPlayback` z `HTMLAudioElement.currentTime`.
Nevznikají druhé hodiny úst ani React render pro každý snímek. Pauza a seek drží
odpovídající tvar; otevření menu nebo skrytí záložky pozastaví zvuk. Přeskočení,
konec nahrávky, změna uzlu, ukončení dialogu a opuštění režimu zastaví původní audio.
Blokované automatické přehrání nabídne ruční spuštění; chybějící audio zachová text.
Při chybě časování se použije běžná talk animace. Bez dabingu zůstává původní
textový dialog. Audio playhead není součástí uloženého herního postupu; load začne
repliku znovu. Reduced motion ponechá původní kresbu, audio se přehrává dál.

**Lokální ukázka:** Animačný ateliér obsahuje slovenskou nahrávku vytvořenou
lokálně přes eSpeak NG, skutečnou analýzu Rhubarb 1.14.0 (34 cue / 4.67 s) a mapování
na existující tři pózy úst. Nejde o ukázku kvality ElevenLabs ani o kompletní sadu
kreslených fonémů. WAV reprodukuje `python3 experiments/woman-blink/generate_voice.py`
(systémová knihovna `libespeak-ng`), nové časování vytvoří editor. ElevenLabs je
v automatických testech mockovaný; pro ověření kvality skutečného hlasu je potřeba
vlastní API klíč a ručně spuštěná generace.

API vychází z oficiálního [TTS rozhraní ElevenLabs](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[katalogu modelů](https://elevenlabs.io/docs/api-reference/models/list) a
[CLI Rhubarbu](https://github.com/DanielSWolf/rhubarb-lip-sync#command-line-options).

### Izolovaný experiment: šest póz mluvení `woman.png`

`experiments/woman-speech/output/` obsahuje šest transparentních PNG 1086 × 1448:
zavřená, lehce pootevřená, střední (bajtově původní obrázek), výrazně otevřená,
zaoblená O a našpulená U. Pět nových póz přebírá původní nepravidelné zuby a spodní
ret jako oddělené vrstvy; otvor úst a kontury jsou kreslené 8× větší a vyhlazené.
Horní zuby zůstávají ukotvené, dolní se pohybují s čelistí. Při zaoblení rty zuby
zakrývají. Neškáluje se celá hlava ani původní ústa. Skript je určený pro tento asset.

```sh
python3 experiments/woman-speech/generate.py                # Pillow, bez API
python3 experiments/woman-speech/generate.py --verify-only --self-test
```

`contact.png` ukazuje všechny tváře, `mouth-contact.png` detaily a `preview.gif`
mluvení se společnou paletou a neprůhledným pozadím (GIF neumí částečné alfa).
PNG a atlas zachovávají **celý alfa kanál originálu**. `mouth-mask.png` je pevná
povolená oblast úprav; mimo ni se kontrolují všechny čtyři kanály, včetně RGB
průhledných pixelů. `validation.json` obsahuje SHA-256, počty změn a porovnání póz.
Kontrola navíc ověřuje shodu atlasových políček s PNG a časování GIFu; negativní
kontroly musí odmítnout změnu oka nebo alfa kanálu.

`spritesheet.png` (3 × 2 políčka, 3258 × 2896) + `spritesheet.json` mají neřezaná
Pixi/TexturePacker metadata. Pro budoucí import tvarů vyber sekvenci **mouthShapes**;
`poses.json` navrhuje nulové indexy X/A=0, B=1, C=2, D=3, E=4, F=5 a fallback G=1,
H=2. Sekvence **talk** slouží jako pohybový náhled. Není to úplná sada přesných
fonémů. Experiment zatím nemění registr animací, herní JSON ani předchozí demo.

### Izolovaný experiment: programové mrknutí `woman.png`

`experiments/woman-blink/` obsahuje samostatný reprodukční skript. Nemění herní
JSON ani editor; ukázkový ateliér používá kopie jeho výsledků.
Python 3 + Pillow 10.2.0; z kořene projektu spusť:

```sh
python3 experiments/woman-blink/generate.py --self-test
python3 experiments/woman-blink/generate.py --verify-only --self-test
```

Skript překresluje pouze obě oči původního `src/assets/woman.png`. Bézierovy
křivky víček jsou přizpůsobené konkrétní kresbě; horní víčko překrývá původní
zornici a bělmo, žádná část oka se neškáluje. Pro jinou postavu je potřeba upravit
souřadnice a barvy v `EYES` / `draw_lid`. Nejde o obecný generátor animací.

V `output/` jsou `frame-01.png` až `frame-05.png` (1086 × 1448, původní alfa),
PixiJS atlas `spritesheet.png` + `spritesheet.json` (3 × 2 polí, 3258 × 2896),
opakující se `preview.gif` s celou postavou i detailem a statický `contact.png`.
GIF je kontrolní náhled na šedém pozadí, protože neumí původní částečnou průhlednost.
Snímky 1/5 jsou přesné kopie zdrojového PNG, snímky 2/4 jsou shodné. Časování
1800/60/90/80/700 ms je v `frames.*.duration`; při použití Pixi `AnimatedSprite`
předej textury jako `{ texture, time: duration }`, samotné `sheet.animations.blink`
obsahuje pouze textury bez časování.

`eye-regions.png` vymezuje povolené oblasti úprav. `validation.json` zaznamenává
SHA-256 i počty změněných pixelů; kontrola porovnává všechny RGBA kanály včetně
RGB průhledných pixelů, celý alfa kanál a jednotlivá pole atlasu. Ověří také pět
snímků GIFu a časování. `--self-test` navíc záměrně poškodí dočasné kopie mimo oko
a v alfa kanálu a ověří jejich odmítnutí. Žádné API ani klíče nejsou potřeba.
