# TUKABEL: Záhada strateného kábla

Krátká dokončitelná prohlížečová point-and-click adventura s černým humorem,
dvěma konci a lokálním vizuálním editorem. TypeScript + React + Vite + PixiJS 8.
Herní obsah i všechny potřebné assety jsou v Gitu.
Produkční hra je statická aplikace bez backendu; editor zapisuje pouze při lokálním vývoji.

## Spuštění a kontrola

Node.js **20.19+ nebo 22.12+** a npm:

```sh
npm ci
npm run dev
npm run check             # lint, formát, validace JSON/odkazů, pravidla, typy, build
npm run validate:content  # skutečný projekt včetně dostupnosti assetů
npm run test:rules        # reducer, validátor, save/load a souřadnice bez prohlížeče
npm run assets:clean      # pouze audit nepoužívaných generací/importů
npm run preview          # produkční hra z dist/, bez editoru a zápisového API
npm run build:release    # zmenšená statická hra do dist-release/
npx vite preview --config vite.release.config.ts   # náhled dist-release/
```

Vite standardně vypíše `http://localhost:5173`. Pro editor používej lokální HTTP
adresu `localhost` nebo `127.0.0.1`, nikoli síťovou IP. `dist/` funguje na statickém
hostingu i v podadresáři. `file://` není podporované.

### Release build (`dist-release/`)

Běžný `dist/` balí celé `src/assets` (všechny generace a archivy). `build:release`
(`scripts/build-release.mjs` + `vite.release.config.ts`) vydá jen frontend hry
a vybere nejkvalitnější preset, jehož zip se vejde do 5 MB (limit odevzdání).
Jiný limit: `node scripts/build-release.mjs --budget 8`; konkrétní preset bez
limitu: `--preset 0` (nejlepší) až `--preset 5` (nejmenší). Výpis ukazuje
odhad velikosti zipu pro každý zkoušený preset.

- Do buildu jdou jen soubory, na které odkazuje `project.json`, a statické importy
  kódu. Animace, na které nic neodkazuje, a portréty replik (hra je nezobrazuje)
  se z release kopie obsahu vynechají.
- Obrázek se zmenší na největší velikost na obrazovce (rám hotspotu, lokace, mapa,
  ikonka 128 jednotek, kurzor) × `scale` presetu, nikdy nezvětší, a uloží jako
  AVIF. Všechny snímky klipů jednoho `source` sdílí stejné měřítko; `region` se
  přepočítá na nové pixely. Snímky použité jen regionálními klipy (oči, ústa)
  mají mimo region průhlednost, protože se jinde nekreslí ani netestují.
  SVG s vloženým rastrem se rasterizuje, ostatní SVG zůstávají vektorová.
  Staticky importované rastry (cutscéna, minihra) počítají v pixelech originálu,
  proto se jen překódují ve stejném rozlišení.
- WAV se převede na MP3 (`@breezystack/lamejs`, bez FFmpeg) s LAME Info tagem;
  prohlížeč podle něj ořízne encoder delay/padding, takže smyčky hudby zůstanou
  bez mezery a lip-sync na `currentTime` sedí. Když LAME pro nízký bitrate zvolí
  nižší frekvenci, skript vstup převzorkuje předem, aby délka seděla na vzorek.
- ID assetů v obsahu zůstávají původní; Vite plugin podstrčí vygenerovaný
  `.release/assetFiles.ts` a `.release/project.json`. Zdrojové soubory se nemění,
  výstupy kódování se cachují v ignorované `.release/cache/` (první běh AVIF
  trvá několik minut).

#### Volitelná HD sada na S3

Zip zůstává samostatně hratelný; HD sada (preset 0) je jen vylepšení:

```sh
node scripts/build-release.mjs --budget 5 \
  --remote https://<bucket>.s3.<region>.amazonaws.com/tukabel/
npm run release:upload   # AWS_ACCESS_KEY_ID/SECRET, AWS_BUCKET z .env.local
```

- Build uloží HD soubory pod obsahovými hashi do `.release/remote/<build>/`
  i s `manifest.json` (soubory + oblasti animací v HD pixelech). Adresa
  `…/tukabel/<build>/` je zapečená do bundlu, nový build tedy nikdy nepřepíše
  starý.
- Hra při startu (top-level await v `assetFiles`) zkusí stáhnout manifest
  s timeoutem 2,5 s. Při úspěchu jede celá z HD sady, jinak celá ze zipu;
  sady se nemíchají, protože snímky animací sdílí pixely zdroje. `?assets=local`
  vynutí sadu ze zipu. Statické importy (cutscéna, minihra) jsou vždy lokální.
- Bucket musí vracet CORS `Access-Control-Allow-Origin` pro `GET`: Pixi i hudba
  čtou přes `fetch` a alfa masky čtou pixely (`crossOrigin = 'anonymous'`).
- Upload zapisuje jen pod `tukabel/<build>/` jako `public-read` s immutable
  cache, nic nemaže, existující soubory přeskočí a manifest nahraje poslední.
  Region si zjistí z bucketu. Přímé S3 je HTTP/1.1, první scéna (~80 souborů)
  se tak načítá zhruba 3–5 s; CloudFront s HTTP/2 by to zkrátil.

## Dev Mode: tvorba → test → Git

1. V lokální aplikaci přepni **Dev Mode**. Editor načte aktuální zdroj a jeho revizi.
2. V **Lokace** vyber nebo vytvoř lokaci. Přiřaď pozadí a původní rozměry.
   **Nakreslit hotspot** vytvoří obdélník tažením v obrázku. Klik na viditelnou část obrázku objekt vybere a tažení jej posune.
   Levý horní úchyt přesouvá celý rám (i u průhledného assetu), dolní pravý roh
   proporcionálně mění velikost obrázku. Pro výběr překrytého objektu použij seznam.
   Kruh nad rámem otáčí kolem středu; Shift zarovnává po 15°. Escape nebo zrušení
   dotyku vrátí rozpracovaný tah. Každý dokončený tah je jedna úprava ve Zpět/Znovu.
   Číselná šířka/výška v inspektoru se také mění společně. **Rám podle obrázku**
   přizpůsobí klikací rám viditelné velikosti assetu bez změny jeho zobrazení.
   **Deformovat** explicitně povolí nezávislou šířku/výšku a protažení obrázku;
   návrat na **Proporčně** obnoví nativní proporce. Hotspot bez obrázku má volné rozměry.
   **Přiblížení scény** (50–200 %) a posun ve výřezu mění pouze pohled editoru.
   Na dotyku zapni **Posun pohledu** a tažením posuň zvětšený výřez; pro úpravy
   objektů režim zase vypni. Myší používej posuvníky nebo kolečko.
   **Pomůcky scény** vypne rámy, popisky a úchyty pro kontrolu čistého obrázku.
   Editor ukazuje i podmíněně skryté objekty; editace nespouští herní akce.
   **Nakreslit polygon** přidává vrcholy kliknutím nebo dotykem přímo nad pozadím.
   Klik na první bod, Enter nebo **Dokončit polygon** pod scénou uzavře tvar;
   Backspace odebere poslední bod, Escape návrh zruší. Vrcholy lze táhnout,
   **+** na hraně přidá nový bod a vybraný vrchol lze odebrat tlačítkem či Delete
   (zůstávají alespoň tři). Tab a šipky umožňují úpravy klávesnicí, Shift posouvá
   po deseti jednotkách. Tažení uvnitř přesune celý polygon; platí i stávající
   úchyty přesunu, velikosti a rotace. **Převést na polygon / Použít obdélník**
   převede vybraný rám oběma směry. Křížící se hrany se neuloží. Jeden dokončený
   tah nebo úprava bodů je jedna změna ve Zpět/Znovu.
3. V inspektoru nastav jméno, obrázek, viditelnost a pravidla **Kliknutí na objekt**.
   Prázdný seznam je tichá interaktivní kulisa; komentář je volitelný.
   Podmínky i efekty mají formuláře a výběr existujících ID.
   Pravidla a efekty lze přidávat, odstraňovat a přesouvat nahoru.
   Sekce použití inventáře nastavuje reakce na konkrétní předmět.
4. V **Předměty** vytvoř inventární položky, popisy a symboly/obrázky.
   **Dialogy** spravují rozhovory, uzly, odpovědi, další uzly, podmínky a efekty.
   **Hádanky** obsahují herní příznaky, kombinace, úvodní zprávu a výchozí lokaci.
5. **Mapa logiky** zobrazuje podmínky → konkrétní akce/odpovědi → efekty včetně
   inventáře, příznaků, lokací a pokračování dialogů. Filtruj podle ID/textu,
   klikem otevři definici. Zelená hodnotí podmínky vůči poslednímu hernímu náhledu;
   graf nenahrazuje kontrolu pořadí pravidel ani důkaz řešitelnosti hádanky.
6. **Game Mode** nebo **Otestovat odsud** spustí aktuální návrh od začátku
   vybrané lokace, s prázdným inventářem a nenastavenými příznaky. Zápis na disk
   není potřeba. Návrat do Dev Mode zachová rozpracovaný obsah. Chybná data
   blokují test i uložení a editor zobrazí konkrétní chyby.
7. **Uložit do projektu** skutečně zapíše `src/game/content/project.json`.
   Zdroj se ukládá jako formátovaný JSON atomickým přejmenováním dočasného souboru.
   Uložení neobnovuje stránku a zachová pracovní návrh. **Zpět / Znovu** drží
   posledních 50 úprav v paměti; jeden dokončený tah hotspotu je jedna úprava.
8. Prohlédni `git diff` a commitni JSON a případné nové assety. Editor Git příkazy
   nespouští. Neuložený návrh se při obnovení stránky ztratí.

Změní-li soubor jiná záložka nebo coding agent, server vrátí konflikt a novější
soubor nepřepíše. **Zahodit změny a načíst** explicitně převezme zdroj z disku;
předchozí návrh ještě lze vrátit přes Späť. Automatické slučování změn není implementované.
ID nových objektů jsou automatická a stabilní. Při mazání používaného předmětu,
příznaku nebo dialogu oprav i související odkazy, případně operaci vrať.

Existující obrázky se vybírají ze `src/assets/`. PNG/JPEG/WebP do 6 MB lze importovat
přímo z formuláře; import ihned vytvoří nový soubor v `src/assets/imported/` a přiřadí
jej. Nový soubor má jedinečné jméno, nic nepřepisuje. Importované soubory zůstávají
na disku i při vrácení úpravy; jejich úklid je popsaný níže. SVG a AVIF lze přidat
přímo do repozitáře. Názvy assetů používej bez mezer a diakritiky (`a-z`, číslice,
`_`, `-`, podadresáře). Assety se při buildu importují přes Vite; žádné CDN.

Nepoužívané generace můžeš uklidit přes **`npm run assets:clean`** (pouze výpis)
a **`npm run assets:clean -- --apply`**. Skript zkontroluje současný projekt,
projekt v Git HEAD, odkazy v kódu/testech/dokumentaci a návazné recepty.
Používanou UUID generaci zachová celou včetně masek, původního zdroje a skriptů.
Zachová také registrované, zatím nepřiřazené animace a hodinu chrání čerstvé
výstupy kvůli neuloženým náhledům. Uklízí pouze generované UUID složky a soubory
v `imported/`; ručně pojmenované zdroje, ikony, experimenty a modely nemění.

Úklid přesune nepoužívané výstupy z `src/assets/` do ignorované
`.local-tools/asset-trash/<id>/` s manifestem. Zmizí tím i příslušné staré
generace z nabídky/historie editoru. Zálohu obnovíš příkazem, který skript vypíše:
**`npm run assets:clean -- --restore <id>`**; existující soubory nepřepíše.
Záloha stále zabírá místo na disku a nemaže se automaticky. Před úklidem ulož
aktuální návrh v editoru; po něm spusť `npm run validate:content` a build.

## Vrstvy a grafické úpravy lokací

V **Dev Mode → Lokace** zůstává scéna rozložená na pozadí a samostatné vrstvy.
Seznam **Vrstvy** ukazuje přední objekty nahoře. Šipky mění pořadí vykreslování;
oko nastavuje viditelnost i ve hře, zámek chrání editorové tahy a vlastnosti.
Krytí se ukládá jako 0–1. **+ Obrázková vrstva** přidá dekoraci; její PNG/WebP/JPEG
lze importovat přímo v poli **Obrázek vrstvy**. Vyber ji ze seznamu nebo za viditelné
pixely a přesuň/zvětši/otoč existujícími úchyty. **Interaktivní objekt** zapne běžné
hotspotové reakce a inventární pravidla v pravém inspektoru. Dekorace propouštějí
herní hover, kliknutí i drop na objekty pod nimi. Zamknutí nemění chování hry.

Chování zástupného objektu přeneseš na novou grafiku tlačítkem **Kopírovat chování**
pod scénou: vyber původní objekt a potom klikni na cíl ve scéně nebo v seznamu
vrstev. Přenesou se podmínky viditelnosti, kliknutí, použití inventáře, otevření
mapy, kurzor a příznak interaktivní/dekorativní vrstvy; dosavadní pravidla cíle se
nahradí. Obrázek, název, ID, umístění, polygon, animace, krytí a ruční skrytí cíle
zůstávají zachované. Zamčený cíl nejdřív odemkni. Escape kopírování zruší,
**Zpět/Znovu** vrátí celý přenos v jednom kroku. Původní objekt zůstává na místě;
po kontrole výsledku ho ručně smaž a použij **Uložit do projektu**.

1. V **Zdroj grafické úpravy** vyber pozadí nebo právě vybranou obrázkovou vrstvu.
2. Nad scénou zvol **Vybrat obdélník** a táhni, nebo **Vybrat polygon** a přidávej body.
   Polygon uzavři Enterem, prvním bodem nebo **Dokončit polygon**. Escape ruší návrh.
   Oblast není nový herní hotspot. Výběr se převádí přes zoom, natočení a contain-fit
   do původních pixelů konkrétního obrázku; část mimo něj se odmítne.
3. V **Výběr a grafika** zvol operaci a název výsledku:
   - **Vyříznout objekt maskou → nová vrstva (SAM / ruční)** používá stejný
     editor masek jako AI oddělení: výslovně spusť SAM3/SAM2 nebo uprav štětcem,
     případně dopočítej jemné hrany, a potvrď **Použít masku**. **Vyříznout maskou
     do nové vrstvy** připraví samostatné transparentní PNG pouze z původního
     obrázku. Bez připravené masky se nespustí. OpenAI klíč ani generování pozadí
     nejsou potřeba; původní obrázek se nemění. **Použít výsledek ve scéně**
     přidá novou vrstvu oříznutou podle alfy a přesně umístěnou přes `cutoutFrame`;
     celou operaci vrátí jeden krok Zpět. Připravenou masku lze převzít i z právě
     nastaveného AI oddělení, pokud zdroj a výběr zůstaly stejné.
   - **Kopie výběru** zkopíruje původní pixely do transparentního PNG. Pro přesný
     tvar objektu obkresli polygon; obdélník zachová i pozadí uvnitř obdélníku.
     Zdroj se při této místní operaci nemaže ani neopravuje.
   - **Plynulá PNG smyčka** vytvoří 4–24 stejně zarovnaných snímků. Voda vlní texturu,
     mraky ji posouvají tam a zpět, kouř ji jemně vlní a posouvá svisle. Jde o
     periodické deformace původních pixelů s pevnými okraji, nikoli AI video nebo
     simulaci kapaliny. Nastav sílu v pixelech zdroje, počet snímků a fps.
   - **AI upravit** upraví vybranou oblast; bez výběru celý zdroj. **AI odstranit**
     doplní pozadí za výběrem. **AI oddělit** provede stejnou opravu a současně
     zachová původní výřez jako samostatnou transparentní vrstvu.
   - **AI · vytvořit asset** vytvoří nový transparentní objekt podle pozadí
     a vyznačeného místa. Původní pozadí se nemění.
   - **AI nová lokace** použije současné pozadí jako stylovou referenci a vytvoří
     další lokaci, aniž přepíše současnou.
4. **Vytvořit lokální asset** nebo výslovné **Spustit AI úpravu (API kredit)**
   založí úlohu na pozadí. Můžeš mezitím upravovat i ukládat projekt, měnit
   záložku nebo přejít do Game Mode. Přehled **Úlohy na pozadí** ukazuje kroky
   a nabízí **Otevřít výsledek**, které obnoví správnou lokaci a zdroj.
   Smyčku lze přehrát i procházet po snímcích.
   **Použít výsledek ve scéně** teprve přiřadí assety a případný animační klip.
   Operace tvoří jeden krok **Zpět**. Pokud mezitím změníš zdroj, jeho umístění
   nebo rozměry lokace, starý náhled nelze použít přes novější úpravy. Přejmenování
   lokace nebo úpravy jiných objektů mu nevadí. Změna obrázku odpojí jeho původní animace.
5. **Živý náhled animací** přepne pracovní plochu na stejný Pixi renderer jako hra.
   **Otestovat odsud ↗** otevře interaktivní Game Mode. **Uložit do projektu**
   zapíše pořadí, vlastnosti, vazby i klipy do `src/game/content/project.json`.

### Vytvoření nového objektu pomocí AI

1. V **Výběr a grafika** zvol **AI · vytvořit asset**. Zdrojem je pozadí lokace.
   Nad scénou vyber obdélník nebo polygon tam, kam má nový objekt přijít.
   Výběr určuje maximální velikost a umístění, nikoli přesný obrys objektu.
2. Zadej název vrstvy a pokyn, například „Přidej sem láhev od piva“.
   Klikni na **Spustit AI úpravu (API kredit)**. Jde o jedno vědomé volání
   stávajícího OpenAI Image API se zvoleným modelem a kvalitou, bez opakování.
   Klíč zůstává v serverovém `OPENAI_API_KEY`; produkce ho nepotřebuje.
3. Zkontroluj samostatný objekt na šachovnici a náhled na původním pozadí.
   **Použít výsledek ve scéně** přidá novou přední interaktivní vrstvu.
   Objekt se ořízne podle alfy a proporcionálně vejde do výběru; jeho základna
   se zarovná na dolní hranu výběru. Potom ho lze běžně přesunout či zmenšit.
