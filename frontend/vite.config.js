import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-v2.js`,
        chunkFileNames: `assets/[name]-[hash]-v2.js`,
        assetFileNames: `assets/[name]-[hash]-v2.[ext]`,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: ['all'],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
    hmr: {
      overlay: false,
    },
  },
})
