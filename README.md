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
na disku i při vrácení úpravy; nepoužité případně ručně odstraň. SVG a AVIF lze přidat
přímo do repozitáře. Názvy assetů používej bez mezer a diakritiky (`a-z`, číslice,
`_`, `-`, podadresáře). Assety se při buildu importují přes Vite; žádné CDN.

## Vrstvy a grafické úpravy lokací

V **Dev Mode → Lokace** zůstává scéna rozložená na pozadí a samostatné vrstvy.
Seznam **Vrstvy** ukazuje přední objekty nahoře. Šipky mění pořadí vykreslování;
oko nastavuje viditelnost i ve hře, zámek chrání editorové tahy a vlastnosti.
Krytí se ukládá jako 0–1. **+ Obrázková vrstva** přidá dekoraci; její PNG/WebP/JPEG
lze importovat přímo v poli **Obrázek vrstvy**. Vyber ji ze seznamu nebo za viditelné
pixely a přesuň/zvětši/otoč existujícími úchyty. **Interaktivní objekt** zapne běžné
hotspotové reakce a inventární pravidla v pravém inspektoru. Dekorace propouštějí
herní hover, kliknutí i drop na objekty pod nimi. Zamknutí nemění chování hry.

1. V **Zdroj grafické úpravy** vyber pozadí nebo právě vybranou obrázkovou vrstvu.
2. Nad scénou zvol **Vybrat obdélník** a táhni, nebo **Vybrat polygon** a přidávej body.
   Polygon uzavři Enterem, prvním bodem nebo **Dokončit polygon**. Escape ruší návrh.
   Oblast není nový herní hotspot. Výběr se převádí přes zoom, natočení a contain-fit
   do původních pixelů konkrétního obrázku; část mimo něj se odmítne.
3. V **Výběr a grafika** zvol operaci a název výsledku:
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
nezduplikuje. Nabízí pouze odstranění/oddělení se shodnou cestou i SHA-256
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

V tomto prostředí je ověřený runtime a skutečný offline průchod adaptérem na malé
náhodně inicializované testovací architektuře (tvary vstupů a nativní souřadnice,
nikoli kvalita). Chybí schválený přístup k vahám; reálné srovnání SAM 3 proti SAM 2
proto zatím není ověřené. Pravidlový test s naučenými vahami se do jejich instalace
výslovně přeskočí. Produkce model ani Python nepotřebuje.

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
2. Zvol **Mrkání**, **Tvary úst pro mluvení** nebo obojí. Zadej pokyny, počet
   snímků každého klipu (5–24) a fps (1–30).
3. Klikni **Spustit místního Codex agenta**. V **Úlohy na pozadí** uvidíš průběh
   a zprávy. Můžeš pokračovat v práci, uložit projekt nebo obnovit stránku.
   **Zastavit agenta** ukončí jeho procesy; další čekající úloha pak pokračuje.
4. **Otevřít výsledek** vrátí správnou postavu. Zkontroluj jednotlivé snímky nebo
   společný Pixi náhled očí, úst a idle. **Přiřadit výsledek do návrhu** je jeden
   krok Undo; **Uložit do projektu** zapíše klipy a vazby do projektového JSON.
   Hlasy a reakce zůstávají; po výměně úst znovu přiřaď jejich mapu Rhubarb,
   protože indexy nových póz mohou mít jiný význam.

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

Runner kontroluje skutečné PNG, stejné rozměry a alfu postavy, původní krajní
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
PixiJS vykresluje inventář jako kreslenou dřevěnou poličku, ikonku potrhaného
zápisníku a malé cedulky **Objekty** (oko) / **Menu** (tři čárky). Pozadí pokračuje
pod HUD; nevzniká žádná lišta ani vyhrazený okraj. Při tvorbě lokace nech horní
část obrazu volnější. HUD zůstává uvnitř obrazu i na vysokém displeji s letterboxem;
na úzkém obrazu jsou pomocné cedulky v levém konci poličky. Polička se prodlužuje podle
počtu předmětů, její konce se nedeformují. Další předměty zobrazí šipky.
Názvy se ukážou při najetí nebo zaměření klávesnicí, výběr předmětu zobrazí popis.
Viditelné dřevo a ovládací prvky blokují svět pod sebou; průhledná místa HUDu
propouštějí hover, kliky i drop do scény. Geometrie scény nezávisí na HUDu.
Titulky a dialogové volby dál vykresluje současné React UI.
Stejné herní okno používá i **Otestovat odsud** v Dev Mode.

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
  (**Inventární ikonka**); nemusí odpovídat obrázku hotspotu. Nový předmět krátce
  povyroste, zprůhlední a přeletí do kapsy. Načtení uložené hry tento efekt nespouští.
