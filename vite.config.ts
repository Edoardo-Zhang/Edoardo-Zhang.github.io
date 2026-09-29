import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' keeps every asset reference relative, so the build runs from any sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
