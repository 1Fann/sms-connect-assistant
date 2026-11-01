import { defineConfig } from 'vite';
export default defineConfig({build:{outDir:'../app/src/main/assets/iphone',emptyOutDir:true,rollupOptions:{input:{messages:'index.html',phone:'phone/index.html'}}}});