- Alternativa bez tažení: klikni/tapni na předmět a následně na cíl. Výběr zároveň
  zobrazí jeho popis. Tab/Enter používá neviditelnou sémantickou HTML vrstvu
  pro klávesnici a čtečky; zaměřené tlačítko zvýrazní Pixi. Tato vrstva nezachytává
  myš ani dotyk a žádný HUD nevykresluje. **Objekty** nabízí
  přístupný seznam všech viditelných interaktivních oblastí včetně nepodstatných.
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

Ukázkový průchod: správce → dotaz na opravu → vyžádat pásku → ukončit rozhovor →
sebrat kabel u židle → přetáhnout pásku na kabel → opravený kabel na router → dveře
do dvora → tabule. Textové repliky mezi volbami potvrď kliknutím na titulky. Lze se vrátit;
vyřešený stav zůstává. Jde o technickou hádanku
se dvěma lokacemi, bez finálního příběhu a assetů. Chůze postavy zatím chybí;
animace, dabing a lip-sync lze přiřadit v editoru podle návodu níže.

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
- `src/game/createHud.ts`, `hudLayout.ts` — Pixi HUD, inventář, deník a vizuální efekty;
  společný viewport scény a cílení předmětů bez změny autorských souřadnic.
- `src/assets/hud/`, `src/game/hudArt.ts` — místní kreslené SVG poličky, obálky,
  otevřeného zápisníku a cedulek; měnitelné bez externí služby.
- `src/ui/` — herní stav/UI, životní cyklus canvasu, dialogové překryvy a pointer capture;
  `HudAccessibility.tsx` přidává pouze sémantiku a klávesnici k Pixi ovládání.
- `src/editor/` — pouze vývojový editor, SVG autorování oblastí, formuláře a graf.
  `SceneImage.tsx` používá stejnou geometrii jako Pixi; `transformTools.ts` počítá
  proporcionální tahy a limity scény. Zoom, pomůcky a rozpracovaný tah jsou jen UI stav.
- `dev/editorPlugin.ts` — lokální Vite middleware pro načtení/zápis a import assetů.
- `src/editor/MaskEditor.tsx`, `ExtractionComparison.tsx` — štětcové masky a kontrola složení.
- `dev/artSource.ts`, `objectMask.ts`, `segmentation.ts` — bezpečný rastrový zdroj,
  validace masek a lokální OpenCV / SAM 2 / ViTMatte + PyMatting. `sceneArt.ts` publikuje původní
  výřez, samostatnou opravu pozadí a pixelovou kontrolu.
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
definic v editoru. Ukázka postupně sleduje router, pásku a cestu za odemčené dveře.
Jde o technickou ukázku navázanou na existující příznaky, bez nového příběhu.

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

Testy samy spustí servery. Desktop i dotykový profil ověřují kompletní průchod,
skutečný drag/drop, použití ve scéně, klávesnici, změnu rozměrů, save/load a chyby
assetů. Editorové testy používají **dočasné kopie zdrojů**: kreslí, přesouvají,
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
ukotvení HUDu uvnitř obrazu a průchod kliků/dropů průhlednými místy poličky.
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

První příklad: v editoru zvol lokaci **Animačný ateliér**, pak
**Otestovat odsud**. Postava z `woman.png` náhodně mrká po 3–6 s a mrkne také
při kliknutí. V dialogu zvol **Porozprávať sa.** pro repliku s nezávislou animací úst;
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
automaticky nemažou. `OPENAI_API_KEY` lze použít pro grafické úpravy lokací a experimentální textovou réžii hotových klipů v Dev Mode. Generování nových animačních snímků přes API zůstává mimo tento workflow.

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
