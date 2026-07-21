import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'https://70489dd616f14c3d-103-25-138-13.serveousercontent.com',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'https://70489dd616f14c3d-103-25-138-13.serveousercontent.com',
        changeOrigin: true,
        secure: false,
        ws: true,
      }
    }
  }
})

