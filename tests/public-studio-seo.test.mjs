import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mocks = {
  '@tanstack/react-router': 'export const createFileRoute = () => (route) => ({ ...route, useLoaderData: () => globalThis.__bellzaStudio }); export const notFound = () => new Error("not found");',
  '@/components/brand-loading-state': 'export const BrandLoadingState = () => null;',
  '@/components/booking-experience': 'export const BookingExperience = () => null;',
  '@/lib/app-brand': 'export const APP_BRAND = { name: "Bellza" }; export const CANONICAL_ORIGIN = "https://bellza.pt";',
  '@/lib/brand-assets': 'export const BELLZA_APP_ICON_512 = "/bellza-app-icon.svg";',
  '@/lib/output-safety': 'export const serializeJsonForHtmlScript = JSON.stringify;',
  '@/lib/public-studio.functions': 'export const getPublicStudioSeo = async () => globalThis.__bellzaStudio;',
};
const bundle = await build({
  entryPoints: [resolve(project, 'src/routes/s.$slug.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [{
    name: 'studio-seo-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/qa-public-visibility$/ }, () => ({ path: resolve(project, 'src/lib/qa-public-visibility.ts') }));
      builder.onResolve({ filter: /^(?:@tanstack\/react-router|@\/components\/brand-loading-state|@\/components\/booking-experience|@\/lib\/app-brand|@\/lib\/brand-assets|@\/lib\/output-safety|@\/lib\/public-studio.functions)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path], loader: 'js' }));
    },
  }],
});
const { Route } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const studio = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'barbearia-sintetica',
  name: 'Barbearia Sintética',
  tagline: 'Cortes e barba',
  description: null,
  location: 'Lisboa',
  logoUrl: null,
  bookingFlowMode: 'online',
};

test('published studio has canonical URL, individual metadata and valid generic business type', () => {
  const head = Route.head({ loaderData: studio, params: { slug: 'BARBEARIA-SINTETICA' } });
  assert.ok(head.links.some((link) => link.rel === 'canonical' && link.href === 'https://bellza.pt/s/barbearia-sintetica'));
  assert.ok(head.meta.some((meta) => meta.name === 'robots' && meta.content.startsWith('index,follow')));
  assert.ok(head.meta.some((meta) => meta.name === 'description' && meta.content.includes('Cortes e barba')));
  assert.ok(head.meta.some((meta) => meta.property === 'og:url' && meta.content === 'https://bellza.pt/s/barbearia-sintetica'));
  globalThis.__bellzaStudio = studio;
  const page = Route.component();
  const script = page.props.children.find((child) => child?.type === 'script');
  const schema = JSON.parse(script.props.dangerouslySetInnerHTML.__html);
  assert.equal(schema['@type'], 'LocalBusiness');
  assert.equal(schema.name, studio.name);
  assert.equal(schema.address, studio.location);
});

test('demo and unavailable studios are not indexable', () => {
  const demo = Route.head({ loaderData: { ...studio, slug: 'bellza-studio-demo' }, params: { slug: 'bellza-studio-demo' } });
  assert.ok(demo.meta.some((meta) => meta.name === 'robots' && meta.content === 'noindex,follow'));
  const unavailable = Route.head({ loaderData: null, params: { slug: 'indisponivel' } });
  assert.ok(unavailable.meta.some((meta) => meta.name === 'robots' && meta.content === 'noindex,follow'));
});