4. Nová vrstva má zatím prázdná pravidla kliknutí. Pro sebrání vytvoř položku
   v **Předměty**, vrstvě přidej pravidlo **Kliknutí na objekt → Přidat předmět**
   a viditelnost „hráč tento předmět nemá“. Inventářová ikona může použít stejné PNG.
   **Uložit do projektu** zapíše vrstvu a pravidla do verzovaného JSON.

AI dostane čisté referenční pozadí a druhou kopii s vyznačeným místem; vrací
nativně transparentní PNG, nikoli opravené pozadí. Neprůhledný, prázdný nebo
na hraně plátna useknutý výsledek se odmítne. Výběr objekt neořezává polygonem.
Do `src/assets/scene-art/<uuid>/` se archivují zdroj, vodítko, původní odpověď
modelu, oříznutý asset, plný transparentní snímek, náhled a recept s původním
offsetem. Náhled je pouze pro kontrolu; nikdy nenahrazuje pozadí lokace.
Použití tvoří jeden undo krok a odmítne mezitím změněný zdroj nebo rozměry lokace.

Nové assety před touto kontrolou odstraní pouze zanedbatelnou alfu 0–1/255;
několik téměř neviditelných pixelů tak neblokuje vložení. Průhledná hrana i
vnitřní alfa objektu nad touto hodnotou zůstávají zachované. Skutečně useknutý
nebo neprůhledný výstup se nadále odmítne.

Již zaplacené blokované PNG otevři přes **Načíst dřívější výsledky (bez API) →
Uložený výsledek → Nový asset**. Pokud vadí jen okrajová alfa 1/255, editor je
automaticky lokálně připraví a zpřístupní **Použít výsledek ve scéně**. Ručně
lze zvolit **Rozlišení připraveného assetu → 1× / 2×** a **Připravit uložený asset
(bez API)**. 2× mění počet pixelů, nikoli herní velikost a polohu. Příprava
vytvoří nový UUID archiv s `derivedFrom`; originál, původní odpověď poskytovatele
a projekt zůstávají beze změny až do vědomého použití výsledku. Nepoužívá AI,
SAM ani zarovnání podle detailů původního objektu. Historie kontroluje stejný
zdroj, jeho SHA-256, rám a skutečné PNG rozměry; přežije restart Vite.

### Přesné oddělení objektu a oprava pozadí

1. Vyber **Zdroj grafické úpravy → Pozadí lokace** a operaci
   **AI · oddělit objekt + opravit pozadí**. Nad scénou zvol **Vybrat obdélník**
   nebo **Vybrat polygon** a volně obkresli celý objekt včetně obrysu. Zdroj je
   ve výchozím stavu pozadí, i když je vybraná postava. Pro úpravu samostatného
   assetu výslovně zvol **Vybraná obrázková vrstva**; změna zdroje polygon nemaže.
2. Klikni na **Zpřesnit / upravit masku objektu**. Zelený štětec ponechává pixely
   objektu, červený odstraňuje pozadí a umí vytvořit i otvory uvnitř objektu.
   Tyto tahy zároveň určují jisté popředí/pozadí pro segmentaci. Označ několik
   charakteristických barev a také tenké černé obrysy, které mají zůstat.
3. **Zpřesnit hranice objektu** spustí vybraný lokální nástroj. U SAM nech zapnuté
   **Dotáhnout obrysy a tenké části**: po rozpoznání objektu se hranice dotáhnou
   podle původních pixelů, což pomáhá například anténám routeru. Pro srovnání lze
   přepínač vypnout a vrátit se pomocí **Zpět v masce**. Tento krok vytvoří základní
   binární masku; jemnou alfu dopočítá následující samostatný krok.
   Výsledek zkontroluj a případně uprav štětcem nebo segmentaci zopakuj. **Přiblížit
   objekt**, zoom až 8×, původní obrázek, barevná maska a šachovnice pomohou odhalit
   chybějící čáry. **Zpět v masce** vrací celé tahy i segmentaci; přerušený tah nic
   neukládá. PNG masku lze také načíst tlačítkem **Načíst PNG masku**; šedé hodnoty
   0–255 se zachovávají. V panelu **2. Jemné hrany · alpha matting** vyber
   **ViTMatte + přesné kreslené hrany** a klikni **Vypočítat jemnou alfu**.
   Výchozí pásmo 4 px určuje nejisté okolí hrany v původním rozlišení. Oranžovým
   štětcem uvolni chybný pevný okraj, zeleným označ jistý objekt, červeným jisté
   pozadí a výpočet zopakuj. Automaticky chybějící část nejprve přidej zeleně.
   **Odstranit barevný lem** odhadne původní barvu pouze v částečných hranách;
   vypnutí zachová všechna původní RGB. Změna nastavení se projeví až novým výpočtem.
   Po ruční opravě masky je při odstranění lemu nutný nový výpočet barev před exportem.
   Prohlédni výřez na **bílé i černé** a v režimu **Alfa**; samotná šachovnice
   barevné lemy snadno skryje. Undo vrací i předchozí alfu a odhad barev.
4. U oddělení/odstranění nastav **Dočištění pozadí za obrysem** (výchozí 12 px,
   rozsah 0–64 v původních pixelech). Odstraní i zbytky obrysů nebo stínu mimo
   masku objektu; přesah se skutečně použije na publikované pozadí a šev se
   uvnitř něj jemně spojí. Hodnota 0 zachová původní pozadí přesně mimo objekt.
   **Přechod švu** (výchozí 2 px, 0–32) určuje plynulý přechod uvnitř přesahu;
   skutečná šířka je nejvýše velikost přesahu. Na jeho vnější hranici má nulovou
   sílu, samotný objekt se vždy opravuje plně. Hodnota 0 umožní porovnat tvrdý šev.
   Náhled **Maska opravy pozadí** ukazuje dovolený rozsah změn.
   **Použít masku** vrátí schválenou masku do grafického panelu. Teprve **Spustit AI
   úpravu (API kredit)** pošle zdroj a samostatnou opravnou masku službě pro doplnění
   pozadí. Objekt se nikdy negeneruje. Bez placeného API lze místo oddělení zvolit
   **Kopie výběru → transparentní vrstva**, která použije tutéž masku a původní pixely.
5. V náhledu porovnej originál s opraveným pozadím a vráceným objektem pomocí
   posuvníku. Lze zobrazit také samotný výřez, pozadí nebo rozdílový obraz. Kontrola
   musí hlásit **0 chyb při zachování původních pixelů a zarovnání**.
   Zlatý rozdíl označuje úmyslné dočištění pozadí v opravném přesahu, modrý změny
   částečných hran při mattingu; červený by
   znamenal chybu objektu nebo změnu vzdáleného okolí a nesmí se publikovat.
   U mattingu se přesně kontroluje jádro a vzdálené okolí; částečné hrany se na novém
   pozadí záměrně liší. To ověřuje zarovnání; správné rozpoznání objektu je potřeba
   zkontrolovat na šachovnici. Přesné složení samo nepozná omylem přibalené pozadí.
6. V **Pozadí pro scénu** zvol **Celý obnovený výsledek · provider-restored.png**
   (výchozí) nebo **Kompozice přes masku · image.png**. První varianta použije celý
   výsledek AI po přesném návratu do původních souřadnic a nevrací původní stíny.
   Může ale změnit i vzdálené okolí; zkontroluj celé pozadí. Druhá varianta ponechá
   původní pixely mimo masku, takže při těsném výběru může vrátit stín nebo obrys.
   Porovnání a nulové metriky dále hodnotí **maskovanou kompozici**, nikoli volitelné
   celé pozadí AI. Surový `provider-returned.png` obsahuje modelový letterbox,
   proto se přímo do scény nepřiřazuje.
7. **Použít výsledek ve scéně → Uložit do projektu** nahradí pozadí a přidá oddělenou
   vrstvu na původní místo. Scéna proto může vypadat stejně. Novou vrstvu skryj nebo
   přesuň, abys viděl opravené pozadí. Konfigurace a assety lze běžně commitnout.

Dřívější výsledek lze otevřít bez regenerace: jako **Zdroj grafické úpravy** zvol
**Pozadí lokace** (původní zdroj nebo už použité `image.png` / `provider-restored.png`), klikni **Načíst dřívější výsledky (bez API)** a vyber
**Uložený výsledek**. Pak zvol variantu pozadí a použij výsledek. Archiv lze otevřít
i po restartu Vite. U už použitého výsledku se vymění pouze pozadí, objekt se
nezduplikuje. Nabízí odstranění, oddělení i nové assety se shodnou cestou i SHA-256
zdroje a platnými PNG. U změněného zdroje se nic nepoužije. Starší výřezy v2
zůstávají v původních rozměrech, nové operace už vytvářejí oříznuté assety.

### Diagnostika inpaintingu

U **AI · odstranit a opravit pozadí** nebo **AI · oddělit objekt + opravit pozadí**
nastav výběr/masku, přesah a přechod a klikni **Zkontrolovat přípravu (bez API)**.
Tato úloha nevolá model, nepotřebuje klíč a nemá použitelné tlačítko pro změnu scény.
V **Diagnostika inpaintingu** přepínej původní obrázek, masku objektu, rozšířenou masku,
přesný vstup pro model, API masku a kontrolní návrat bez AI. Zoom 1:1/2× a posuvný
náhled umožňují kontrolovat tenké obrysy; masky lze překrýt originálem nebo otevřít
PNG samostatně. Poté vědomě spusť AI úpravu. U jejího výsledku přibudou surová odpověď,
návrat do původních souřadnic, finální pozadí a rozdíl vůči kontrolnímu návratu.
Diagnostika hotové úlohy přežije reload a lze ji otevřít z fronty; restart serveru
frontu zruší, archivované soubory a recept na disku zůstávají.

Model dostává **celý zdroj, nikoli lokální crop**. Ten se proporcionálně vloží do
pracovního rámu 1536×1024 / 1024×1536 / 1024×1024. U 1280×720 je obsah 1536×864,
odsazený o 0,80 px. Návrat vyřízne přesně tento obsah a přepočítá jej na původní
plátno. Geometrii vždy ukazuje diagnostika a ukládá recept. Nativní binární maska
se rozšiřuje čtvercovým okolím o zvolený poloměr. Při zmenšení pracovní masky se
použije konzervativní pokrytí pixelů, aby nezmizela tenká anténa; okolí se může
rozšířit nejvýše o pracovní pixel. Alfa API masky je opačná: průhledné = povolená
oprava, neprůhledné = chráněné; okraje pracovního plátna jsou chráněné.

U odstranění/oddělení se nyní archivují navíc:

- `expanded-mask.png` — binární oprava v původních souřadnicích;
- `repair-mask.png` — skutečná síla kompozice 0–255, včetně přechodu;
- `provider-input.png`, `provider-mask.png` — přesné PNG bajty odeslané modelu;
- `provider-returned.png` — přesné vrácené PNG před úpravami;
- `round-trip.png` — odeslaný obrázek vrácený zpět **bez AI**, kontrola převzorkování;
- `provider-restored.png` — odpověď vrácená do původních souřadnic před kompozicí;
- `provider-difference.png` — absolutní RGB rozdíl odpovědi proti kontrolnímu návratu, zesílený 4×;
- `image.png` — maskovaná kompozice, volitelná varianta pozadí; `recipe.json` obsahuje parametry, geometrii, metriky a upozornění.

Při kontrole postupuj od masky: nezůstaly obrysy/stín mimo rozšířenou oblast, není
naopak přesah příliš velký? Pak ověř přesný vstup a API masku. `round-trip.png`
odděluje ztrátu detailů při škálování od změn modelu. Diagnostika měří RGB MAE v
chráněném kontextu i v 4px prstenci kolem opravy vůči tomuto kontrolnímu návratu.
Je to měření změny, nikoli důkaz správnosti inpaintingu ani automatický color matching.
Finální kompozice musí mít **0 změněných pixelů mimo opravnou masku**. Rozdílné rozměry
odpovědi se již potichu neroztahují: vrácené PNG se zpřístupní k diagnostice, ale
výsledek nelze použít. Skládání částečně průhledných pixelů interpoluje premultiplied
příspěvky a ukládá straight RGBA, aby skryté RGB nevytvářelo barevný lem.

Audit odhalil nenulovou sílu starého švu na vnější hranici (u jednoho uloženého
výřezu 134–204/255 těsně vedle nuly). Nový přechod končí nulou, nezměkčuje masku
samotného assetu. Testy používají identickou odpověď modelu, řízený barevný posun,
chybnou velikost, tenké části při zmenšení i částečnou alfu; žádné placené generování.
U starších artefaktů bez surové odpovědi nelze příčinu barevné
odchylky zpětně jednoznačně určit. Nový skutečný výsledek posuzuj těmito kroky
dříve než změnou modelu nebo barevným dorovnáváním.

