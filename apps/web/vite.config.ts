import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.OSCODE_PORT ? `http://127.0.0.1:${process.env.OSCODE_PORT}` : 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 5173,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER, ws: true },
    },
  },
});
