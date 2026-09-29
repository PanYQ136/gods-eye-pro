import { localProviderPlugins } from './server/providers/local.js';

const routes = [];
const mockServer = {
  middlewares: { use: (path, handler) => routes.push({ path, handler }) },
  httpServer: null,
  ws: null,
  config: { logger: { warn() {}, info() {} } },
};

const plugins = localProviderPlugins();
const flat = plugins.flatMap((p) => (Array.isArray(p) ? p : [p]));
let errs = 0;
for (const pl of flat) {
  if (typeof pl?.configureServer === 'function') {
    try {
      pl.configureServer(mockServer);
    } catch (e) {
      errs++;
      console.log('ERR', pl?.name, '->', e?.message || e);
    }
  } else {
    console.log('SKIP (no configureServer):', pl?.name);
  }
}
console.log('plugins:', flat.length, '| captured routes:', routes.length, '| errors:', errs);
for (const r of routes) console.log('  ', r.path, '->', typeof r.handler);
