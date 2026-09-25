import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works at https://<user>.github.io/<repo>/ without configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
});
