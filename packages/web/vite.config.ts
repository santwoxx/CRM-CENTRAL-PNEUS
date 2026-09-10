import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Le o .env da raiz do monorepo: uma unica fonte de configuracao para
  // backend e frontend. Sem isso, as variaveis VITE_* da raiz eram ignoradas
  // no build e o painel saia sem a configuracao do Firebase.
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@crm/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: 'http://localhost:3333',
        ws: true,
      },
    },
  },
});
