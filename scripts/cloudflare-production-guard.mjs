import { assertProductionConfig, assertProductionContext, verifyProductionReadiness, productionRollbackCommand } from './lib/cloudflare-production-guard.mjs';
const args = process.argv.slice(2);
if (!args.includes('--production') || !args.includes('--check-only') || args.some(a => !['--production','--check-only','--verify-token'].includes(a)) || new Set(args).size !== args.length) throw new Error('Production preparation accepts only --production --check-only [--verify-token]; it never deploys or rolls back.');
const config = assertProductionConfig();
const credential = args.includes('--verify-token') ? await verifyProductionReadiness(assertProductionContext({ explicitProduction: true })) : null;
process.stdout.write(JSON.stringify({ environment: 'production', config, credential, rollbackCommandPreparedOnly: productionRollbackCommand(), mutationPerformed: false },null,2)+'\n');
