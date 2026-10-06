import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const api = process.env.VMA_API || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/ws': { target: api.replace(/^http/, 'ws'), ws: true },
      '/api': { target: api, changeOrigin: true },
    },
  },
})
