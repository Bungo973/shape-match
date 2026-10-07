import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 相对路径：打包结果放在网站根目录或任意子目录下都能直接打开
  base: './',
});
