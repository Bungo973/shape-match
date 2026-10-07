import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        game: 'index.html',
        styleLab: 'docs/prototypes/ui-style-lab.html',
      },
    },
  },
});
