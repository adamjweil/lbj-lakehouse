import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { designPlugin } from './vite-plugin-design';

export default defineConfig({
  plugins: [react(), designPlugin()],
  server: { port: 5173 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
