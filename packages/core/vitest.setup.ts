import fc from "fast-check";

// Every property test runs 100 cases; the nightly workflow multiplies them (DESIGN.md §11).
fc.configureGlobal({ numRuns: 100 * Number(process.env.PROPERTY_RUNS_FACTOR ?? 1) });
