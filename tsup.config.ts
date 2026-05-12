import { defineConfig } from 'tsup';
import { cp } from 'node:fs/promises';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  dts: false,
  sourcemap: true,
  outDir: 'dist',
  async onSuccess() {
    await cp('dashboard', 'dist/dashboard', { recursive: true });
  },
});
