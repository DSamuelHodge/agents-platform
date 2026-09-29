import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

// flue() must precede cloudflare(). The provider list is derived from policy.json: providers not
// listed are not bundled, so a model outside the department allowlist cannot resolve at all.
export default defineConfig({
  plugins: [flue({ providers: ["cloudflare"] }), cloudflare({ config: flueWorkerConfig() })],
});
