import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { editorPlugin } from './dev/editorPlugin.ts';

export default defineConfig({
  plugins: [react(), editorPlugin()],
  base: './',
});
