import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const articleFiles = readdirSync(resolve(project, 'content/blog')).filter((name) => name.endsWith('.ts'));
const slugs = articleFiles.map((name) => {
  const content = readFileSync(resolve(project, 'content/blog', name), 'utf8');
  const slug = content.match(/\bslug:\s*"([a-z0-9-]+)"/)?.[1];
  assert.ok(slug, `Missing article slug in ${name}`);
  return slug;
});
assert.equal(slugs.length, 10);
assert.equal(new Set(slugs).size, 10);

const mocks = {
  '@tanstack/react-router': 'export const createFileRoute = () => (route) => route;',
  '@supabase/supabase-js': `
    export function createClient() {
      return { from(table) {
        globalThis.__bellzaSitemapQuery = { table, filters: [] };
        const query = {
          select() { return this; },
          eq(column, value) { globalThis.__bellzaSitemapQuery.filters.push([column, value]); return this; },
          not() { return this; },
          order() { return this; },
          limit() { return this; },
          then(resolve, reject) { return Promise.resolve({ data: globalThis.__bellzaSitemapRows, error: null }).then(resolve, reject); },
        };
        return query;
      } };
    }
  `,
  '@/lib/blog': `
    export const BLOG_BASE_URL = 'https://bellza.pt';
    export const blogArticles = ${JSON.stringify(slugs.map((slug) => ({ slug, updatedAt: '2026-06-27', featured: false })))};
    export const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  `,
};

const bundle = await build({
  entryPoints: [resolve(project, 'src/routes/sitemap[.]xml.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [{
    name: 'sitemap-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/qa-public-visibility$/ }, () => ({ path: resolve(project, 'src/lib/qa-public-visibility.ts') }));
      builder.onResolve({ filter: /^(?:@tanstack\/react-router|@supabase\/supabase-js|@\/lib\/blog)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], loader: 'js' }));
    },
  }],
});
const { Route } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:56399';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key';

test('sitemap includes approved articles and only eligible published studios', async () => {
  globalThis.__bellzaSitemapRows = [
    { id: '11111111-1111-4111-8111-111111111111', slug: 'studio-sintetico-publicado', updated_at: '2026-11-19T12:00:00Z' },
    { id: 'e2663064-7774-41c5-95cb-e5e6afc4fab4', slug: 'bellza-qa-e2663064', updated_at: '2026-11-19T12:00:00Z' },
    { id: '22222222-2222-4222-8222-222222222222', slug: 'bellza-studio-demo', updated_at: '2026-11-19T12:00:00Z' },
  ];
  const response = await Route.server.handlers.GET();
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.equal(globalThis.__bellzaSitemapQuery.table, 'public_studios');
  assert.deepEqual(globalThis.__bellzaSitemapQuery.filters, [['is_active', true]]);
  for (const slug of slugs) assert.ok(xml.includes(`<loc>https://bellza.pt/blog/${slug}</loc>`), slug);
  assert.ok(xml.includes('<loc>https://bellza.pt/s/studio-sintetico-publicado</loc>'));
  assert.ok(!xml.includes('bellza-qa-e2663064'));
  assert.ok(!xml.includes('bellza-studio-demo'));
  assert.ok(!xml.includes('<loc>https://bellza.pt/admin'));
});

test('sitemap removes a studio after it leaves the public view', async () => {
  globalThis.__bellzaSitemapRows = [];
  const xml = await (await Route.server.handlers.GET()).text();
  assert.ok(!xml.includes('studio-sintetico-publicado'));
  for (const slug of slugs) assert.ok(xml.includes(`/blog/${slug}`), slug);
});
