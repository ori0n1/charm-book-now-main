// Local configuration preparation only. No build, API, credentials or deploy.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { assertProductionConfig, assertProductionArtifact, productionArtifactConfig } from './lib/cloudflare-production-guard.mjs';
if(process.argv.slice(2).join(' ')!=='--production --prepare-only') throw new Error('explicit_production_artifact_preparation_required');
assertProductionConfig({requireRootMatch:true});
if(!existsSync('dist/server/index.js') || !existsSync('dist/client')) throw new Error('local_production_build_missing');
const source=JSON.parse(readFileSync('wrangler.production.jsonc','utf8'));
writeFileSync('dist/server/wrangler.production.jsonc',JSON.stringify(productionArtifactConfig(source),null,2)+'\n');
process.stdout.write(JSON.stringify({preparedOnly:true,artifact:assertProductionArtifact(),mutationPerformed:false})+'\n');
