import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://vault.asgard-ai.com',
  integrations: [
    tailwind(),
  ],
  output: 'static',
});
