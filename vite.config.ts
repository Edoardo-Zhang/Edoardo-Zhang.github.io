import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' keeps every asset reference relative, so the build runs from any sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // 生产构建不产出 sourcemap，避免把源码结构暴露到线上（Vite 默认值即 false，这里显式声明）。
  build: { sourcemap: false },
  // 开发时把 /api 代理到本机后端（node server/index.mjs），生产环境由服务器同源提供。
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
})
