import { localAccessStatus } from "../../agents/access-status.mjs";

// Local metadata only. No remote request, token output or SQL.
process.stdout.write(JSON.stringify(localAccessStatus(), null, 2) + "\n");
