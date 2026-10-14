# TUKABEL: Záhada strateného kábla

Základ komediální 2D point-and-click adventury pro třídenní AI hackathon.
TypeScript + React + Vite, herní scéna v PixiJS 8. Kompletně v prohlížeči,
bez backendu a externích služeb za běhu.

## Spuštění

Node.js **20.19+ nebo 22.12+** a npm.

```sh
npm ci
npm run dev
```

Vite vypíše lokální adresu (standardně `http://localhost:5173`).

```sh
npm run check       # lint, formát, TypeScript a produkční build
npm run preview     # lokální náhled již vytvořeného dist/
```

`dist/` lze vystavit na běžném statickém hostingu, i v podadresáři. Otevírání
`index.html` přes `file://` není podporované; použij HTTP server.

## Architektura a rozsah

- `src/App.tsx` — stav ukázky a webové rozhraní.
- `src/ui/GameCanvas.tsx` — životní cyklus Pixi aplikace v Reactu.
- `src/game/createScene.ts` — pozadí, hotspoty, zvýraznění a škálování.
- `src/game/types.ts` — malý typovaný kontrakt scény a interakcí.
- `src/game/scenes/demoScene.ts` — konkrétní lokace a reakce předmětů.
- `src/assets/demo-room.svg` — lokální kreslené pozadí upravitelné kódem.
- `tests/scene.spec.ts` — integrační kontrola v reálném Chromium.

Demo je technická zkušebna se třemi předměty. Najeď na předmět a klikni/tapni;
stejné akce jsou dostupné přes HTML tlačítka klávesnicí. Pixi zvýrazní hotspot,
React zobrazí reakci a počet interakcí. Reset obnoví pouze stav této ukázky.
Scéna zachovává poměr stran a souřadnice 1280×720 při změně velikosti.
Statické kreslení nevyžaduje trvalý render loop. Prohlížeč musí podporovat WebGL.

Příběh, inventář, dialogy, pohyb postavy, hádanky, zvuk a save/load zatím chybí
záměrně. Stav je lokální v Reactu a po obnovení stránky se ztratí.

## Ověření v prohlížeči

Jednorázově stáhni testovací prohlížeč:

```sh
npx playwright install chromium
npm run test:e2e
```

Na minimálním Linuxu může být potřeba `npx playwright install --with-deps chromium`.
Testy si spustí vlastní Vite server. Po selhání ukládají screenshot/trace do
ignorovaného `test-results/`.

Pokud už máš Chromium/Chrome v systému, můžeš místo stažení zadat jeho cestu:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e
```

## Další vývoj

První skutečnou lokaci přidej jako konkrétní definici v `src/game/scenes/`:
lokální pozadí, jeho rozměry a hotspoty v těchto souřadnicích. Vyměň definici
předávanou do `GameCanvas`. Pro nepravidelné předměty případně rozšiř hit area
o Pixi Polygon. Inventář a herní pravidla přidej až pro první skutečnou hádanku;
React stav/reducer postačí, dokud se neprokáže potřeba další knihovny.

Instrukce pro agenty jsou v [AGENTS.md](AGENTS.md). Vlastní skills zatím nejsou
potřeba; konkrétní opakované workflow lze později uložit do `.agents/skills/`.
Krátké instrukce a účelně vybrané skills odpovídají
[doporučením OpenAI](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
