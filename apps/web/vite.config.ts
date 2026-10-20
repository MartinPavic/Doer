import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Same-origin in dev so the session cookie just works.
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/profiles': 'http://localhost:8787',
    },
  },
})