Lokální automatické spřesnění nainstaluj jednou pomocí **`npm run setup:segmentation`**
(Python 3 s podporou `venv`; vytvoří ignorované `.local-tools/segmentation/` s připnutými
OpenCV a NumPy). Pak restartuj Vite. Ruční maskování a import PNG masky fungují i bez
Pythonu. Jiný lokální interpreter lze zadat serverovým `SEGMENTATION_PYTHON`.
[GrabCut](https://docs.opencv.org/4.x/d8/d83/tutorial_py_grabcut.html) není sémantický
model: při podobných barvách objektu a pozadí potřebuje více tahů nebo ruční opravu.

Volitelně podporujeme **[SAM 2.1 Tiny](https://github.com/facebookresearch/sam2)**
na CPU přes stejný editor. Instalace do stejného izolovaného prostředí (Linux,
Python 3.10+, `git`, přibližně 2 GB místa; stahování se spustí pouze těmito příkazy):

```bash
npm run setup:segmentation
.local-tools/segmentation/bin/python -m pip install --no-cache-dir torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cpu
SAM2_BUILD_CUDA=0 .local-tools/segmentation/bin/python -m pip install --no-cache-dir --no-build-isolation wheel 'git+https://github.com/facebookresearch/sam2.git@2b90b9f5ceec907a1c18123530e92e794ad901a4'
mkdir -p .local-tools/models
curl -fL --output .local-tools/models/sam2.1_hiera_tiny.pt https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
```

Checkpoint má 156 008 466 bajtů a SHA-256
`7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`.
Do ignorovaného `.env.local` nastav `SAM2_CHECKPOINT` na absolutní cestu k tomuto
souboru; `SAM2_CONFIG=configs/sam2.1/sam2.1_hiera_t.yaml`. Pokud nepoužíváš výše
uvedený interpreter, nastav i `SEGMENTATION_PYTHON`. Restartuj `npm run dev`.
V okně **Zpřesnit / upravit masku objektu → Segmentace hranic** se zpřístupní
**SAM 2 · lokální AI model**; vyber ho a klikni **Zpřesnit hranice objektu**.
Volitelný experimentální **Detailní přechod** analyzuje navíc kontextový výřez, takže má model
k dispozici více pixelů samotného objektu. Odlišnou interpretaci výřezu odmítne;
oba průchody i finální maska respektují explicitní tahy štětce. Výřez nemusí
být lepší pro každý objekt, proto je výchozí vypnutý.
Výsledek zkontroluj na šachovnici, případně oprav zeleným/červeným štětcem a zopakuj.
Model dostává celý zdroj kvůli kontextu, rám výběru a body odvozené z tahů štětce;
výsledná maska vybírá původní pixely, objekt se negeneruje znovu.
Pro vyšší kapacitu modelu je lokálně ověřený také **SAM 2.1 Large** (898 MB vah).
Používá stejnou instalaci Pythonu. [Oficiální checkpoint](https://huggingface.co/facebook/sam2.1-hiera-large)
stáhni do `.local-tools/models/sam2.1_hiera_large.pt`, nastav jeho absolutní cestu
v `SAM2_CHECKPOINT` a `SAM2_CONFIG=configs/sam2.1/sam2.1_hiera_l.yaml`.
SHA-256 vah je `2647878d5dfa5098f2f8649825738a9345572bae2d4350a2468587ece47dd318`.
Po změně `.env.local` restartuj Vite. Na routeru se osvědčil Large s celou scénou
s následným dotažením hran; větší model sám nezaručuje přesnou segmentaci.

Výchozí dotažení hran používá GrabCut v původním rozlišení pouze v pásmu 12 px
okolo odhadu SAM; vnitřek a vzdálené pozadí zůstávají pevné. Nové oddělené
ostrůvky vytvořené jen barevným dotažením bez vazby na původní masku nebo zelený
štětec se zahodí; již rozpoznané oddělené části se zachovají. Maska se nerozmazává
ani plošně nezvětšuje. Zelené/červené tahy jsou pevná pravidla pro oba kroky.
Pokud chybí celá tenká část, projdi ji zeleným štětcem a pozadí kolem ní červeným;
automatické dotažení není záruka perfektního obrysu. Ve zvětšení alespoň 1:1 se
canvas zobrazuje bez vyhlazení, takže jsou skutečné chybějící pixely dobře vidět.

Skutečné lokální inference GrabCut i SAM 2 jsou ověřené na kreslených hodinách
v `tests/object-mask-rules.spec.ts`, včetně zachování RGB/alpha původního objektu.
Test routeru porovnává samotný SAM s dotažením proti původním SVG obrysům a
vyžaduje zachování alespoň 98,5 % pixelů obou antén bez nové poloprůhlednosti.
Test SAM se přeskočí, pokud chybí instalace nebo checkpoint (výše uvedená cesta,
případně `SAM2_CHECKPOINT`). Browserový test masky použije SAM, pokud je nastavený
`SAM2_CHECKPOINT`, jinak GrabCut. Modely ani kód se za běhu automaticky nestahují.
Produkční hra nepotřebuje Python, modely ani API. Segmentace běží mimo zámek
projektového save, bez shellu a s timeoutem.

### OpenAI výřez objektu

U **AI · oddělit objekt + opravit pozadí** lze v poli **Způsob výřezu objektu**
vybrat **OpenAI · transparentní výřez**. Výchozí zůstává výřez původních pixelů
podle ruční/SAM masky. Nová varianta nevyžaduje SAM: stačí označit objekt;
připravená SAM 2/3 či jemná maska ale zpřesní původní cílový rám i vodítko.
OpenAI dostane čistý původní výřez s okolím a oddělenou označenou referenci,
a vrátí transparentní PNG. Nepřebírá se RGB již oříznutého nebo odbarveného náhledu.

Jedno výslovné spuštění provede dva placené požadavky bez retry: dosavadní opravu
pozadí a navíc izolaci objektu stejným vybraným modelem/kvalitou. Diagnostika bez API
nespouští ani jeden. Výsledek se ořízne podle alfy a proporčně vejde do původního
rámu s kotvou dolní střed; zachová otisk zdroje, offset i původní transformace
včetně rotace přes `croppedPlacement`. SAM zde určuje rám, nepřesouvá pixely.
OpenAI může objekt jemně překreslit: původní obrys ani pixelovou shodu nezaručuje.
Před použitím zkontroluj původní pozadí s vloženým objektem a posuvné porovnání
s kompozicí nad maskovanou opravou. Tato varianta nehlásí nulovou chybu reassembly.
Prázdné, neprůhledné a na okraji useknuté výstupy se odmítnou bez dalšího volání.
Odmítnutí kontrolou umístění se nyní také archivuje: náhled ukáže surové PNG,
odkazy na vstup/vodítko, úplnou cestu v `src/assets/scene-art/<uuid>/` a počty
průhledných/částečných/neprůhledných pixelů včetně alfy na okraji. Starší kontrola odmítala i jediný okrajový pixel s alfou 1/255; samotná hláška
proto nerozlišovala useknutý objekt od slabého zbytku pozadí. `assetDiagnostic` a `blockedReason`
jsou v receptu; Apply je zakázané. Odmítnuté OpenAI výřezy lze znovu otevřít
z historie i po restartu Vite. Starší odmítnuté výstupy před touto opravou se
zahazovaly před archivací a zpětně je nelze obnovit.

Archiv obsahuje navíc `extraction-input.png`, `extraction-guide.png`,
`extraction-returned.png`, `preview.png` a `reassembled.png`; `recipe.json`
zachycuje metodu, původní rám, zdroj vodítka a umístění. Výsledky lze znovu
otevřít z historie bez generace. Oprava pozadí, její obě varianty, vědomé Apply,
kontrola změněného cíle a jeden undo krok zůstávají stejné.

Nové OpenAI výřezy i samostatné assety automaticky odstraní zanedbatelnou alfu 0–1/255 už před
kontrolou umístění. Starší odmítnutý výřez s pouze takto slabou alfou na okraji
se při otevření automaticky lokálně připraví jednou, bez API a bez přepsání archivu.
Poté je Apply dostupné bez mezikroku. Skutečný obsah na okraji zůstává blokovaný.
U tlačítka Apply se vždy zobrazí konkrétní důvod blokace (příprava, zamčený cíl,
změněný zdroj/umístění, diagnostika nebo nepoužitelný výstup).

U uloženého OpenAI výřezu lze zvolit **Rozlišení připraveného výřezu → 1× / 2×**
a kliknout **Připravit uložený výřez (bez API)**. Z již zaplaceného PNG vznikne nový
archiv; původní se nepřepisuje. Příprava odstraní pouze alfu 0–1/255 a ponechá
zbytek jemné hrany. Skutečný obsah na okraji i zcela neprůhledný výstup nadále
odmítá. Neopakují se ani výřez, ani oprava pozadí přes API. Používá původní cílový
rám a kontroluje hash zdroje; změněný zdroj nebo neplatný archiv odmítne.

Výchozí 1× uloží oříznutý PNG v původní velikosti objektu. 2× zdvojnásobí počet
pixelů v obou osách, **nikoli herní rám ani polohu**. Stejná volba je i před
novou generací assetu / OpenAI výřezu. Pracovní výstup API může být větší kvůli
podporovaným rozlišením modelu; do hry jde připravený výřez. Recept uchovává
`assetScale`, `alphaCutoff` a `derivedFrom`. Použití a undo probíhá až stávající
akcí Apply. Lokální příprava má pouze vývojový endpoint `/art/prepare`.

Prompty výřezu výslovně zakazují zesvětlování, přisvětlování, bělení oblečení,
čištění skvrn, změnu kontrastu/saturace i nové barevné ladění. Požadují původní
RGB, stíny, textury a špínu; označené vodítko neslouží jako barevná reference.
Oprava pozadí požaduje jen doplnění chybějícího okolí podle sousedních pixelů,
bez změny jasu nebo barev scény. Skutečné texty odeslané API jsou v receptu
pod `providerPrompts.background` / `providerPrompts.extraction` (bez klíčů).
Jde o pokyny generativnímu modelu, ne záruku přesných barev. Neprobíhá žádné
automatické dorovnávání barev. Pro přesné RGB objektu použij původní pixely
se SAM/ruční maskou; pro zachování okolí mimo opravu zvol **Kompozice přes masku**.
Dřívější PNG se změnou promptu nemění a generování se samo neopakuje.

### Zarovnání OpenAI výřezu podle původního obrázku

Pouhé vměstnání do ručního/SAM rámu je přibližné: průhledné okraje i změněné
proporce výstupu mohou posunout postavu. Je-li dostupný segmentační OpenCV runtime,
editor proto nové i otevřené starší OpenAI výřezy jednou automaticky zarovná
podle skutečných detailů. Volba **Zarovnání připraveného výřezu → Podle detailů
původního objektu** a tlačítko **Zarovnat podle původního obrázku (bez API)**
umožňují totéž ručně. **Podle rámu výběru** zachovává původní přibližnou metodu.

SIFT páruje detaily původního objektu uvnitř výběru s krytým jádrem nového PNG;
RANSAC odhadne posun, jednotné měřítko a malé natočení. Nepoužívá smyk ani změnu
poměru stran. Výsledek musí mít alespoň 12 ověřených shod, prostorové pokrytí obou
os a omezenou chybu. Při nedostatečné shodě nebo nedostupném runtime se nic
nepřepíše, výsledek zůstává v dosavadní poloze a UI ukáže chybu. Nejde o nový AI
požadavek, nestahují se modely a zpracování může běžet přes již nastavené SSH.

Transformace se zapeče do PNG v původních souřadnicích zdroje. Výřezy stále
používají `cutoutFrame` / `croppedPlacement`, včetně contain, rotace původní vrstvy
a rozlišení 1×/2×. Interpolace probíhá v premultiplied RGBA, PNG se ukládá straight.
Starý archiv zůstane zachovaný. Nový recept obsahuje `alignment` s transformací,
počtem shod a chybou; `alignment-matches.png` ukazuje spárované detaily a lze jej
otevřít z náhledu. Historie zachovává zarovnání bez dalšího výpočtu.
Medián chyby popisuje spárované body, nikoli přesnou shodu celé překreslené postavy.
Pokud OpenAI změnilo proporce nebo pózu, jediná transformace všechny obrysy nesrovná.

### Segmentace a matting na vzdáleném počítači

Dev Mode může spouštět SAM 2/3, GrabCut, ViTMatte, closed-form i odstranění
barevného lemu přes OpenSSH na jiném Linuxovém počítači. Do serverového `.env.local`
nastav `SEGMENTATION_BACKEND=ssh`, `MY_LOCAL_PC_HOST`, `MY_LOCAL_PC_USER` a případně
`MY_LOCAL_PC_PASSWORD`; bez hesla fungují SSH klíče a ssh-agent. Nejprve se připoj
běžným `ssh user@host` a ověř klíč serveru. Transport vyžaduje známý klíč
(`StrictHostKeyChecking=yes`); vlastní soubor určuje `SEGMENTATION_SSH_KNOWN_HOSTS`.
Volitelné `SEGMENTATION_SSH_PORT` mění port. Potom restartuj Vite.

Vzdálený projekt je standardně `~/Projects/tukabel`, jinou absolutní cestu nastav
přes `SEGMENTATION_SSH_ROOT`. Jeho `.env.local` určuje `SEGMENTATION_PYTHON`,
`SAM2_CHECKPOINT`, `SAM2_CONFIG`, `SAM3_PYTHON`, `SAM3_MODEL` a `VITMATTE_MODEL`.
Modely i závislosti musí být již nainstalované. Aktuální helpery se posílají s každou
úlohou do dočasného adresáře; vzdálený Git ani projektový JSON se nemění. Zdroj,
masky a tahy zůstávají v původním rozlišení, zpět se vracejí pouze výsledné PNG.
Stejný backend používá náhled i přepočet barev při exportu. Dočasná data runner
uklízí i při chybě; po násilném ukončení počítače mohou zůstat v systémovém tmp.

`SEGMENTATION_DEVICE=auto` použije CUDA, pokud ji vzdálený PyTorch podporuje,
jinak CPU. `cuda` GPU výslovně vyžaduje a `cpu` jej vypne. Samotná přítomnost
NVIDIA karty nestačí: CPU sestavení PyTorch GPU nepoužije. GrabCut a closed-form
zůstávají CPU operace. Lokální backend zachovává výchozí CPU. Za běhu se nic
nestahuje ani automaticky neopakuje; při chybě SSH se nepřepíná na místní modely.
Každý požadavek má limit 300 s. Údaje nejsou součástí klienta ani produkčního API.
SSH klient a Python 3 musí být dostupné také na stroji s Vite (heslo předává
lokální `SSH_ASKPASS` helper, nikdy argument příkazu).

### Alpha matting: instalace, kvalita a soubory

ViTMatte i PyMatting jsou lokálně ověřené se skutečnými modely na CPU.
Na novém stroji s **Pythonem 3.12** spusť **`npm run setup:matting`** a restartuj Vite. Instalátor
připraví stejné ignorované Python prostředí jako segmentace, CPU PyTorch a připnuté
knihovny v `scripts/segmentation/requirements-matting.txt`. Stáhne přibližně 99 MB
safetensors vah [ViTMatte Small](https://huggingface.co/hustvl/vitmatte-small-composition-1k)
(revize `6a58ad7646403c1df626fbd746900aec7361ea1d`, SHA-256
`bda9289db1bb6762d978b42d1c62ae3f34daf7497171a347a1d09657efd788cb`). Celá instalace
včetně PyTorch vyžaduje několik GB. Volitelný serverový `VITMATTE_MODEL` určuje jiný
lokální adresář; výchozí je `.local-tools/models/vitmatte-small`. Inference běží
offline, bez API kreditů, automatického stahování či vzdáleného Python kódu.
Vite ignoruje `.local-tools/`, aby prostředí a modely nevyčerpávaly file watchery.

Pipeline vychází z propojení segmentace a trimapu v
[Matte Anything](https://github.com/hustvl/Matte-Anything), ale zachovává současný
editor. **SAM 2 určí objekt → ViTMatte odhadne alfu → úzký closed-form průchod podle
původních barev zpřesní kreslené hrany.** Samostatný **Closed-form · původní barvy**
je dostupný pro porovnání. Pracujeme v původním rozlišení, u větších obrázků v
překrývaných dlaždicích 768 px; žádné zmenšení ani posun výsledného plátna.
Známé popředí/pozadí z trimapu zůstává pevné, proto špatný jistý pixel oprav štětcem.
Nejde o generativní překreslování. SAM 3 je volitelná segmentační alternativa popsaná níže;
BiRefNet není závislostí. Matting zůstává samostatný krok, protože nový segmentační
model sám o sobě nezaručuje lepší antialiasing kreslené hrany.

### Volitelný SAM 3

Segmentaci pomocí bodů a rámu zajišťuje lokální
[SAM 3 Tracker v Transformers](https://huggingface.co/docs/transformers/model_doc/sam3_tracker).
Zelené/červené tahy, detailní průchod, dotažení původních hran a následný ViTMatte
fungují stejně jako u SAM 2. Výsledkem je maska v původním rozlišení, žádné nové RGB.
SAM 2 zůstává dostupný pro srovnání; automatický fallback na jiný model neprobíhá.

```sh
npm run setup:sam3 -- --runtime-only  # izolovaný CPU runtime, bez vah
npm run setup:sam3 -- --check-access  # ověření tokenu a přístupu, bez stahování vah
npm run setup:sam3                   # runtime + explicitní stažení schválených vah
```

Instalátor používá Python 3.12 a samostatné `.local-tools/sam3/` (PyTorch 2.7.1 CPU,
Transformers 5.20.2), takže nemění fungující SAM 2 / ViTMatte. Oficiální váhy
[facebook/sam3](https://huggingface.co/facebook/sam3) vyžadují schválený přístup.
Požádej o něj na stránce modelu pod účtem, kterému patří tvůj `HF_TOKEN`, a počkej
na schválení. Samotné vytvoření tokenu přístup k modelu neuděluje. Token vlož do
ignorovaného `.env.local` nebo prostředí shellu (shell má přednost). HTTP 401 znamená
odmítnutý token; HTTP 403 při platném tokenu znamená chybějící přístup k modelu nebo
oprávnění tokenu. Fine-grained token musí povolovat čtení modelu i přístup k veřejným
gated repozitářům, ke kterým má účet přístup. Instalátor chyby rozlišuje, neodsouhlasí
podmínky za uživatele a token nevypisuje. Připravený runtime při dalším spuštění
znovu neinstaluje. Po schválení zopakuj `npm run setup:sam3`.
Model uloží do `.local-tools/models/sam3/` (nebo `SAM3_MODEL`); pak restartuj Vite a zvol
**Segmentace hranic → SAM 3 · lokální AI model**. Volitelné serverové `SAM3_PYTHON`
a `SAM3_MODEL` umožňují jiné lokální cesty. Za běhu editoru se nic nestahuje,
načítají se pouze lokální safetensors bez vzdáleného modelového kódu.
Editor povolí SAM 3 až po stažení všech částí checkpointu; samotný stažený index nestačí.

Lokální pravidlový test ověřuje offline průchod adaptérem na malé náhodně
inicializované architektuře (tvary vstupů a nativní souřadnice, nikoli kvalitu).
Test s naučenými vahami se bez jejich lokální instalace výslovně přeskočí.
Přes SSH byl ověřen skutečný průchod nainstalovanými SAM 2, SAM 3 a ViTMatte
na syntetickém obrázku, včetně GrabCutu, closed-form a dočištění barev. To ověřuje
propojení a rozměry výsledků, nikoli srovnání kvality na herních objektech.
Produkce model ani Python nepotřebuje.

**`npm run compare:matting`** reprodukuje porovnání na routeru ze zkušební lokace a
druhém kresleném objektu s tenkou čárou a otvorem. Vyžaduje instalovaný SAM 2 Large
(výše); `SAM2_CHECKPOINT`/`SAM2_CONFIG` lze předat jako proměnné shellu.
Všechny varianty používají stejnou SAM masku. Původní transparentní SVG poskytuje
známou správnou alfu; kontrolujeme konturové pásmo a složení na bílé i černé.
Výstup je v ignorovaném `.local-tools/matting-comparison/`; jiný adresář lze zadat
`npm run compare:matting -- /tmp/tukabel-matting`. Archivované
[porovnání hran](experiments/object-matting/output/comparison.png) a
[naměřené hodnoty](experiments/object-matting/output/metrics.json):

| Metoda                 | Chyba alfy na hraně: router | Druhý kreslený objekt |
| ---------------------- | --------------------------: | --------------------: |
| SAM + binární dotažení |                     0,06674 |               0,03293 |
| Closed-form            |                     0,04033 |               0,00069 |
| Samotný ViTMatte       |                     0,03713 |               0,03166 |
| ViTMatte + closed-form |                 **0,01511** |           **0,00068** |

Jde o dvě kontrolní kresby, nikoli záruku na libovolném pozadí. Samotný ViTMatte
některé obrysy příliš změkčil; kombinace je v těchto ukázkách přesnější. Chybějící
anténu nebo špatně rozpoznaný objekt matting automaticky nezachrání. Kvalitu skutečně
opraveného pozadí je stále potřeba vizuálně zkontrolovat; testy jeho placené API mockují.

V `src/assets/scene-art/<uuid>/` se archivuje normalizovaný `source.png`, opravná
`mask.png`, výsledek a případný `cutout.png`, `repair-mask.png`, `reassembled.png` a
`difference.png`. `object-mask.png` má u mattingu všech 256 hodnot a samostatný
`ownership-mask.png` označuje jeho binární podporu pro opravu pozadí.
`recipe.json` uchovává hash zdroje, nastavení segmentace/mattingu, přesah a výsledky
kontroly. Recept není další definice obsahu; vazby zapisuje projektový JSON.
Masku lze znovu importovat nad odpovídajícím původním zdrojem. Hash a rozměry se
kontrolují na serveru před publikováním. Originály se nepřepisují.

Statický výřez (`cutout` / `extract`) je **oříznutý na minimální rám všech pixelů
s nenulovou alfou**. `recipe.json` v3 a výsledek obsahují `cutoutFrame` s nativním
`x,y,width,height,sourceWidth,sourceHeight`. Editor přes `croppedPlacement` přepočítá
contain/stretch i rotaci kolem původního středu; při vložení zůstávají všechny pixely
na stejném místě. `cutout-full.png` je pouze archivní celé plátno pro diagnostiku.
PNG sekvence prostředí a postav si zachovávají společné celé plátno. Binární režim zachovává původní
RGB/alfa; v matting režimu je výstupní alfa `min(alfa zdroje, matte)` a neaplikuje se
dvakrát. Plně kryté jádro je pixelově původní. U vyhlazeného okraje neprůhledné
fotografie či kresby už původní RGB obsahuje směs s pozadím: samotné přidání alfy
vytváří barevný lem. Volitelné odstranění lemu proto deterministicky odhaduje
foreground pomocí PyMatting **jen na těchto částečných hranách**. Není to generování
nových detailů; může však změnit jejich RGB. Pro absolutní shodu všech RGB jej vypni.
U již transparentního zdroje se jeho barvy nepřepočítávají.

Oprava pozadí používá jinou masku s přesahem (výchozí 12 px), aby nezůstávaly staré
čáry. U maskované varianty mimo opravu zůstává původní pozadí. Kontrola maskovaného složení vyžaduje
`unexpectedPixels: 0`, zvlášť eviduje `cleanupPixels` v opravném okolí a `edgePixels`
na částečných hranách mattingu. Přesnou rekonstrukci těchto hran nad novým pozadím
nelze slíbit; náhled a porovnání nesmějí tvrdit opak. Starší vytvořené PNG se nemění,
oddělení je nutné z původního zdroje spustit znovu.

PNG ukládáme se straight alpha. Náhled Canvasu zachovává všechny šedé hodnoty,
export nepřidává další násobení alfy a Pixi používá své standardní premultiplied
vykreslování. Browserové testy porovnávají PNG, Canvas, SVG editor bez zapnutých
pomůcek a Pixi, včetně poloprůhledného zdroje a rotované textury s barevnými RGB pod
nulovou alfou. Pomůcky editoru záměrně přidávají barevné rámy; pro věrné porovnání je vypni.

Originály se nepřepisují. Zahazování náhledu ani Undo nemažou již vytvořené soubory,
takže nepotřebné varianty lze později odstranit v Gitu.

Pro AI nastav serverové `OPENAI_API_KEY` a volitelně `OPENAI_IMAGE_MODEL` /
`OPENAI_IMAGE_QUALITY` v ignorovaném `.env.local`, pak restartuj Vite. Výchozí adaptér v `dev/sceneArt.ts` používá
[OpenAI Images edit API](https://developers.openai.com/api/reference/resources/images/methods/edit)
a model **`gpt-image-2.5-sunburst` s kvalitou `high`**. V grafickém panelu vyber AI operaci
a nastav **AI model obrázků** / **Kvalita AI obrázku**. Pro porovnání lze přímo přepnout
na `gpt-image-1.5`; běžné kvality jsou `low`, `medium`, `high`, `auto`, Sunburst nabízí
také `xhigh` a `max`. Při přepnutí na model bez podpory vyšší kvality se výběr vrátí
na `high`. Samotné přepnutí nic negeneruje. Jiný nebo datovaný model lze nabídnout
přes serverové `OPENAI_IMAGE_MODEL`; tato volba zůstává vedle dvou základních modelů.
Obě hodnoty se zachytí při zadání úlohy a uloží do `recipe.json` i náhledu výsledku,
takže změna dalších nastavení nepřepíše údaje staršího výsledku. Výchozí nastavení:

```dotenv
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
OPENAI_IMAGE_QUALITY=high
```

Návrat pro celý editor: nastav `OPENAI_IMAGE_MODEL=gpt-image-1.5` a restartuj Vite.
Zůstává JSON požadavek na `/v1/images/edits`, PNG výstup, jedna varianta, stejné
pracovní rozměry a maska s alfou. `input_fidelity: high` se posílá pouze u
`gpt-image-1` / `gpt-image-1.5`; u Sunburst jej vynecháváme. Neposíláme zastaralý
`response_format`. Nepodporovanou kombinaci modelu a kvality server odmítne před
voláním API; při chybě nepřepíná model ani neopakuje placené volání. Výřezy,
matting, přesah opravy pozadí a kontrola původních pixelů zůstávají stejné.
API kontrakt ověřují mocky; úspěšný neplacený dotaz na model potvrzuje přístup,
nikoli vizuální kvalitu konkrétní opravy. Tu ověř až vědomě spuštěnou úpravou v editoru.

Jiný provider lze zapojit v jediné funkci `editImage`;
výběry, archivace, PNG smyčky a herní renderer na něm nezávisí. Klient dostává pouze
stav dostupnosti, ID modelu a kvalitu. Každá AI operace odešle celý zdroj a případnou masku,
provede nejvýše jedno volání a nikdy automaticky neopakuje požadavek. Mimo výběr
server vrací původní pixely; kvalitu doplněného pozadí je potřeba zkontrolovat v náhledu.
Bez klíče fungují vrstvy, import, výběry a místní efekty. Produkce neobsahuje grafické
editorové API ani AI klíč a přehrává pouze lokální PNG. Testy provider mockují.

### Úlohy a textová réžie postav

Fronta je lokální, sériová a omezená na 20 úloh; jeden náročný požadavek běží,
ostatní čekají. Čekající lze zrušit před voláním API, hotové nebo chybné odložit.
Běžící API požadavek se nechá dokončit; místního Codex agenta lze zastavit.
Přepnutí režimu ani zavření náhledu úlohu neruší.
Chyba ani výpadek spojení nikdy automaticky neopakuje placenou operaci.
Rozpracované i hotové úlohy přežijí reload stránky, **nikoli restart Vite** — jde
záměrně o frontu v paměti serveru, bez další služby nebo databáze. Před restartem
použij a ulož potřebné výsledky. Vytvořené grafické soubory a recepty zůstanou na
disku i po restartu; projektové vazby mění výhradně **Použít** a projektový save.
Obnovení stránky samo neuchovává neuložený návrh projektu, proto jej nejdřív ulož.

### Místní Codex agent: tvorba nových animačních snímků

Editor spouští skutečný **Codex CLI na tvém počítači**, s modelem
**GPT-6.1-Sol / high**. Používá uložené přihlášení z **codex login**; tento
workflow nepotřebuje OPENAI_API_KEY. Model a přihlášení vyžadují připojení ke službě
Codex. Dostupnost CLI nezaručuje oprávnění k modelu nebo volné limity účtu.

V terminálu ověř **codex --version** a **codex login status**, případně spusť
**codex login**. Vite musí mít codex ve svém PATH; jinak nastav absolutní
CODEX_BIN v ignorovaném .env.local a restartuj server. Použij aktuální CLI
s podporou exec --json, --ignore-user-config a sandboxu workspace-write.
Integrace vychází z [neinteraktivního Codex CLI](https://learn.chatgpt.com/docs/non-interactive-mode).

**Postava:**

1. V **Dev Mode → Animace** vyber postavu a rozbal
   **Codex CLI · připravit nové animační snímky**.
2. Zvol **Mrkání**, **Tvary úst pro mluvení**, obojí nebo
   **Běžné gesto postavy · náhodně**. Zadej pokyny, počet
   snímků každého klipu (5–24) a fps (1–30).
3. Klikni **Spustit místního Codex agenta**. V **Úlohy na pozadí** uvidíš průběh
   a zprávy. Můžeš pokračovat v práci, uložit projekt nebo obnovit stránku.
   **Zastavit agenta** ukončí jeho procesy; další čekající úloha pak pokračuje.
4. **Otevřít výsledek** vrátí správnou postavu. Zkontroluj jednotlivé snímky nebo
   společný Pixi náhled očí, úst a idle. **Přiřadit výsledek do návrhu** je jeden
   krok Undo; **Uložit do projektu** zapíše klipy a vazby do projektového JSON.
   Hlasy a reakce zůstávají; po výměně úst znovu přiřaď jejich mapu Rhubarb,
   protože indexy nových póz mohou mít jiný význam.

**Škrábání na hlavě a další gesta:** v úloze **Běžné gesto postavy · náhodně**
je připravený upravitelný prompt pro škrábání, 12 snímků při 10 fps. Po přiřazení
se klip nastaví jako **Náhodné gesto**; při prvním přiřazení čeká 2–5 sekund
od konce minulého přehrání. V **Přehrávání postavy → Gesto min./max. (sekundy)**
uprav četnost, prázdný výběr gesto vypne. V kombinovaném náhledu lze gesta
samostatně zapnout/vypnout. **Uložit do projektu** zapíše vazbu `gesture`
a interval `gestureIntervalMs`; existující mrkání, ústa, mapy Rhubarb a hlas
se při přiřazení gesta nemění. Stejným výběrem lze přiřadit i již importovaný klip.

Gesto je konečná akce s návratem do původní pózy, nikoli nekonečná smyčka.
Krajní snímky musí být přesně zdroj; pohyb ruky smí měnit siluetu/alfa kanál,
ale plátno, pozice hlavy a přiřazené regiony očí/úst zůstávají pevné. Tyto regiony
se předají agentovi jako chráněné a změněné pixely se při importu odmítnou.
Na původním plátně musí být dost prostoru pro končetinu; editor sám plátno
nerozšiřuje. Regionální oči a ústa se nad gestem přehrávají nezávisle.
Starší celopostavové mrkání/mluvení a ruční reakce mají před gestem přednost;
po jejich dokončení začne nová čekací doba. Během pauzy stojí i hodiny gesta.

**Mraky, voda a další oblasti:** v **Lokace → Výběr a grafika** vyber zdroj,
označ obdélník/polygon nad scénou a rozbal stejný panel Codexu. Zadej požadovanou
plynulou smyčku. Výsledek vytvoří samostatnou dekorativní animovanou vrstvu ve
stejném rámu; původní pozadí se neopravuje ani nemaže. Pro celkový přesun objektu
nejdřív použij oddělení objektu a opravu pozadí. Výběr se předává v původních
pixelech obrázku, včetně převodu contain/stretch, zoomu a rotace.

Agent dostane zdroj a zadání v dočasné pracovní složce mimo repozitář.
Spouští se bez shellové interpolace, s pevným modelem, workspace-write, bez
eskalací, síťových příkazů a dalších agentů. Uživatelský config.toml se nenačítá;
uložené přihlášení CLI zůstává dostupné. Vývojové API klíče se agentovi
nepředávají. Limit je 20 minut a žádné automatické opakování.
Produkce nemá tento panel, endpointy ani závislost na CLI.

Runner kontroluje skutečné PNG, stejné rozměry a u očí/úst alfu postavy, původní krajní
snímky mrknutí, alespoň tři odlišné fáze mrknutí / pět tvarů úst a nepřekrývající
se oblasti očí a úst. U výběru nepovolí změnu pixelů mimo polygon. Tyto kontroly
ověřují technickou konzistenci; výtvarnou kvalitu posuď v náhledu.
Chybný výstup se nepřiřadí ani částečně nepublikuje.

Hotové snímky, source.png, request.json, reprodukční skripty Python/JavaScript
a recipe.json se atomicky uloží do **src/assets/codex/UUID/**. Recept zachovává
prompt, model, otisk zdroje, výběr a výstupní manifest. Skripty se po importu
automaticky nespouštějí. Zdroj ani projektový JSON agent nepřepisuje.
Při změně zdroje nebo cílové vrstvy se staré přiřazení zablokuje; nesouvisející
úpravy scény zůstávají. Fronta je v paměti: před restartem Vite přiřaď a ulož
potřebné výsledky, soubory na disku zůstanou.

Ověřeno skutečným během CLI nad kopií woman.png: pět nových snímků mrknutí,
vizuální kontrola a kontrola rozměrů, alfy i krajních snímků. Automatické testy
používají mock agenta, dočasné projekty a žádná placená volání.

### Textová režie: nastavení již hotových klipů

V **Dev Mode → Animace** vyber postavu a rozbal **Textová režie · experiment**:

1. Zadej pokyn, např. „Občas nervózně mrkne, během dialogu mluví a jemně dýchá.“
2. Výslovně spusť **Navrhnout chování přes AI (API kredit)**. Editor posílá text,
   popisy dostupných klipů a současná nastavení; neposílá obrázek ani celé herní dialogy.
3. Později otevři výsledek ve frontě. Návrh vysvětlí změny a omezení. Náhled umožňuje
   samostatně zapínat oči, ústa a idle, přiblížit postavu nebo vyvolat mrknutí.
4. **Použít navržené chování** změní návrh postavy v jednom kroku Undo. Potom
   **Uložit do projektu** a **Otestovat odsud ↗**. Hlasy, dialogy, reakce a mapy
   Rhubarb zůstávají zachované; při změně talk klipu se stará mapa jeho snímků odpojí.

Tato první verze **konfiguruje existující klipy**, nevyrábí nové kreslené snímky.
Umí vypnutí nebo přiřazení blink/talk/idle, náhodný interval mrkání a jemné
celopostavové dýchání/pohupování. Samostatný pohyb hlavy nebo novou mimiku je třeba
nejdřív připravit/importovat. Souběžné oči a ústa musejí mít nepřekrývající se oblasti;
server i stejný validátor jako Save odmítnou nevhodné odkazy a překryvy. Změní-li se
postava nebo klipy během čekání, návrh nesmí jejich novější nastavení přepsat.

Serverový adaptér `dev/animationDirection.ts` používá
[OpenAI Responses se strukturovaným výstupem](https://developers.openai.com/api/docs/guides/structured-outputs).
Použije `OPENAI_API_KEY`, model lze změnit přes `OPENAI_ANIMATION_MODEL` v `.env.local`
(výchozí `gpt-4.1-mini`, vyžaduje Structured Outputs). Není to agent s přístupem ke
kódu ani souborům. API výstup je pouze omezený datový návrh. Bez klíče zůstává
plně dostupný import a ruční řízení animací. Testy obou AI adaptérů používají mocky;
reálnou kvalitu návrhů a obrázků je potřeba posoudit s vlastním API přístupem.

`dev/editorJobs.ts` spravuje životní cyklus, `dev/editorPlugin.ts` páruje konkrétní
runner a typ výsledku. Grafická pipeline už spojuje přípravu výběru, editaci pozadí,
výřez a atomické publikování; průběh hlásí pojmenovanými kroky. Další operaci přidej
jako konkrétní typ a runner, nikoli obecnou orchestraci agentů. React fronta pouze
sleduje výsledky a umožňuje jejich vědomé použití. Produkční build tyto moduly ani
endpointy `/__tukabel/editor/jobs` neobsahuje.

## Game Mode

Scéna využívá celý canvas se zachováním poměru stran. Přímo přes její horní část
PixiJS vykresluje inventář jako kreslenou dřevěnou přihrádkovou bedýnku, ikonku potrhaného
zápisníku a malou cedulku **Menu** (tři čárky). Seznam odhalující objekty ve scéně
se v Game Mode nenabízí. Pozadí pokračuje
pod HUD; nevzniká žádná lišta ani vyhrazený okraj. Při tvorbě lokace nech horní
část obrazu volnější. HUD zůstává uvnitř obrazu i na vysokém displeji s letterboxem;
na úzkém obrazu jsou pomocné cedulky v levém konci bedýnky. Každý předmět leží ve vlastní
zapuštěné přihrádce, vybraný předmět se v ní zlatě podsvítí. Nevyužité přihrádky zůstávají
prázdné, bez textu. Bedýnka se prodlužuje podle počtu předmětů, její kované konce se
nedeformují; sahá až k Menu. Než bedýnka začne stránkovat, přihrádky se zúží
(na 48 px, na úzkém obrazu 36 px), aby šly všechny předměty kombinovat na jedné
stránce. Teprve další předměty zobrazí šipky. Vybraný předmět zůstane vybraný i
při listování, takže jde kliknout na předmět na jiné stránce. Při tažení stačí
podržet předmět nad šipkou a stránka se po 0,6 s otočí.
Názvy se ukážou při najetí nebo zaměření klávesnicí, výběr předmětu zobrazí popis.
Viditelné dřevo a ovládací prvky blokují svět pod sebou; průhledná místa HUDu
propouštějí hover, kliky i drop do scény. Geometrie scény nezávisí na HUDu.
Titulky a dialogové volby dál vykresluje současné React UI. Nové volby plynule
najedou postupně za sebou; krátký zámek proti dvojkliku je tak skrytý v animaci.
Stejné herní okno používá i **Otestovat odsud** v Dev Mode.

- Klik/tap provede první splněné pravidlo `onClick`: komentář, sebrání, rozhovor,
  přechod nebo jiný efekt. Hráč nepřepíná slovesa. Prázdné `onClick: []` je tichý
  objekt bez vlivu na postup; Škrabanec v ukázkové místnosti to demonstruje.
- Hover zobrazí pouze název. Objekty nemají obrys ani přepínač odhalující hotspoty.
  Výchozí kreslená ruka platí v celém herním okně, včetně mapy, dialogů a menu.
  Nad aktivním předmětem ji vystřídá uchopující ruka, nad postavou animovaná pusa
  a nad přechodem šipka; oblast otevírající mapu (`openMap`) ukazuje šipku dolů. Přechody podle
  směru v obraze nastavují `cursorImage` na `cursors/exit-up.svg` nebo
  `cursors/exit-down.svg` (např. krčma → mapa, kostel → cintorín nahoru). Tichá kulisa výchozí ruku nemění. V editoru zvol typ, vlastní
  `cursorImage`, klip `cursorAnimation`, velikost 16–96 px a souřadnice špičky.
  Animované kurzory používají běžný registr klipů; bez samostatného obrázku vezmou
  zdroj klipu. Snímky a source podléhají stejné kontrole rozměrů jako postavy.
- Inventární předmět **přetáhni na druhý předmět** nebo **do scény**. Pointer
  capture podporuje myš i dotyk; vizuální náhled předmětu a cíl potvrzují drop.
  Neplatný/cancelovaný drop nic nespotřebuje. Inventář má vlastní `item.image`
  (**Inventární ikonka**); nemusí odpovídat obrázku hotspotu. Nový předmět krátce
  povyroste, zprůhlední a přeletí do kapsy. Načtení uložené hry tento efekt nespouští.
- Alternativa bez tažení: klikni/tapni na předmět a následně na cíl. Výběr zároveň
  zobrazí jeho popis. Tab/Enter používá neviditelnou sémantickou HTML vrstvu
  pro klávesnici a čtečky; zaměřené tlačítko zvýrazní Pixi. Tato vrstva nezachytává
  myš ani dotyk a žádný HUD nevykresluje. Interaktivní oblasti scény mají stejnou
  neviditelnou klávesnicovou alternativu; Tab ukáže název aktuálního cíle a Enter
  či mezerník jej použije. Tiché kulisy do pořadí Tab nepatří. Kliknutí ani focus
  nekreslí žluté rámečky; zaměřenou ikonku Pixi pouze jemně zesvětlí.
- Reakce se zobrazují v kreslené bublině; prázdný komentář žádnou bublinu nevytvoří.
  Kliknutí na postavu otevře pouze dostupná témata na křivých dřevěných cedulích.
  Výběr tématu přehraje repliku cílového uzlu; během ní nejsou vidět žádné volby.
  Ve scéně zůstávají postava a titulky. Kliknutí/tapnutí kamkoli do titulkové
  plochy okamžitě dokončí repliku a zastaví dabing i ústa; fungují také Enter a
  mezerník. Po dohrání nebo přeskočení se vrátí volby; bez audia text čeká na
  stejné potvrzení titulkové plochy. Jednořádkové ukázky bez další větve začínají volbou **Porozprávať sa.**
  Portréty se ve hře ani editoru nenabízejí; starší `portrait` JSON zůstává čitelný.
  Herní menu používá stejné oprýskané cedule.
- **Denník** otevře starý zápisník s úkoly. Splněné položky se automaticky přeškrtnou;
  číslo u ikonky ukazuje počet aktivních úkolů. Otevřený zápisník pozastaví řeč
  i lip-sync a blokuje herní akce; zavři jej křížkem, Escape nebo klikem mimo papír.
  Dlouhý seznam lze posouvat šipkami přímo na stránce, také na telefonu.
  Myš, tapnutí i klávesnice fungují také bezprostředně po přetažení předmětu.
- Escape ruší výběr/tah nebo zavírá menu / deník. Rozhovor ukončuje jeho autorská volba
  bez `next`; Escape jej nezavírá. Dialog blokuje akce světa.
  Efekty a animace respektují reduced motion; drag/drop zůstává funkční.
- **Menu** obsahuje ruční **Uložit hru**, **Načíst hru** a **Nová hra**. Postup
  zůstává v jednom verzovaném localStorage slotu daného originu, oddělený od obsahu.
  Načítá se až na požádání a obnovuje nabídku aktuálního dialogového uzlu. Nová hra slot nemaže.
  Poškozené, nekompatibilní či nedostupné úložiště nepřepíše aktuální postup.

Aktuální příběh (`tukabel-potato-prize-3`) začíná automatickým rozhovorem
s Ferem na **Ferovom dvore**. Rudo bere pátrání po ukradeném hlavním kabelu za
štartovné zdarma na zrušeném mistrovství v automatech. Hra má 12 zachovaných
lokací, 13 postav, 26 předmětů, jedenáct úkolů v deníku a dva fyzicky odlišné konce.
Nová hra nejdřív přehraje cutscénu **výpadku proudu v celé osadě**
(`openingCutscene: "blackout"`, `src/ui/BlackoutCutscene.tsx`): osvětlené a tmavé
noční pozadí z `src/assets/cutscenes/blackout/`, čtvrti postupně zhasínají podle
zvuku vypínače a elektřiny, pak zazní Rudova hláška. Tlačítko **Preskočiť** ji
kdykoli ukončí; při zablokovaném zvuku nabídne **Spustiť úvod**. Chybějící zvuk
úvod nezablokuje. Po cutscéně hra jednu sekundu nepřijímá vstup a teprve potom
zobrazí titulky a spustí hotový Ferův dabing s lip-syncem. Totéž platí
pro **Nová hra**; načtení uložené pozice úvod neopakuje. Stav úvodu není součástí save.
Když prohlížeč zablokuje automatický zvuk, titulková plocha nabídne **Spustiť
dabing**: první klik/tap/Enter přehraje repliku a nepřeskočí ji. Další potvrzení
už řeč běžně dokončí. Pokud zvuk selže i po tomto gestu, lze pokračovat titulky.
Nové ID obsahu odmítne starší uložené pozice s nekompatibilním stavem hádanek;
ruční slot samo nemaže ani nepřepisuje.

Scénář je dospělá morbidní groteska: Bonifác vysvěcuje výhernost automatů,
Milan zkouší zákazníkům vlastní pohřby, Jolanda vede kult pojištěného vemena a
Rudo považuje odpojení mínusu za odstranění špatné elektřiny. **Eržika** nahradila
Margitu. Nemá dialogový strom: pět samostatných krátkých nadávek se střídá při
opakovaných kliknutích, bez volby odpovědi. Pořadí drží běžné uložené příznaky.
Kolíček je samostatný předmět na dvoře; izolačka leží pod žebříkem
v uličce. Rohlík a hádanka s rozhýbáváním houpačky jsou odstraněné. Kliknutí na
koš na zastávce jednou vydá nůžky s Rudovou hláškou; další kliknutí ani reload
nepřidají druhý pár. Vedle odpadků v uličce sebereš také hrdzavý šrot, který Dežo na zastávce
vymění za magnet. Láhev, svätenú vodu ani bramboru nebere. Prázdná láhev zůstává
pro vodu, mléko a kávu. Dežo se bez ostychu živí
kradením kovů a jejich odnášením Dingovi do zberne.

Současná mapa má zachovaných **sedm polygonů**: Ferov dvor, Zastávka, Kostol,
Detské ihrisko, Krčma, Zberňa a Kravín. Krčma se odemkne přijetím případu,
zberňu prozradí Dežo a kravín Etela. **Ulička** zůstává přístupná přechodem z
Ferova dvora. Další propojení jsou **Kostol → Cintorín → Kaplnka → Krypta**
a **Krčma → Herňa**, vždy i s návratem. Mapa používá původní spodní hotspoty,
bez zkratky M; během dialogu svět nereaguje. Ovládání myší, dotykem
i klávesnicí zůstává zachované.

Hádanky používají původní pravidla, inventář, kombinace, podmínky a efekty.
Hráč upravuje rekvizity, spouští je a vyzvedává výsledek; na hřišti vyhraje
existující minihru Šuter k čiare. Po návratu klikne na Špľucha a jednou získá
medaili **Brambora na špagátu**. Nůžky + medaile spotřebují medaili, přidají
provázek a bramboru; nůžky zůstávají. Opakovaná výhra ani další rozhovor
neobnoví již převzatou nebo rozstřiženou medaili.
Původní pozadí, postavy, jejich transformace, animace a hlasová přiřazení zůstaly.
Nové rekvizity vykresluje explicitní `hotspot.placeholder: true` jako popsaný
obdélník. Po přiřazení obrázku obdélník automaticky zmizí; běžné neviditelné
hotspoty žádné obrysy ani zástupnou grafiku nedostávají.

Dialogy rozlišují získané informace od domněnek. Dežovo téma ceny magnetu se
objeví až po odpovědi na otázku, čím zkouší železo. Niky se Rudo ptá na využití brambory
až s bramborou v inventáři; Ľuba vyzve k sázce až s podvodným žetonem. Další
šetření začíná obecnými otázkami. Pohřebák s kabelem, podpis po pohřbu a půjčená
baterie jsou stopy, nikoli předčasné potvrzení pachatele; živého Ľuba potvrdí
teprve vstup do krypty. Deník zapisuje jen zjištěné dohody a pozorování.
Znalostní příznaky se ukládají běžným save systémem. Intuitivní použití předmětu
nevyžaduje předchozí vyslechnutí nápovědy, takže nové otázky nepřidávají záseky.

Herní komentář obsahuje pouze Rudovy vlastní myšlenky a pozorování. Odmítnutí
předmětů i připomínky u zamčených vstupů říkají NPC přes krátké `entry: "speech"`
dialogy s přiřazeným `actor`; během titulku zůstává svět zablokovaný a potvrzení
jej zase uvolní. Nové a přepracované repliky jsou **pouze s titulky**: staré
vazby `speech` se od změněného textu odpojily, audio soubory i zvolené hlasy
zůstaly zachované. Tato revize nevolá ElevenLabs ani jinou generaci dabingu.

### Kompletní průchod (spoilery)

Větve lze řešit v jiném pořadí. Nesprávné kombinace neodebírají zásadní
předměty. Předmět po posledním skutečném použití z inventáře zmizí (nůžky, pečiatka,
servisní deník, magnet na špagáte, klíč s rukavicemi po sebrání kabelu); francouzský
klíč do té doby zůstává i pro odpojení a opětovné připojení baterie.

| Hádanka              | Řešení a podmínka                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Přijetí případu      | Potvrď Ferovu repliku a přijmi případ. Na dvoře seber dřevěný kolíček. Přejdi do uličky a seber izolační pásku a rezavý šrot. Rohlík už v obsahu není.                                                                                                                                                                                                                                                                                                                              |
| Dežův magnet         | Dežo mění magnet za rezavý šrot z uličky; výměna spotřebuje šrot a odemkne sběrnu. Láhev ze zastávky si nech na vodu a mléko. Klikni také na koš: jednou získáš nůžky. Etely se zeptej na další obecní záležitosti, čímž odemkne kravín.                                                                                                                                                                                                                                            |
| Kraví bohoslužba     | Jolanda vysvětlí odměnu za krst a nutnost krávu uspat. U kostela seber prázdny úmrtný list a naplň láhev u pumpy. Svätenú vodu použij **na kravu**, ne na Jolandu: prázdná láhev se vrátí. Krávě přečti úmrtní list; úřední nuda ji uspí a papír zůstane. Spící kráva má trvale zavřené oči (vrstva `cow-sleeping` se snímkem z mrkání) a nemrká ani po návratu či načtení hry. Pak seber zvonec z obojku a prázdnou lahví naber mléko z vedra. I zbytečný další křest vrátí láhev. |
| Dingův vnitřní budík | Dingo nebo nápis na resuscitátoru vysvětlí náplň i pedál. Karol v krčmě dá mletou kávu. Mléko + káva vytvoří studené kravučíno. Nalij je do kávového klystíru v zberni; láhev už nepotřebuješ. **Klikni na jeho pedál.** Dingo ožije a ze samostatné truhlice můžeš vzít klíč a rukavice. Magnet lze získat i teprve nyní.                                                                                                                                                          |
| Zatuchlá herna       | Klíčem oprav pípu a kliknutím na pivní sklenice vypusť starou pěnu. Karol otevře hernu. Teprve uvnitř seber zlatý obal od čokolády ze země u automatu; v hospodě už neleží. Klíčem otevři servisní kryt a vyzvedni deník s reklamací po Ľubově pohřbu.                                                                                                                                                                                                                              |
| Brambora na špagátu  | Na hřišti promluv se Špľuchem o výhře a přes „Čiara v hline“ vyhraj Šuter k čiare. Po návratu klikni na Špľucha a převezmi medaili. Zkombinuj ji s nůžkami z koše: získáš provázek a plochou vysušenou bramboru. Medaile i nůžky zmizí. Nika s bramborou v inventáři vysvětlí falešný žeton.                                                                                                                                                                                        |
| Falešný jackpot      | Založ kravský zvonec do ručního automatu na odpustky vedle kostela. **Klikni na kliku**: mechanické cinkání odláká tajného gamblera Bonifáce a otevře bránu hřbitova. Žádný elektrický přístroj při tom neběží.                                                                                                                                                                                                                                                                     |
| Vlastní pohřeb       | Milan nebo ceník rakve vysvětlí, proč do kaplnky smí jen klient po pohřbu. Servisní deník ukaž Etele a získanou pečiatku zkombinuj s úmrtním listem. Opečiatkovaný list připevni **na zkušební rakev** na hřbitově. Na rakev použij i kolíček, kterým si Rudo zaštipne nos. **Klikni na rakev**: Milan uzná pohřeb a otevře kaplnku. List a kolíček lze připevnit v libovolném pořadí.                                                                                              |
| Klíč od krypty       | Magnet + špagát vytvoří magnet na špagáte. V kaplnce jím vylov klíč pod mříží. Klíčem odemkni kryptu a dokonči Ľubovu úvodní repliku.                                                                                                                                                                                                                                                                                                                                               |
| Odhalení a volba     | Ľubo fingoval smrt kvůli dluhům a ukradl hlavní kabel pro soukromý automat na Dingově autobaterii. Před definitivní volbou ručně ulož hru, pokud chceš projít oba konce bez opakování pátrání.                                                                                                                                                                                                                                                                                      |

**Obnovení proudu:** Francouzským klíčem odpoj na autobaterii mínusovou svorku;
automat zhasne. Teprve potom rukavicemi seber kabel; pod proudem jej Rudo
odmítne vzít (kliknutí ani rukavice nic nespotřebují). Do sebrání kabelu jde
svorka klíčem zase připojit. Sebrání kabelu znamená definitivní volbu návratu proudu. Kábel + izolačka vytvoří
opravený kabel. Vrať se k Ferovi a použij jej na rozvodnú skriňu. Rozsvítí se dvůr,
objeví se turnajový transparent, Fero pronese závěrečnou repliku a následuje epilog.

**Jackpot:** Bramboru odstřiženou z výherní medaile obal zlatou fólií z herny.
Podvodný žetón použij v kryptě na automat, dokud je baterie připojená. Zkrat spálí
automat i kabel, Ľubo pronese závěrečnou repliku a následuje druhý epilog.
Na odpojený automat ani po sebrání kabelu se žeton nespotřebuje. Dřívější
pozice se sebraným kabelem bez příznaku `battery-isolated` zůstávají platné.
Uloženou pozici před volbou lze načíst i po konci; nová hra ruční slot nemaže.
Po vložení falešného žetonu nejdřív promluví Ľubo; po vrácení opraveného
kabelu do rozvodné skříně promluví Fero. Obě reakce jsou jednorázové dialogy
`entry: "speech"` bez odpovědí (`lubo-ending`, `fero-ending`). Kliknutí/tapnutí
na titulek, Enter/mezerník nebo konec platného audia repliku dokončí a teprve
potom otevře připravenou finální obrazovku. Nové repliky jsou zatím textové;
hlas a mapa úst zůstávají přiřazené původním postavám. Ľubo zůstává během své
reakce ve scéně i po zkratu. Výsledné příznaky a spotřebování předmětu se
provedou jednou v původní akci. Uložení během repliky zachová čekající dialog;
starší dokončené pozice bez dialogu zobrazí finále rovnou.

Konec obrazovku pomalu zčerná, zobrazí nápis **KONIEC** a pod ním krátký epilog
z `endings[].text`; `title` slouží jako přístupný název dialogu.

### Chybějící grafika

**4 scénické rekvizity a 1 inventární ikonka.** Všechny scénické zástupné
obdélníky už mají funkční pravidla, potřebnou viditelnost a správné cílení.
Souřadnice níže jsou původní pixely lokace: `x, y · šířka×výška`, bez škálování
na okno. V Dev Mode vyber uvedené ID a přiřaď mu lokální obrázek; ID, rám,
pravidla a podmínky zachovej. Checkbox **Zástupná grafika** může zůstat zapnutý,
protože obrázek má při vykreslení přednost. Pro výřezy použij transparentní PNG/WebP.

| Lokace             | Předmět / hotspot                           | Umístění              | Účel                                                    | Doporučený vzhled                                                                                      |
| ------------------ | ------------------------------------------- | --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Kravín (`scene10`) | Vedro na posvätné mlieko (`milking-bucket`) | `1050, 660 · 180×120` | Po uspání krávy dovolí nabrat mléko do láhve.           | Promáčklé plechové vědro pod vemenem, po dojení malé množství mléka; bez elektrického stroje.          |
| Kravín (`scene10`) | Zvonec na obojku (`cow-bell-hook`)          | `1080, 350 · 120×95`  | Odpojení zvonce od spící krávy.                         | Velký odřený mosazný kravský zvonec na rozepínací kožené přezce.                                       |
| Zberňa (`scene9`)  | Kávový klystír na pedál (`resuscitator`)    | `880, 540 · 200×160`  | Lievik přijme kávu; klik na pedál probudí Dinga.        | Rezavá ruční nožní pumpa, trychtýř, gumová hadice za křeslo; směšná domácí resuscitace bez proudu.     |
| Zberňa (`scene9`)  | Dingova truhlica s náradím (`tool-chest`)   | `1110, 650 · 210×130` | Po probuzení Dinga vydá klíč a rukavice.                | Otevřená rezavá skříňka s francouzským klíčem a gumovými rukavicemi; druhá prázdná varianta volitelná. |
| Inventář           | Drevený kolíček (`clothespin`)              | —                     | Rozlišení nosního kolíčku v inventáři; zatím znak `II`. | Jediný starý dřevěný kolíček, průhledné pozadí, stejná kresba jako scénická verze.                     |

Kolíček na dvoře, izolačka a šrot v uličce, zlatý obal v herně, ruční automat
a zkušební rakev už v aktuálním návrhu používají vlastní obrázkové vrstvy.
Nůžky, brambora na provázku, oddělená brambora a nový falešný žeton mají místní
SVG ikony v `src/assets/story/`; hřiště zachovává původní pozadí a postavy.
Jejich ID i umístění zůstávají podle návrhu v `project.json`; průchodové testy
rekvizity dohledají podle herního efektu, takže jejich nahrazení grafikou
nevyžaduje návrat ke starým testovacím názvům vrstev.

### Dabing tohoto scénáře

Dávka 30. 10. 2026 (`d6fddbba-…`) doplnila dabing po přepisu příběhu: **všech
75 hraných replik** má aktuální WAV, titulky a Rhubarb lip-sync. Nově vzniklo
67 TTS; osm replik, jejichž audio stále odpovídalo textu, zůstalo beze změny
(dostaly jen nový lip-sync). Osm stálých hlasů se nezměnilo. Pět rotačních
postav (Eržika, Karol, Špľuch, Nika, Béla) dostalo nový Voice Design, namluvilo
všechny své repliky a slot se po uložení uvolnil.

Dětský Voice Design s přirozeným věkem ElevenLabs dříve odmítl (HTTP 403).
Děti proto mají **stylizované dospělé kreslené hlasy**: přehnaně vysoký,
skřehotavý nebo nosový projev ve stylu dospělých animovaných komedií, ale se
srozumitelnou slovenštinou. Zadání jsou v `voice.designPrompt`. Model
`eleven_v4` pro slovenštinu většinou nevrací znakové zarovnání, takže titulky
mají označený odhad časování; tvary úst vychází ze skutečné Rhubarb analýzy.

Hlášky dětí v minihře Šuter k čiare (32 replik) se namlouvaly stejnými hlasy
před uvolněním slotu. Leží v `src/assets/minigames/suter-k-ciare/voice/`
s `manifest.json` (text, hlas, délka, SHA-256). Postavy v minihře nejsou
kreslené, takže lip-sync nepotřebují. Změněný text v `lines.ts` se nepřehraje
a použije původní syntetické „blábolení“; nová nahrávka vyžaduje obnovit
rotační hlas dítěte.

[Archiv předchozího castingu](src/assets/speech/2b9d5934-d303-40ef-b875-59c2c46dbc00/casting.json)
a [historická poslechová stránka](src/assets/speech/2b9d5934-d303-40ef-b875-59c2c46dbc00/listen.html)
uchovávají původní prompty, 39 návrhů a 45 starších nahrávek; nejsou seznamem
aktuálně namluvených replik tohoto nového scénáře. Hraní nepotřebuje API token.

Pozadí a atmosféry zůstaly lokální. Zberňa a kravín mají zhasnuté žárovky;
ruční klystír, odpustkový automat, pípa a houpačka nepotřebují proud.
V kryptě napájí světelný automat jediná autobaterie, jejíž odpojení neón zastaví.
Svíčky a petrolejka fungují bez sítě. Místní ruchy se zapnou až po gestu hráče,
menu i skrytá stránka je pozastaví.

Původní technická hádanka a staré zastávkové dialogy zůstávají pouze v
`tests/fixtures/demo-project.json` a `tests/fixtures/stop-demo-project.json`.

## Hudba a zvukové efekty

Soundtrack v `src/assets/soundtrack/elevenlabs-village-20261029/` obsahuje
**7 instrumentálních motivů a 8 krátkých efektů**, každý z jediné generace
ElevenLabs. Hudba kombinuje housle, akustickou kytaru, akordeon a kontrabas,
balkánské perkuse, jemný hip-hopový groove a malé přehnané dechové odpovědi.
Společná tónina a motiv propojují lokace; nejde o hudbu z rádia ani o důkaz
obnoveného proudu. Tiché elektrické přístroje v osadě zůstávají vypnuté.

| Motiv              | Lokace                       | Charakter                                                     |
| ------------------ | ---------------------------- | ------------------------------------------------------------- |
| `music-village`    | Ferov dvor, Zastávka, Ulička | Hravý vesnický folk-hip-hop, housle a akordeon.               |
| `music-sacred`     | Kostol, Cintorín, Kaplnka    | Groteskní pohřební pochod, pizzicato a tiché dechy.           |
| `music-tavern`     | Krčma, Herňa                 | Přiopilé akustické šourání a krátké houslové odpovědi.        |
| `music-playground` | Detské ihrisko               | Škodolibé smyčce, dřevěné perkuse a přestávky.                |
| `music-scrapyard`  | Zberňa                       | Rezavé kovové perkuse a pomalejší pocit nad společným pulsem. |
| `music-barn`       | Kravín                       | Rustikální akordeonový tanec s malou tubou.                   |
| `music-crypt`      | Krypta                       | Nižší akordeon, smyčcové napětí a podzemní hráčská groteska.  |

Zdrojové generace mají 24 sekund. Finální PCM WAV smyčky obsahují 16 sekund
(osm taktů při nominálních 120 BPM), výřez ze stabilní části a 180ms překryv
na spoji. Zůstávají stereo, 44,1 kHz / 16 bitů; hlasitost hudby je přibližně
−18 dB RMS a špičky nejvýše −3 dBFS. Efekty mají 0,8–2,8 s, krátký náběh/dozvuk
a omezené špičky. `provider/` uchovává původní MP3, jednotlivé JSON záznamy
prompty, modely, úpravy a SHA-256; `manifest.json` spojuje všechny výsledky.
Přímý poslechový přehrávač je v `listen.html` ve stejném adresáři
(při Vite například `/src/assets/soundtrack/elevenlabs-village-20261029/listen.html`).

Hudbu určuje `scene.music` / `ending.music`, ruchy prostředí dále `ambient`.
`MusicLoop` používá WebAudio bufferové smyčky bez dekódovací mezery, sekundový
crossfade a nejvýše dva hudební zdroje. Sdílená skladba při změně scény pokračuje
ze stejného místa; mapa hudbu nepřeruší. Hudba má gain 0,20, prostředí 0,12,
během dialogu obě vrstvy klesnou na čtvrtinu. Dabing zůstává samostatný.
Menu, deník, skrytí stránky a vypnutí zvuku přehrávání pozastaví. Ovládání
**Zvuk prostredia** zahrnuje hudbu, prostředí i efekty; dabing nemění.

Osm efektů pokrývá ruční nářadí, dveře/rakev, nalévání, Dingovu pumpu,
mechanický zvonek, houpačku, razítko a závěrečný jackpot se zkratem.
Jsou přiřazené osmnácti konkrétním úspěšným větvím jako `Rule.sound`.
`getActionSound` čte první platné pravidlo dané akce; nevytváří žádný
zvukový stav v save a při načtení nic neopakuje. Autorský efekt nahrazuje
obecný pickup/combine/travel. Gain efektů je 0,35, současně hrají nejvýše dva;
250ms cooldown stejného zvuku tlumí opakované vstupy. Před kryptou se používají
výhradně ruční mechanismy, žádný elektrický jackpot.

Generace použily [Eleven Music API](https://elevenlabs.io/docs/api-reference/music/compose)
(`music_v2_5`, `force_instrumental`) a [Sound Effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
(`eleven_text_to_sound_v2`). Hra potřebuje jen místní soubory; žádný API klíč
ani generování neběží v klientovi. Stávající dialogy, hlasy a jejich audio soubory
zůstaly zachované.

## Obsah a architektura

- `src/game/content/project.json` — **jediný zdroj autorského obsahu**: lokace,
  objekty, předměty, dialogy, příznaky, kombinace, animace a mapu lokací. Jeden soubor zjednodušuje atomický
  zápis a kontrolu konfliktů; nevznikají rozporné částečné zápisy několika souborů.
- `src/game/content/index.ts` — validované načtení JSON.
- `src/game/assets.ts` — mapa stabilních ID assetů na Vite URL pro runtime.
- `src/game/types.ts` — smlouva obsahu, podmínek, efektů, příkazů a hráčského stavu.
- `src/game/validateProject.ts` — runtime kontrola struktury JSON a lokálních assetů.
- `src/game/validateContent.ts` — ID, odkazy, rozměry, pořadí pravidel, duplicity.
- `src/game/state.ts` — původní čistý reducer; stejná pravidla v náhledu i produkci.
- `src/game/storage.ts` — save/load postupu; nikdy neukládá definice obsahu.
- Volitelné `startDialogue` spouští autorský úvod, `openingCutscene: "blackout"` mu
  předřadí vestavěnou cutscénu (validace vyžaduje `startDialogue`); `endings` odvozuje epilogy přes
  stejné podmínky z uložených flags. Žádný druhý ending/progress stav.
- `SceneDefinition.ambient` / `music`, `Rule.sound`, `src/game/actionSound.ts`,
  `src/ui/useSceneAudio.ts` a `musicLoop.ts` — místní prostředí, hudba s crossfadem,
  mix a efekty vybraných pravidel. `EndingPanel.tsx` zobrazuje finální modal.
  API ani dabingové kredity se za hry nevolají.
- `src/game/createScene.ts` — Pixi pozadí, sprity, hotspoty a stavové indikátory.
- `src/game/characterVisual.ts` — skládání lokálních animačních oblastí bez změny
  zarovnání nebo násobení průhlednosti; `animation.ts` řídí nezávislé hodiny.
- `src/game/transforms.ts` — společné proporce, natočení a geometrie rámů.
- `src/game/hitTest.ts`, `alphaMasks.ts`, `polygon.ts` — společné cílení alfa masek
  a polygonů, cache pixelů a kontrola geometrie pro Pixi, dropy a SVG editor.
- `src/editor/polygonTools.ts`, `PolygonHandles.tsx` — úpravy geometrie a úchyty vrcholů.
- `src/game/animation.ts` — vizuální hodiny, náhodné mrkání a priorita klipů.
- `src/game/createHud.ts`, `hudLayout.ts` — Pixi HUD, inventář, deník, mapu a vizuální efekty;
  společný viewport scény a cílení předmětů bez změny autorských souřadnic.
- `src/assets/hud/`, `src/game/hudArt.ts` — místní kreslené SVG bedýnky inventáře a přihrádky, obálky,
  otevřeného zápisníku a cedulek; měnitelné bez externí služby.
- `src/ui/` — herní stav/UI, životní cyklus canvasu, dialogové překryvy a pointer capture;
  `HudAccessibility.tsx` přidává pouze sémantiku a klávesnici k Pixi ovládání.
- `src/minigames/` — samostatné minihry (React overlay + vlastní Pixi canvas);
  `src/assets/minigames/` jejich grafika. Viz [Minihry](#minihry).
- `src/editor/` — pouze vývojový editor, SVG autorování oblastí, formuláře a graf.
  `SceneImage.tsx` používá stejnou geometrii jako Pixi; `transformTools.ts` počítá
  proporcionální tahy a limity scény. Zoom, pomůcky a rozpracovaný tah jsou jen UI stav.
- `src/editor/WorldMapPanel.tsx` — obrázek mapy, body, cílové lokace a podmínky odemčení.
- `dev/editorPlugin.ts` — lokální Vite middleware pro načtení/zápis a import assetů.
- `src/editor/MaskEditor.tsx`, `ExtractionComparison.tsx` — štětcové masky a kontrola složení.
- `dev/artSource.ts`, `objectMask.ts`, `segmentation.ts` — bezpečný rastrový zdroj,
  validace masek a lokální OpenCV / SAM 2 / ViTMatte + PyMatting. `sceneArt.ts` publikuje původní
  výřez, samostatnou opravu pozadí a pixelovou kontrolu.
- `dev/animationImport.ts` — lokální import PNG sekvencí a atlasů přes Sharp, obnova
  plátna oříznutých snímků, atomický zápis a kontrola rozměrů. Bez runtime závislosti.
- `dev/speech.ts` — ElevenLabs Voice Design/TTS, WAV import, Rhubarb a validace archivů.
- `dev/speechBatchPlan.ts`, `dev/speechBatch.ts`, `scripts/regenerate-speech.mjs` — náhled, dávkové přegenerování, všechny lip-sync a obnovitelné checkpointy.
- `dev/voiceRotation.ts` — ověření úplného dabingu a bezpečné uvolnění rotačního hlasu.
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
`dialogues`, `combinations` a volitelné `animations` / `tasks`. Nový obsah lze vytvořit editorem nebo přímo úpravou
JSON; žádné callbacky ani kód do obsahu nepatří. Texty pro hráče jsou slovensky,
ID a kód anglicky. Definice se nemutují. Stav hráče obsahuje jen ID lokace, inventář,
boolean příznaky, aktivní dialogový uzel, stavy úkolů a poslední zprávu. Výběry UI se neukládají.

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
V inspektoru **Klikatelná oblast** přepíná automatickou masku a ruční obdélník:
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
a hotspoty mimo scénu. Vrstvy rozšiřují stejné pole `hotspots`: pořadí pole je pořadí kreslení, `decorative` vypíná herní interakce, `hidden` skrývá, `locked` chrání editor a `opacity` nastavuje krytí. `backgroundHidden` skryje základní pozadí. Řešitelnost se ověřuje průchodem. Při nekompatibilní změně
obsahu změň `id` projektu; strukturu uložených pozic verzuj v `storage.ts`.
Starší nekompatibilní pozice se odmítají, migrace zatím nejsou implementované.

Migrace ovládání: `defaultVerb` a slovník `actions` byly nahrazeny `onClick`.
Projektové příklady jsou převedené; staré vlastní JSON převeď výběrem původních
pravidel výchozího slovesa do `onClick`. `uses` i podmínky a efekty se nemění.
Animační vazby dřívějšího `onInteract` převeď na `onClick` / `onUse`.
Uložený hráčský postup zůstává kompatibilní, protože ID a herní příznaky se nemění.

## Interaktivní mapa lokací

Mapa se kreslí v Pixi uvnitř stejného herního okna. Otevírá ji běžný hotspot
scény s `openMap: true`; jeho polygon, viditelnost i kurzor upravíš stejnými nástroji
jako přechod mezi scénami. V **Dev Mode → Lokace** nakresli polygon u spodního okraje
a v inspektoru zapni **Otevřít mapu lokací**. Ikonka mapy se ukáže při najetí dovnitř,
na dotyku zůstává viditelná. Kliknutí/tapnutí otevře mapu; klávesnicí lze vstup
zaměřit Tabem a aktivovat Enterem či mezerníkem. Klávesa M nemá mapovou zkratku. **Escape** nebo křížek
mapu zavře. Při otevření se inventář, celý herní HUD a reakce skryjí; scéna
nepřijímá vstup. Mapa má vlastní focus trap a neviditelnou HTML sémantiku.
Během rozhovoru se mapa neotevírá.

V **Dev Mode → Mapa lokací** vyber nebo importuj obrázek a cílovou lokaci,
potom použij **Nakreslit polygon**. Jde o stejný `EditorStage` jako u scény:
Enter/první vrchol/tlačítko uzavře obrys, úchyty upraví jednotlivé vrcholy,
hrany přidají vrchol a šipky poskytují klávesnicovou alternativu. Posun/resize
je jeden undo krok; Escape/pointercancel jej vrátí. Změna obrázku/rozměrů
proporcionálně přepočítá celé polygony. Save používá společný projektový JSON,
revize a atomický zápis. Klikací plocha ve hře odpovídá skutečnému konkávnímu
polygonu, nikoli jeho obdélníkovému rámu. Polygony a jejich názvy se ve hře trvale
nekreslí; při najetí nebo klávesnicovém focusu na dostupnou lokaci se nad oblastí
ukáže dřevěná cedulka se jménem a jemnou zlatou září (sdílený asset
`hud/wood-tag.svg`). Zbytek obrázku mapy plynule během 180 ms ztmavne do černé
na 60 %; kolem světlého polygonu je měkký 6px přechod, který opticky zjemní
rohy. Klikací geometrie zůstává přesná, obrázek ani cedulka se nerozostřují.
Po opuštění se mapa stejným
přechodem obnoví. Cedulka i ztmavení propouštějí vstup; při omezení pohybu se
konečný stav nastaví okamžitě. Na dotyku se
cedulka ukáže při stisku; tapnutí dál cestuje přímo. Cedulka neblokuje klikání do
mapy. Zamčené lokace a místa pouze pro běžný přechod cedulku nezobrazují.
Otevřená mapa obsahuje jen obrázek, případnou cedulku a tlačítko zavření.

Volitelné `worldMap` v `src/game/content/project.json` obsahuje `image`, `width`,
`height` a `points`. Oblast má stabilní `id`, slovenský `label`, `sceneId`,
`polygon` (3–128 různých vrcholů bez křížení v souřadnicích mapy), `x`, `y`,
volitelné `unlockWhen` a `fastTravel`. `x/y` jsou původní kotva; starší mapy bez
polygonu zůstávají čitelné a používají malou obdélníkovou oblast kolem této kotvy.
Editor ukládá nové a upravené oblasti s polygonem. Jedna cílová lokace má nejvýše
jednu oblast. Bez podmínky se místo odemkne první návštěvou nebo explicitním efektem
`unlockScene`. `{ "all": [] }` jej odemkne na začátku; jiné podmínky používají společná
pravidla příznaků/předmětů. Odemčení je trvalé i po zániku podmínky.
`fastTravel: false` zakáže cestování z mapy i po odemčení; běžné přechody `scene`
tím nejsou omezené. Mapa logiky ukazuje podmínky odemčení i efekty.

`GameState.unlockedScenes` se nadále ukládá v save v1. Starší pozice bez tohoto
pole zůstávají čitelné: dopočítá se startovní/aktuální scéna a jen odemčení
doložitelné současnými podmínkami. Neznámá a duplicitní ID se odmítají.
Otevření mapy ani focus nepatří do save. Reducer kontroluje odemčení i zákaz
mapové cesty nezávisle na UI. Aktuální mapa obsahuje osm venkovních lokací;
postupně je odemyká přijetí případu a informace o zberni a kravínu. Herňa,
cintorín, kaplnka a krypta zůstávají dostupné pouze autorskými přechody.

## Minihry

Efekt `{ "type": "minigame", "id": "suter-k-ciare" }` spustí minihru přes celé
herní okno včetně HUD. Definice v `project.json` (`minigames`) určuje příznak,
který výhra trvale nastaví (`winFlag`), a volitelné reakce `winMessage` /
`loseMessage` zobrazené po návratu do lokace. Pozdější prohra příznak nesmaže.
Běžící minihra blokuje akce světa i cestování stejně jako dialog; do save se
neukládá a po načtení se hráč vrátí do lokace. Validátor zná pouze minihry
implementované v `MINIGAME_IDS` (`types.ts`) a kontroluje registrovaný příznak.

**Šuter k čiare** (`src/minigames/suter-k-ciare/`) se spouští hotspotem
„Čiara v hline“ (`stone-line`) na vyrytém kruhu v Detskom ihrisku. Hráč a
Špľuch hází po třech kamenech co nejblíž k čáře bez přehození; ovládání tahem
dozadu jako prak (myš i dotyk), deterministická fyzika, partie asi 45 s.
Klávesnicí mění šipky nahoru/dolů úhel a vlevo/vpravo sílu; Shift zrychlí
změnu, Enter nebo mezerník odhodí kámen. Opakovaný stisk držené klávesy
neodhodí další kámen. Herní plocha dostane focus a Pixi kreslí stejné míření.
Výhra nastaví `stone-game-won`; po návratu Špľuch při kliknutí jednou předá
medaili „Brambora na špagátu“. Prohra ani opakování partie tuto odměnu
nevydají znovu. Nůžkami z koše se medaile rozdělí na provázek a bramboru.
Postavy nejsou kreslené, Nika a Béla jen
komentují v reakčním lístku; všechny hlášky mají dabing (`voice.ts`), přehrávaný
jeden po druhém a pozastavený při skryté stránce. Hostitelský element nese `data-phase`
(`aim | busy | done`) pro testy. Pravidla a fyziku ověřuje
`tests/minigame-rules.spec.ts`, celý průchod `tests/minigame.spec.ts`.

## Deník úkolů a tvorba obsahu

V **Dev Mode → Úkoly** vytvoř položku, napiš slovenský text a nastav přidání:
**Na začátku hry**, **Automaticky podle podmínky** nebo **Efektem akce či dialogu**.
Dokončení nastav podmínkou nebo efektem. Používají se stejné příznaky, předměty,
negace a společné podmínky jako u interakcí; žádné podúkoly nebo zvláštní quest engine.
V odpovědi, akci objektu i kombinaci vyber efekt **Přidat úkol do deníku** nebo
**Dokončit úkol** a konkrétní cíl. Mapa logiky ukazuje podmínky i tyto efekty.
**Uložit do projektu** zapíše definice a odkazy do projektového JSON; náhled nové
hry použije stejné podmínky jako Game Mode.

Volitelná kolekce **tasks** má stabilní **id**, hráčský **text**, volitelné
**startWhen** a **completeWhen**. Chybějící podmínka znamená ovládání pouze efektem;
prázdné **all: []** je vždy splněná podmínka. Příklad:

    {
      "id": "power-router",
      "text": "Oživiť router opraveným káblom.",
      "startWhen": { "all": [] },
      "completeWhen": { "flag": "powered" }
    }

Efekty **startTask** / **completeTask** používají **id** existujícího úkolu stejně
jako ostatní efekty. Úkol se zapíše jen jednou a zůstane v deníku, i když se později
spotřebuje předmět nebo zneplatní podmínka. Splnění se nevrací zpět. Dokončení
dosud nezapsaného úkolu jej ukáže rovnou přeškrtnutý. Pořadí seznamu určuje pořadí
definic v editoru. Testovací demo postupně sleduje router, pásku a cestu za
odemčené dveře; jeho tři úkoly jsou pouze v `tests/fixtures/demo-project.json`.
Aktuální příběh má sedm vlastních úkolů: kabel, Dingo, herna, cintorín,
úmrtní doklad, krypta a obnova proudu. Podmínky reagují i na spotřebované
předměty přes trvalé příznaky; dokončený zápis se nevrací zpět.

**GameState.tasks** ukládá pouze ID a hodnotu **active/completed**. Hráčský save
je dál verze 1: starší pozice bez deníku lze načíst a aktuální příznaky/předměty
obnoví prokazatelné zápisy. Dřívější ruční události bez uložených stavů se nedají
zpětně odvodit. Neznámé ID či neplatný stav se odmítne; Nová hra zápisy resetuje.
Otevření zápisníku ani jeho focus se do save neukládají. Validace hlídá ID,
neprázdný text do 500 znaků, podmínky i odkazy efektů; smazání používaného úkolu
zablokuje save do opravy odkazů nebo Undo.

## Prohlížečové testy

```sh
npx playwright install chromium
npm run test:e2e          # nejprve vytvoří čerstvý produkční build
```

Na minimálním Linuxu případně `npx playwright install --with-deps chromium`, nebo:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e
```

Testy samy spustí servery. Desktop i dotykový profil ověřují průchod testovací
hádankou, skutečný drag/drop, použití ve scéně, klávesnici, změnu rozměrů, save/load
a chyby assetů. Engine a editorové regrese používají archivované demo ze
`tests/fixtures/demo-project.json` pouze v **dočasných kopiích zdrojů**.
Fixture obsahuje tři bývalé zkušební lokace; není součástí herního buildu.
Kontroly skutečného obsahu používají `authoredTest` z `tests/editorFixture.ts`:
celý příběh včetně obou konců, save/load a Ferovu idle smyčku. Starý nahraný
zastávkový rozhovor používá oddělený `stopTest`. Pravidlová kontrola hlídá
dvanáct lokací, výchozí `scene4`, řešitelnost i alternativní pořadí úloh. Editorové testy kreslí, přesouvají,
importují obrázek, vytvářejí dialogy, kontrolují JSON na disku, reload, konflikt
a odmítnutí neplatného zápisu. Reálný projekt ani produkci nemění. Produkční test
ověřuje nepřítomnost editoru i zápisového API. Screenshoty/trace jsou v ignorovaném
`test-results/`, náhledy editoru a grafu také při úspěšném průchodu.
Deníkové testy ověřují horní inventář, myš/dotyk, celý průchod úkoly, přeškrtnutí,
reset a save/load, úpravu textů a dialogových efektů, ochranu odkazů a pozastavení
dabingu otevřeným zápisníkem. Kontrolují také pixely HUDu a deníku po skrytí
sémantické HTML vrstvy, stránkování plného inventáře a posun dlouhého deníku
při změně velikosti a zoomu na myši i dotyku.
`tests/hud-overlay.spec.ts` nezávisle kontroluje pixely lokace na celém canvasu,
ukotvení HUDu uvnitř obrazu a průchod kliků/dropů průhlednými místy bedýnky.
Interakční testy ověřují let do inventáře, vlastní animovaný kurzor a dialog bez portrétu po
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

1. V **Lokace** vyber postavu a stiskni **Otevřít animační studio**, nebo otevři
   samostatnou záložku **Animace** a vyber **Animovaná postava**. Celý pracovní
   prostor nabízí velký Pixi náhled, přiřazení vlevo a knihovnu/nastavení vpravo.
   Na menší obrazovce se části skládají pod sebe. **Přiblížení postavy** zvětší
   detail tváře až 4×. Všechny pózy musí mít stejné plátno,
   pozici postavy a průhledné okraje jako zdroj; individuální ořez nebo změna
   rozměrů způsobuje poskakování a import jej proto odmítne.
2. Vyber typ (blink / talk / idle / expression), název a **PNG snímky nebo atlas**.
   PNG sekvence se řadí přirozeně podle názvů (`frame-2` před `frame-10`).
   Pro spritesheet vyber jediný PNG a jeho JSON do **Spritesheet metadata**.
   Podporovaný je Pixi/TexturePacker objekt `frames`, volitelné `animations`,
   `duration`, `sourceSize` a `spriteSourceSize`. Vyber sekvenci, pokud jich atlas
   obsahuje víc. Oříznuté snímky se doplní průhlednými okraji podle metadat;
   otočená políčka atlasu (`rotated: true`) nejsou podporovaná — exportuj bez rotace.
3. **Importovat animaci** validuje soubory a uloží nový adresář
   `src/assets/animations/<uuid>/` se snímky `frame-001.png` atd. Celý adresář se
   zveřejní atomicky až po úspěšném importu. Limit je 120 snímků, 32 MB vstupu
   a 64 milionů pixelů výsledných pláten. Nic se automaticky neškáluje.
   Původní PNG sekvence se kopíruje bajtově přesně. U atlasu se archivuje i
   `atlas.png` + `atlas.json`; `clip.json` je importní záznam se SHA-256 zdroje.
   Jediná aktuální konfigurace hry nadále patří do `project.json`.
   U blink/talk import navíc porovná snímky s originálem a najde oblast změn.
   Stejnou kontrolu pro starší klip spustí **Zjistit změněnou oblast**. Transparentní
   RGB šum se nepočítá jako změna. Při příliš rozsáhlých změnách vymez oblast
   ručně v původních pixelech; okolí mimo ni se při přehrávání ignoruje.
4. Přehrávej náhled, vybírej snímky, měň pořadí, fps nebo délku konkrétního snímku.
   Atlasová `duration` se zachová. **Rychlost přehrávání (×)** násobí rychlost
   celého klipu; **Rovnoměrné časování podle fps** odstraní individuální délky.
   **Opakovat klip** řídí náhled, idle a talk; jednorázový idle drží poslední pózu.
5. **Přiřadit postavě** uloží klip do návrhu a podle typu jej přiřadí jako blink,
   talk, idle nebo reakci při kliknutí (expression). Existující klipy vybírej v **Animace na úpravu**; změny klipu
   potvrď **Přidat / aktualizovat animaci** nebo znovu **Přiřadit postavě**.
   Jedna postava může mít různé kompatibilní klipy pro každý způsob spouštění.
6. Nastav automatické mrkání (náhodný interval), animaci během konkrétního dialogu,
   základní idle nebo **Animace při interakci** pro kliknutí nebo použití předmětu. Reakce
   i mrknutí se přehrají jednou a vrátí svou oblast k základu. Lokální mrkání
   pokračuje i během mluvení. Procedurální pohyb se aplikuje na celou sestavu.
   **Kombinace postavy** umožňuje zvlášť testovat oči, ústa a idle, pozastavit
   přehrávání, vynutit **Mrknout teď** a zobrazit oblasti. Testovací přepínače
   nemění přiřazení. **Vybraný klip** nabízí samostatný náhled a časovou osu.
7. **Game Mode** nebo **Otestovat odsud** okamžitě testuje návrh.
   **Uložit do projektu** zapíše konfiguraci a vazby do JSON; potom commitni JSON
   i nové assety. Neuložené změny klipu zůstanou jen v panelu. Při odstranění
   definice se soubory automaticky nemažou; jiné postavy je mohou stále používat.

Archivovaný testovací ateliér (`tests/fixtures/demo-project.json`) používá
postavu z `woman.png`: náhodně mrká po 3–6 s a mrkne také při kliknutí.
Volba **Porozprávať sa.** spustí repliku s nezávislou animací úst;
mrkání i idle pohyb pokračují. Tuto ukázku ověřují izolované animační testy.
Dva lokální snímky úst reprodukuje
`python3 experiments/woman-blink/generate_talk.py` (Pillow); zachovávají alfa kanál
celého zdroje a pixely mimo ústa. Pět póz vychází z `experiments/woman-blink/output/`; shodné
otevřené a přivřené pózy sdílejí PNG. Otevřené pózy mají krátké prodlevy,
protože čekání mezi mrknutími zajišťuje vazba, nikoli samotný klip.
Celý import si vyzkoušíš výběrem týchž pěti PNG nebo `spritesheet.png` + JSON.

Ve **Ferově dvoře (`scene4`)** má Fero nepřetržitou základní smyčku
`fero-head-scratch-loop`: prvních šest póz v pořadí **1–2–3–4–5–6–5–4–3–2–1**,
po 100 ms, `idleLoop: true`, bez náhodných prodlev. Archiv ponechává všech 12
původně vytvořených póz; pořadí přehrávání určuje pouze projektový JSON. Vzniká ze stejného lokálního kloubového rigu jako archivované
`codex/1f5c8915-841d-4f60-a153-dcc30131a5b0/expression-02.png` až `expression-05.png`,
ale používá současný transparentní zdroj 355 × 580 bez škálování plátna. Pohybují
se jen prsty a zdvižená ruka. Mrkání a ústa mají své původní nezávislé regiony;
trup, nohy i chráněná tvář zůstávají původní. Nastavení reduced motion smyčku
zastaví stejně jako ostatní animace. Reprodukce bez API:
`python3 src/assets/animations/fero-head-scratch/generate.py` (Pillow).
`recipe.json` zaznamenává původ rigu, zdroj a parametry; `validation.json` ověřuje
nativní rozměry, otisky snímků, shodné krajní pózy a ochranu pevného těla i tváře.
Jde o drobné opakované poškrábání, nikoli zvedání ruky ze svěšené polohy.

### Formát a přehrávání

`animations[]` obsahuje `id`, `label`, `source`, `kind`, `frames`, `fps` (1–30),
volitelně `durationsMs` (jedna délka 10–60000 ms pro každý snímek), `speed` (0.1–4)
a `loop` (výchozí true). `region: {"x":394,"y":173,"width":100,"height":36}`
vymezuje nezávislou oblast v původních pixelech `source`. Region musí být celočíselný
obdélník uvnitř zdroje; všechny snímky dál používají celé původní plátno. Různé
přiřazené lokální klipy se nesmějí překrývat. Opakované odkazy na stejný snímek
jsou v pořádku. Klipy bez `region` zachovávají původní celopostavové přehrávání.
Vazba `hotspot.animation` používá `blink`, `blinkIntervalMs: [min,max]`, `idle`,
volitelné `idleLoop` přepsání smyčky, `talk`, `dialogueId`, `onClick: "clip-id"`, `onUse: "clip-id"` a volitelný `motion: "breath" | "sway" | "drift"`. `drift` plynule a zdánlivě náhodně posouvá celou dekorativní vrstvu (±70 px vodorovně, ±6 px svisle, `driftOffset` v `animation.ts`); používají ho mraky na Cintoríne (`src/assets/clouds/scene5/`, vygenerované `gpt-image-2.5-sunburst` / `low`, recept v `recipe.json`). Volitelné `hotspot.clipMask` je PNG ve velikosti lokace, jehož alfa ořízne vrstvu v souřadnicích lokace (Pixi sprite mask, v editoru SVG `<mask>`); mraky tak zajíždějí za stromy, větev i kapli. Masku oblohy `sky-mask.png` vytvoří `node scripts/sky-mask.mjs <pozadí> <maska> [náhled]` (flood fill modré oblohy od horního okraje); po úpravě pozadí, např. smazání statických mraků, ji přegeneruj. Zdroj každého přiřazeného
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
automaticky nemažou. `OPENAI_API_KEY` lze použít pro grafické úpravy lokací a experimentální textovou réžii hotových klipů v Dev Mode. Generování nových animačních snímků přes API zůstává mimo tento workflow.

### Dávkové přegenerování dabingu

Příkaz používá stejné TTS, Voice Design, Rhubarb a chráněné lokální editorové API
jako Dev Mode. Sám spustí dočasný Vite server pouze na loopbacku a po dokončení
jej zavře; běžící editor není potřeba. Klíč načte server z `.env.local`, nikdy
se nevypisuje. Rhubarb používá `RHUBARB_BIN`, alternativně
`.local-tools/rhubarb/rhubarb` nebo `rhubarb` z PATH. Chybějící binárka zastaví
běh před prvním placeným požadavkem.

```bash
# Náhled bez ElevenLabs a bez změny projektu/audio assetů:
npm run speech:regenerate

# Nové repliky nebo změněný mluvený text / hlas / model / nastavení syntézy:
npm run speech:regenerate -- --confirm

# Vynutit nové audio všech hraných replik:
npm run speech:regenerate -- --all --confirm

# Pouze nové časování pro již aktuální audio, bez ElevenLabs:
npm run speech:regenerate -- --lip-sync-only --confirm
```

**Každý skutečný běh znovu vypočítá Rhubarb všech hraných replik**, včetně těch,
jejichž WAV ponechá. Nabídky témat ani komentáře bez přiřazeného herce zbytečně
nenamlouvá. Změna Voice ID, modelu, stability, podobnosti, stylu, rychlosti nebo
speaker boostu znamená nové TTS. Náhled uvádí také neověřený původ/import audio
(`unknown-voice`) a chybějící/neplatné WAV. Samotný přepis titulků nové TTS
nevyvolá; jejich úseky se přepočítají k aktuálnímu WAV. Pokud je audio zastaralé,
režim `--lip-sync-only` odmítne pokračovat a uvede potřebné TTS.

Osm stálých hlasů dávka nemaže. Uvolněné rotační postavy obnoví přes Voice Design
z archivního zadání, případně z pole **Zadání pro obnovu Voice Design** v nastavení
postavy (`voice.designPrompt`, 20–1000 znaků). U dětí jsou připravená nová zadání
přirozených věkových hlasů. Obnova vytvoří tři archivované ukázky, automaticky
použije první; `--preview 2` nebo `--preview 3` volí jinou. Nové ID hlasu vyžaduje
namluvit všechny repliky dané postavy, aby se nemíchaly dvě různé barvy hlasu.
Po výpočtu a ověření všech jejích WAV, titulků a lip-synců se uloží projekt a
teprve potom uvolní rotační slot. Úlohy běží postupně, nejprve stálé hlasy;
projekt nesmí překročit osm stálých a dva aktivní rotační hlasy. Voice Design
čerpá další kredity vedle samotného TTS. Zamítnutí poskytovatele zastaví dávku,
bez změny modelu, automatického opakování nebo náhradního hlasu.

Průběh, původní zadání a potvrzené výsledky jsou v
`.local-tools/speech-batches/<UUID>/state.json`. WAV a timingy nadále vznikají
atomicky v `src/assets/speech/<UUID>/`; původní generace se nepřepisují. Úklid
assetů chrání výsledky nedokončené dávky i po uplynutí hodinové ochrany.

```bash
# Pokračování po přerušení; dokončené TTS se znovu nevolá:
npm run speech:regenerate -- --resume UUID --confirm

# Až po kontrole archivu a účtu výslovně zopakovat neúspěšný/nepotvrzený krok:
npm run speech:regenerate -- --resume UUID --retry-failed --confirm

# Pokud se zadání změnilo a starý plán už nechceš dokončit:
npm run speech:regenerate -- --abandon UUID
```

Ctrl+C nechá doběhnout aktuální požadavek a zastaví před dalším. Chybný nebo
nejistý placený požadavek se ani při `--resume` sám neopakuje. Při nedokončené
dávce příkaz nabídne její ID místo nového placení částečných výsledků. Během
běhu neupravuj texty ani hlasy cílových postav; konflikt je zastaví a uložené
výsledky zachová. Nesouvisející změny prostředí se při zápisu zachovají.
Opustit dávku znamená pouze uzavřít její plán, bez mazání hlasů či změny hry.
Po chybě mezi registrací a uložením do projektu může hlas zůstat v účtu; před
novou obnovou proto zkontroluj volné sloty.
Po dokončení obnov stránku hry nebo načti projekt v Dev Mode. Commitni použité
nové generace a `project.json`; lokální deníky dávek do Gitu nepatří.

### Dabing ElevenLabs a Rhubarb Lip Sync

1. Do ignorovaného `.env.local` přidej `ELEVENLABS_API_KEY=...` a restartuj Vite.
   Klíč potřebuje **Text to Speech** (`text_to_speech`), **Voices: Read**
   (`voices_read`) a **Models: Read** (`models_read`). Pro nové charakterové hlasy
   povol také **Voice Generation** (`voice_generation`); pro uvolňování rotačních
   hlasů **Voices: Write** (`voices_write`). Při 401 `missing_permissions`
   doplň oprávnění v ElevenLabs → Developers → API Keys → (…) → Edit.
   Editor nyní ukáže konkrétní chybějící oprávnění. Nikdy nepoužívej
   prefix `VITE_`. Žádný klíč nepatří do projektového JSON ani do produkce.
2. Stáhni a rozbal [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync/releases)
   pro svůj systém. Zachovej i jeho doprovodný adresář `res/`. Nastav
   `RHUBARB_BIN=/absolutni/cesta/rhubarb` (Windows: `rhubarb.exe`), nebo jej přidej
   do PATH; restartuj Vite. Ověřeno s 1.14.0. Binárku lze držet v ignorovaném `.local-tools/`; necommituje se a produkce ji nepotřebuje.
3. V **Animace** vyber postavu. Vlevo otevři **Hlas ElevenLabs**, stiskni
   **Načíst hlasy a modely** a přiřaď Voice ID a vyber **Model ElevenLabs**.
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
   **Voice Design · nový charakterový hlas** vytváří vlastní hlas modelem
   `eleven_ttv_v3`: popis musí mít 20–1000 znaků, ukázkový text 100–1000.
   Jediné výslovné spuštění vrátí tři místní MP3 ukázky. Přehrání nevolá TTS.
   Vyber ukázku, pojmenuj ji a samostatně ulož do účtu; tím se přiřadí do návrhu
   postavy. Popis, text, seed, tři ukázky a jejich SHA-256 zůstávají v `design.json`;
   `registration.json` dokládá zvolený návrh a výsledné Voice ID. Projektový
   `voice.designRegistration` chrání celý tento řetězec před úklidem assetů.
   Při 402 ověř tarif a kredity: [hlasy z Voice Library nejsou na bezplatném tarifu dostupné přes API](https://elevenlabs.io/docs/eleven-creative/voices/voice-library),
   i když je lze přehrát na webu. Vyber hlas dostupný pro svůj tarif nebo importuj WAV.
4. Otevři **Dabing a lip-sync**. Vyber repliku z existujících dialogů a uprav text
   (nové uzly a větvení dál vytvářej v **Dialogy**). Potvrď zaškrtávátko placeného
   generování této repliky a stiskni **Vygenerovat dabing ElevenLabs**. Po úspěchu
   se potvrzení zruší; změna textu sama žádné API volání nevyvolává. Požadavky se
   automaticky neopakují. Samotné načtení katalogu negeneruje audio.
5. Alternativně **Nahrát WAV** importuje vlastní nahrávku bez API. Vstup je
   nekomprimovaný WAV PCM 16-bit, mono/stereo, 8–48 kHz, max. 20 MB / 180 s.
   Jiné kodeky nejprve exportuj do tohoto formátu. ElevenLabs vrací `pcm_22050`,
   server doplní WAV hlavičku — není potřeba FFmpeg ani placený 44.1kHz WAV export.
6. **Analyzovat Rhubarb** spustí místní CLI s `-r phonetic -f json --threads 2`.
   Režim phonetic nevyžaduje anglický text a je vhodný pro slovenské repliky.
   Analýza má timeout 120 s, běží bez shellu a dostává pouze ověřený lokální WAV.
7. Vlevo v **Tvary úst Rhubarb** přiřaď snímky regionálního klipu **Mluvení**.
   Vyplň alespoň X (klid) a C (otevřená ústa). A/B/C/D/E/F/G/H/X odpovídají
   [tvarům Rhubarbu](https://github.com/DanielSWolf/rhubarb-lip-sync#mouth-shapes).
   Chybějící A použije X → A → snímek 1; ostatní otevřené tvary C → B → X → snímek 1.
   Bez mapování se při přehrávání zvuku použije běžná smyčka talk.
8. Přehrávej/pozastavuj audio v náhledu, posouvej jeho čas a přibliž tvář. Oči
   náhodně mrkají a idle pokračuje nezávisle. **Uložit do projektu** zapíše vazby,
   hlas a mapování do JSON. **Game Mode** okamžitě přehraje tentýž návrh.

**Limit 10 vlastních hlasů:** osm stálých slotů je určeno Ferovi, Dežovi,
Etele, otci Bonifácovi, Milanovi Jamkovi, Dingovi, Jolandě a Ľubu Šťastnému.
Tyto hlasy se přes správu rotace nemažou. Po schválené změně Dežova hlasu
zůstává jeho původní „Nervózní nosový tenor“ v účtu jako chráněný archiv;
hra používá nový „Vyhulený zlodej kovov“. Na výslovné přání uživatele je tedy
obsazených **9 vlastních hlasů a zbývá 1 rotační slot**. Eržika, Karol a trojice
z hřiště se při další generaci musí vystřídat postupně v tomto jediném slotu.
Editorový počet osmi stálých přiřazení nezahrnuje archivního Deža navíc v účtu. Nastavení je u postavy v **Správa hlasového slotu**;
editor zobrazuje počet stálých a právě obsazených rotačních slotů.

Před uvolněním rotačního hlasu vygeneruj a analyzuj **všechny** jeho hrané
repliky a ulož projekt. Tlačítko **Ověřit dabing a uvolnit rotační hlas** pracuje
s uloženým projektem a odmítne odlišný návrh, stálý nebo neoznačený hlas.
Kontroluje skutečné PCM vzorky, SHA-256 a délku WAV, původ nahrávky a Voice ID,
aktuální text, titulky a odpovídající Rhubarb data všech jeho postav. Teprve
poté uloží `verification.json` a zavolá DELETE hlasu v ElevenLabs. Úspěch
dokládá `retirement.json`; `voice.retired` a `retirementManifest` následně
ulož do projektu. Hraní dál používá místní WAV a zůstává plně funkční.
Uvolněný hlas nelze použít pro další placené TTS ani ze staršího návrhu.
Nový Voice Design přiřadí nové ID a stav uvolnění zruší; existující nahrávky
se samy nepřegenerují.

Mazání se automaticky neopakuje. Při nejasném výsledku sítě zůstane pending
záznam a další mazání i TTS se zablokují do ručního ověření účtu. Stálé hlasy
a místní nahrávky se rotací nemažou. Úspěšné i pending záznamy uvolnění a jejich
tranzitivní podklady úklid assetů trvale chrání, i když editor mezitím zavřeš
nebo postavě přiřadíš nový hlas.

**Titulky** se upravují ve stejném panelu pod správou dabingu. `text` uzlu je
původní text pro TTS včetně tagů. Hráč ve výchozím stavu vidí text bez hranatých
závorek a jejich obsahu (včetně vnořených tagů). Volitelné **Vlastní text titulků**
(`subtitle` uzlu, také v záložce Dialogy) jej nahradí; prázdné pole obnoví automatiku.
Změna titulků neznehodnotí audio ani lip-sync.

Nové generování používá [Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
a uloží `alignment.json` s časy znaků a SHA-256 audia. Titulky se dělí podle
interpunkce a celých slov do úseků přibližně do 78 znaků. Pokud očištěný text odpovídá
zarovnání, úseky sledují skutečné časy řeči včetně přestávek. Importované/starší WAV,
chybějící zarovnání nebo odlišný vlastní přepis používají **označený odhad** podle
délky textu; nejde o rozpoznání řeči. Nové audio kvůli titulkům automaticky nevzniká.

V seznamu úseků můžeš změnit text, začátek/konec v sekundách a posunout náhled.
**Rozdělit úsek** dělí v pozici kurzoru v textu, jinak u nejbližšího prostředního
slova; **Sloučit** spojí následující úsek. **Obnovit automatické titulky** zahodí ruční
časování a přepočte úseky lokálně. Poté použij **Uložit do projektu**. Úseky jsou
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
Konfigurace repliky v archivované testovací fixture vypadá například takto:

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
vybraná postava. **Přiřadit mluvící postavu** ji změní bez generování audia.
`speech.text` je kopie namluveného textu: po editaci repliky editor ukáže upozornění
a hra staré audio nepřehraje. Nová generace/import staré časování odpojí. Uložit lze
záměrně i rozpracovaný zastaralý dabing. Save/check ověřují skutečný WAV, délku a
SHA-256 vazbu synchronizačního souboru na audio, lokální cesty, postavu a indexy snímků.

`DialogueAudio.tsx` poskytuje Pixi živý `SpeechPlayback` z `HTMLAudioElement.currentTime`.
Nevznikají druhé hodiny úst ani React render pro každý snímek. Pauza a seek drží
odpovídající tvar; otevření menu nebo skrytí záložky pozastaví zvuk. Přeskočení,
konec nahrávky, změna uzlu, ukončení dialogu a opuštění režimu zastaví původní audio.
Blokované nebo chybějící audio zachová celý čitelný text, který lze dokončit
kliknutím na titulky. V editorovém náhledu zůstává plný audio přehrávač pro ruční
spuštění. Při chybě časování se použije běžná talk animace. Bez dabingu se text
potvrdí stejnou titulkovou plochou. Audio playhead ani fáze zobrazení nejsou
součástí uloženého herního postupu; load obnoví nabídku uloženého uzlu. Reduced
motion ponechá původní kresbu, audio se přehrává dál.

`useConversation.ts` odděluje nabídku a přehrávání. Po otevření se zobrazí možnosti
startovního uzlu, jeho úvodní text se automaticky nepřehrává. `choice.next` spustí
repliku cíle; volba bez `next` ukončí rozhovor a zachová své efekty/zprávu. Bez
navazujících větví nabízí vstupní fáze **Porozprávať sa.** k poslechu samotného uzlu.
Vytváření témat i vazeb dál probíhá v **Dialogy**; není potřeba nový datový formát.
Souběžné kliknutí spotřebuje synchronní zámek před React renderem, přechody mají
300ms prodlevu proti dvojkliku/dvojitému tapnutí, která se při dalších tapnutích
prodlouží až do klidu vstupu; opakování držených kláves
Enter/mezerník se ignoruje. Prodleva platí i po návratu z herního menu. Akce `choose.from` navíc
ověřuje původní dialog/uzel v reduceru. Každé přehrání má vlastní nonce, takže
i smyčka na stejný uzel začne znovu a opožděný konec staré repliky nepřepne novou.
Čekající nabídka zavírá ústa; oči a idle dál běží. Kliknutí na titulky zastaví audio
i lip-sync ještě před přechodem do nabídky. Rozhovor se ukončuje autorskou volbou
bez `next`; nemá křížek ani tlačítka pauzy/přeskočení. Když po replice nejsou
žádné dostupné volby, rozhovor skončí. Menu i skrytá záložka pozastaví dabing.

**Archivovaná testovací ukázka:** ateliér v `tests/fixtures/demo-project.json`
obsahuje slovenskou nahrávku vytvořenou
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

### Izolovaný experiment: vrstvená ruka + OpenAI

`experiments/man-scratch/preview.html` otevři v prohlížeči: porovnání originálu
a animace, přehrávání a posun po snímcích, náhled oddělených vrstev. Výstupy
v `output/` obsahují 32 transparentních PNG při 16 fps, `preview.gif`,
`arm-contact.png`, Pixi atlas a `validation.json`. Herní JSON ani editor se nemění.

Původní postava 386 × 613 má ruku již na hlavě. Plátno se pouze rozšířilo na
512 × 768 s původním obrázkem na offsetu `[48,80]`, bez škálování. Při budoucím
importu je nutné použít `source-padded.png` a respektovat tento offset; snímky
nelze přiřadit ke starému menšímu zdroji bez úpravy jeho rámu. Paže zůstává
ukotvená, předloktí a dlaň se otáčejí kolem kloubů s pevnými délkami. OpenAI
jedním vědomým voláním dokreslilo podklad zakrytý rukou. Oprava se skládá pouze
v `repair-mask.png`; mimo sjednocenou oblast pohybu zůstávají původní RGBA.
První a poslední snímek jsou přesně zdroj na rozšířeném plátně. Jde o drobné
promnutí/poškrábání hlavy, nikoli zvednutí ruky z klidu nebo samostatně kreslené
pózy jednotlivých prstů. Kvalitu posuzuj v náhledu; geometrické kontroly ji nezaručují.

```sh
python3 experiments/man-scratch/generate.py prepare  # Pillow; bez API
python3 experiments/man-scratch/generate.py render   # archivovaný AI podklad; bez API
python3 experiments/man-scratch/generate.py verify   # pixely, atlas, klouby, negativní kontrola
```

`rig.json` drží původní souřadnice a masku ruky, PNG vrstev jsou samostatně
editovatelné. `source.png`, prompt `clean-plate.txt` a surový AI výstup jsou
archivované. Volitelná nová placená generace přes
`node experiments/man-scratch/generate-support.mjs` používá `OPENAI_API_KEY`
a případně `OPENAI_IMAGE_MODEL` z `.env.local`, kvalitu `high`, žádné retry a
odmítá přepsat existující výstup. Potřebuje izolované prostředí
`.local-tools/arm-study` s OpenAI SDK + Pillow a CLI ze skillu `imagegen`
(cesty lze nastavit přes `ARM_STUDY_PYTHON` / `IMAGE_GEN_CLI`).
Záznam modelu, promptu a SHA-256 vstupů/výstupu je v `generation.json`; žádné klíče.

Import této animace pocházel z původní odstraněné úvodní scény; aktuální hra
jej nepřehrává. ID `scene2` je nyní přidělené kaplnce. Archivované snímky mají společný ořez 391 × 626 a zdrojový offset
`[2,11]`. Podklady zůstávají v `src/assets/characters/man-scratch/` pro další použití;
při opětovném přiřazení se vazba a interval upravují běžně v Animacích.

### Izolovaný experiment: Wan2.2 Animate v ComfyUI

`experiments/wan-animate/` připravuje místní přenos pohybu z videa na postavu.
Používá existující ComfyUI v `/home/vojta/Projects/comfyui`, nativní uzly Wan
Animate v režimu Move, rozšíření ComfyUI-GGUF a DWPose z controlnet_aux.
Model Animate 14B Q4_K_S a textový enkodér UMT5 Q5_K_M umožňují zkoušku na
RTX 5060 Ti 16 GB. Váhy jsou jen v ComfyUI, jejich revize a SHA-256 jsou v
`models.json`. Žádné placené API ani OpenAI klíče se nepoužívají.

1. Spusť `/home/vojta/Projects/comfyui/start-wan.sh` a otevři
   `http://127.0.0.1:8188` (pokud už server běží, druhý nespouštěj).
2. Přetáhni `experiments/wan-animate/animate-workflow.json` do ComfyUI.
3. Uzly **Obrázek postavy**, **Pohybové vodítko** a **Popis pohybu** určují vstupy.
   Výchozí vodítko je kostra škrábání přizpůsobená naší postavě, nikoli původní
   barevné video. Klikni **Run / Ctrl+Enter**.
4. Výsledné MP4 a PNG snímky jsou v `ComfyUI/output/tukabel-wan/`.

`quality-workflow.json` / **TUKABEL-Wan22-Quality** nabízí standardní variantu:
20 kroků, CFG 3 a vypnutou akcelerační LoRA. Oba presety používají běžné VAE
dekódování. Malé časové/prostorové dlaždice v prvním pokusu způsobovaly zřetelný
zlom uprostřed klipu; porovnání stejných latentů je v `first-video/tiled-contact.png`
a `first-video/contact.png`. `first-video/tiled-result.mp4` uchovává diagnostickou variantu.

První video s živým hercem je archivované v `first-video/`: 33 snímků,
rychlý běh po načtení vah 58 s, standardní 244 s a přibližně 13,6 GB VRAM.
U něj model schovával prsty za hlavu. Aktuální `result.mp4` / `preview.gif`
používají bližší kreslenou předlohu `istockphoto-2157540836-640_adpp_is.mp4`:
0,7–3,7 s, 49 snímků, bez zrcadlení. `verification.json` zaznamenává skutečné
běhy; `environment.json` zachycuje verze instalace.

`preview.html` porovnává předlohu a hotové pokusy. Původní volné gesto z
`idle-prompt_00001_.mp4` je zachované v `prompt-unanchored/`, včetně 33 původních
PNG v `prompt-unanchored/frames/`. Novější `idle-result.mp4` / `idle-frames/`
ukotvují začátek klipu obrázkem; video předloha se vůbec nepoužívá. Tento
experiment spustí **TUKABEL-Wan22-Prompt** / `idle-workflow.json`: obrázek + text,
33 snímků, 8 kroků, CFG 1 a LoRA. Výpočet trval přibližně minutu. Není to
samostatný TI2V checkpoint: zkoušíme Animate bez pose větve. Model zatím může
pohyb přehnat a měnit styl či proporce. Původní PNG jsou také v `frames/`
(49 snímků s novou kreslenou video předlohou). Všechny tyto PNG mají RGB pozadí.

Nastavení: 320 × 512, 49 snímků, 16 fps, Euler/simple. Rychlý preset má 6 kroků,
CFG 1 a Lightx2v I2V LoRA; standardní 20 kroků a CFG 3 bez LoRA.
Jde o krátký test kvality, nikoli záruku přesné kopie kresby.
Wan generuje RGB video: průhlednost, dokonalá smyčka a pixelová shoda se zdrojem
nejsou zaručené. Do hry se po výběru vhodného výsledku importují připravené PNG
stávajícím animačním importem; průhledné pozadí je nutné nejprve připravit.

Reprodukce ze stejného místního referenčního videa (jeho originál se nemění ani
neukládá do Gitu):

```sh
COMFY_DIR=/home/vojta/Projects/comfyui
python3 experiments/wan-animate/download_models.py "$COMFY_DIR/ComfyUI" --verify
"$COMFY_DIR/.venv/bin/python" experiments/wan-animate/prepare.py \
  /cesta/k/pohybovemu-videu.mp4 "$COMFY_DIR/ComfyUI"
python3 experiments/wan-animate/workflow.py
python3 experiments/wan-animate/run.py experiments/wan-animate/preprocess-api.json
# Použij skutečně vzniklý driving-pose_XXXXX.json:
"$COMFY_DIR/.venv/bin/python" experiments/wan-animate/retarget.py \
  "$COMFY_DIR/ComfyUI/output/tukabel-wan/driving-pose_00001.json" "$COMFY_DIR/ComfyUI"
python3 experiments/wan-animate/run.py experiments/wan-animate/animate-api.json
# Standardní varianta:
python3 experiments/wan-animate/run.py experiments/wan-animate/quality-api.json
```

`prepare.py` vybírá 0,7–3,7 s při 16 fps bez zrcadlení (`--start`, `--frames`,
`--fps`, `--mirror` / `--no-mirror`). `retarget.py` obsahuje konkrétní klouby naší ukázkové
postavy; nepředstírá univerzální retargeter. Zachová tělo a ruku s hrnkem, přenese
relativní úhly škrábající paže a prsty. Rozsah lze omezit pomocí
`--max-arm-degrees` / `--max-forearm-degrees`; skutečné hodnoty jsou v `retarget.json`.
Snímky postavy nedeformuje: vytváří jen
kostru, podle které následně kreslí Wan. `preprocess-workflow.json` umožňuje
zkontrolovat původní DWPose výstup; `pose-reference.png` ukazuje zarovnání.
Nové API grafy sestaví `python3 experiments/wan-animate/workflow.py`, jejich
vizuální export obstará `node experiments/wan-animate/export-workflows.mjs`.

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
