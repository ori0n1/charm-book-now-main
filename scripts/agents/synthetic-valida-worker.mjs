import { runApprovedTest, runValida } from "../../agents/valida.mjs";

try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input) > 128_000) throw new Error("INPUT_LIMIT");
  }
  const { scenario, proposal } = JSON.parse(input);
  if (!["confirmed", "unknown-cause", "test-failure", "auth-unavailable"].includes(scenario)) {
    throw new Error("INVALID_SYNTHETIC_SCENARIO");
  }
  const proposalSafe = !proposal?.proposedPatch ||
    (proposal.proposedPatch.applied === false &&
      proposal.proposedPatch.file === "agents/reference.json" &&
      proposal.publicationAuthorized === false);
  const report = runValida({
    runCase: (testCase) => {
      const actual = runApprovedTest(testCase);
      // One controlled failure is injected after running the real local
      // contract. No file or remote state is changed.
      const failed = !proposalSafe ||
        (scenario === "test-failure" && testCase.file === "tests/client-duplicates.test.mjs");
      return failed ? { ...actual, state: "FAIL", reason: "SYNTHETIC_TEST_FAILED" } : actual;
    },
  });
  process.stdout.write(JSON.stringify(report));
} catch {
  process.exitCode = 1;
}
