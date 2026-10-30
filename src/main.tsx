import 'pixi.js/unsafe-eval';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './game/textWrap';
import { loadLanguageFont, savedLanguage, setLanguage } from './game/i18n';
import { startPlatform } from './platform';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-700.css';
import './styles.css';

const language = savedLanguage();
setLanguage(language);
await loadLanguageFont(language);

const root = createRoot(document.getElementById('root')!);
const render = (session = 0) =>
  root.render(
    <StrictMode>
      <App key={session} />
    </StrictMode>,
  );
// Inside the Azet Games shell the game starts on Play; otherwise at once.
if (!(await startPlatform(render))) render();
