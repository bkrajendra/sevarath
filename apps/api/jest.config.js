/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec|integration-spec)\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  // Most suites here are integration/e2e tests sharing one real local Postgres + Redis
  // instance (no per-worker schema/namespace isolation - see docs/open-items.md #12/#17/#18/
  // #30/#37). Jest's default parallel workers made cross-suite contention on that shared state
  // an increasingly frequent source of flaky failures as more real-DB suites were added across
  // Phase 4/5/7 - confirmed via `--runInBand` passing reliably where the default parallel mode
  // did not. Running serially trades some wall-clock time (tens of seconds, not minutes, at
  // this suite's current size) for deterministic results, which matters more here than speed.
  // Revisit if the suite grows large enough that serial execution becomes the bottleneck -
  // at that point, per-worker Postgres schemas/Redis key prefixes (docs/open-items.md #30's
  // "something more systematic") is the real fix, not just re-enabling parallelism.
  maxWorkers: 1,
};
