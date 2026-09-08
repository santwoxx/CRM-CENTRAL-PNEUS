import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
    plugins: [react()],
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
                rewrite: function (p) { return p.replace(/^\/api/, ''); },
            },
            '/socket.io': {
                target: 'http://localhost:3333',
                ws: true,
            },
        },
    },
});
