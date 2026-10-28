// READ-ONLY readiness check. This command never executes rollback.
import { assertProductionContext, assertProductionConfig, verifyProductionReadiness, productionRollbackCommand } from './lib/cloudflare-production-guard.mjs';
const args=process.argv.slice(2);
if(args.length!==4 || args[0]!=='--production' || args[1]!=='--check-only' || args[2]!=='--expected-current-version') throw new Error('rollback_check_only_requires_explicit_production_and_current_version');
assertProductionConfig({requireRootMatch:true});
const result=await verifyProductionReadiness(assertProductionContext({explicitProduction:true}),{rollbackCheck:true,expectedCurrentVersion:args[3]});
process.stdout.write(JSON.stringify({result,rollbackCommandPreparedOnly:productionRollbackCommand(),mutationPerformed:false})+'\n');
