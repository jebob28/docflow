import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import fs from 'fs';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      disable: true, // Desabilitar PWA em dev para evitar problemas de conexão com a API
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true, // Habilitar em desenvolvimento para debug
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'GED Platform SaaS',
        short_name: 'GEDPlatform',
        description: 'Plataforma para Gestão Estratégica de Documentos SaaS',
        theme_color: '#1a355b',
        background_color: '#f6f7f8',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    }),
  ],
  server: {
    port: 5174,
    host: '0.0.0.0',
    https: {
      key: fs.readFileSync('../key.pem'),
      cert: fs.readFileSync('../cert.pem'),
    },
    proxy: {
      '/api': {
        target: 'https://127.0.0.1:8081',
        changeOrigin: true,
        secure: false, // Permitir certificados auto-assinados no proxy
        rewrite: (path) => path, // Garantir que o path não seja alterado de forma inesperada
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
});
