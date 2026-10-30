import 'pixi.js/unsafe-eval';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startPlatform } from './platform';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
const render = (session = 0) =>
  root.render(
    <StrictMode>
      <App key={session} />
    </StrictMode>,
  );
// Inside the Azet Games shell the game starts on Play; otherwise at once.
if (!(await startPlatform(render))) render();
