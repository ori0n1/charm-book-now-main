import { randomBytes } from "node:crypto";
import { createPrivateApiClient } from "../../agents/private-api/client.mjs";
import { inspectPrivateAggregate } from "../../agents/private-api/analysis.mjs";
import { createSyntheticSource } from "../../agents/private-api/fixtures.mjs";
import { startPrivateApi } from "../../agents/private-api/server.mjs";

const key = randomBytes(32);
const clients = new Map([["atlas-local-demo", {
  key, studios: ["STUDIO_CAPIVARA", "STUDIO_27"],
}]]);
const api = await startPrivateApi({ clients, source: createSyntheticSource() });
try {
  const read = createPrivateApiClient({ baseUrl: api.url,
    clientId: "atlas-local-demo", key });
  const results = [];
  for (const studioCode of ["STUDIO_CAPIVARA", "STUDIO_27"]) {
    for (const domain of ["agenda", "reservas", "notificacoes", "pagamentos"]) {
      results.push(await read({ studioCode, domain }));
    }
  }
  console.log(JSON.stringify({ mode: "SYNTHETIC_ONLY", remoteReads: 0,
    results, anomalies: results.flatMap(inspectPrivateAggregate) }, null, 2));
} finally {
  await api.close();
  key.fill(0);
}
