import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import { nitro } from 'nitro/vite';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  // Resolve CSS package entries before Nitro applies server import conditions.
  resolve: {
    alias: [
      { find: /^tailwindcss$/, replacement: fileURLToPath(new URL('./node_modules/tailwindcss/index.css', import.meta.url)) },
      { find: /^tw-animate-css$/, replacement: fileURLToPath(new URL('./node_modules/tw-animate-css/dist/tw-animate.css', import.meta.url)) },
      { find: /^shadcn\/tailwind\.css$/, replacement: fileURLToPath(new URL('./node_modules/shadcn/dist/tailwind.css', import.meta.url)) },
    ],
  },
  plugins: [
    vinext(),
    nitro({ preset: process.env.NITRO_PRESET || 'vercel' }),
  ],
});
