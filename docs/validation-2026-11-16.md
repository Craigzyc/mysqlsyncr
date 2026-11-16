# CAM validation — November 16, 2026

The CAM DBTemplate restored successfully on **MySQL 5.7.44 and 8.0.46** in
isolated Docker containers. Fresh comparison returned zero differences, a
second update made no changes, and independent INFORMATION_SCHEMA inventory
matched the template on both servers.

| Object | Expected and restored on each server |
|---|---:|
| Databases | 11 |
| Tables | 626 |
| Stored procedures | 221 |
| Triggers | 38 |
| Views | 2 |
| Foreign keys | 26 |

Both cross-version paths passed: an 8.0 dump restored on 5.7, and a 5.7 dump
restored on 8.0. The source CAM template was never edited; its content hash before
and after the matrix was
`3c463de1e50d8d59545b3738392bef4b669516b223c517528dae1ff074ad5e92`.

Remote `main` was fast-forwarded from `04d2673` to `a1061d4` before the review.
The baseline had foreign-key creation failures and could exit successfully with
an incomplete restore. The fixes and their regression tests are local changes.

## Coverage and evidence

See [full matrix results](validation/matrix-results.json) and
[supplemental engine results](validation/engine-results.json) for individual
cases, image identities, versions, SQL modes, timings, and outcomes.

Final local checks: **302 unit/HTTP tests in 25 suites**, **12 UI state tests**,
and **2 browser tests covering 8 workflow groups** passed. Backend and UI builds,
UI lint, modified-file syntax checks, and both runtime dependency audits passed. Development-tool advisories remain: 7 low in the backend tree; 2 low, 6 moderate and 6 high in the UI build tree.
Supplemental live engine checks passed **14 cases on 5.7 and 15 on 8.0**;
[dependency evidence](validation/dependency-results.json) additionally records
extra-table FK cycles, dependent view chains and cross-schema view orchestration.

The main matrix passed 17 CAM/interface cases and 9 performance cases per
version, followed by the two cross-version restores. The initial restore times
in that run were 47.3 seconds on 5.7 and 150.7 seconds on 8.0. These are local
Docker measurements with other containers running, not production benchmarks.

The tests deliberately changed column types/defaults/comments/order, removed
columns and added unexpected columns, reversed a composite index, removed a
primary key and AUTO_INCREMENT, removed tables/databases/procedures/triggers/
foreign keys, altered a view, and created an extra table. Every case required
detected drift, successful repair, and a fresh clean comparison. Synthetic CAM
rows were checked before and after repair. Seed tests verified insertion once
and preservation of an operator's existing row values.

Supplemental cases exercise quoted `NULL` and function-looking string defaults,
generated expressions, ON UPDATE, index prefixes, FULLTEXT and modern 8.0 index
features, foreign-key action changes and enforcement, invalid existing FK data,
unsafe narrowing, and failed view/procedure/trigger replacement. Recovered
routines and triggers were executed to verify that the original objects worked.

Performance tests generated real workloads, checked scans before and after an
index, tested duplicate-index classification, captured slow statements and
interval counters, created a real blocking transaction, observed a running
query, and tested empty/disabled collection. Optional AI context/redaction used
a mock provider; no schema or workload was sent to an external AI service.

CLI tests checked both source and packaged entry points, verified zero remaining
differences on success, and checked nonzero exits for bad scope and authentication.
Live API tests covered scoped comparison, bulk repair, reported failures, and
continued operation after authentication errors. Separate mocked HTTP tests
cover validation, cleanup/error propagation, origin/host checks, and dependency
phases without connecting to any database.

UI checks cover settings cancellation, password persistence removal, scoping,
hyphenated names, ignoring/showing findings, confirmation, single/bulk apply,
error recovery, stale performance responses, and desktop/mobile layout. The
repeatable browser suite uses mocked APIs; live read-only UI checks were also
performed against both MySQL versions.

## Changes

- Restore in global dependency phases, including foreign keys across schemas.
- Remove extra-table FK cycles in dependency order and defer dependent views
  only while other view creations make progress; unresolved dependencies fail.
- Compare authoritative CREATE definitions and detect previously missed column,
  index, foreign-key and table-option drift.
- Preserve quoted SQL content and account for version/session formatting.
- Verify completion, report metadata/apply failures, and return failure exit codes.
- Await connection authentication/closure and clean up failed connections.
- Preserve a working view on rejected replacement and recover a procedure/trigger
  after a rejected CREATE.
- Classify performance findings using index direction, type and visibility;
  unavailable/incomplete statistics produce unknown status, not a healthy result.
- Improve UI operation state, connection settings, scope, mobile layout and
  cross-schema bulk apply.
- Fix packaged entry-point metadata and update the compatible body-parser
  dependency and the UI follow-redirects dependency to address their reported advisories.

## Compatibility and boundaries

**Intentional UI access change:** the server now binds to `127.0.0.1` by default.
Remote access requires `--uiHost`; browser API requests must originate from the
UI itself. This closes the previous path where another website could borrow the
tool's startup database credentials. Passwords must be entered again after a
page reload because they are no longer saved to local storage.

DBTemplate is a **schema template with optional seed rows**, not a backup of all
historical/deployed data. Restoring the entire template does not reconstruct
historical rows that are absent from it. No deployed database was accessed.

MySQL 5.7 makes invisible indexes visible and substitutes unsupported 0900
collations with reported approximations. Sort, accent/case and trailing-space
semantics can differ. Expression defaults and functional indexes requiring 8.0
are not made equivalent on 5.7; unsupported DDL must report failure. The CAM
template's supported downgrade path passed the tests above. Relevant MySQL
references: [foreign keys](https://dev.mysql.com/doc/refman/8.0/en/create-table-foreign-keys.html),
[invisible indexes](https://dev.mysql.com/doc/refman/8.0/en/invisible-indexes.html),
[descending indexes](https://dev.mysql.com/doc/refman/8.0/en/descending-indexes.html).

DDL is not a single rollback-capable transaction. Routine/trigger replacement
has tested recovery on a rejected CREATE, but a lost connection or process crash
can still require manual recovery. Invalid foreign-key rows and destructive
type narrowing are rejected, not automatically deleted/truncated. The tested
surface is the CAM template plus the documented supplemental fixtures; stored
functions/events, arbitrary partition/CHECK migrations, production workloads,
and every possible SQL mode are outside this validation.

## Reproduce

```sh
npm ci
npm ci --prefix ui
npm test -- --runInBand
npm run test:ui
npm run build
npm run build --prefix ui
npm run test:browser
npm run test:integration -- --template /absolute/path/to/CAM/sql/DBTemplate --artifacts /outside/package/results
```

The integration harness owns its Docker instances, verifies their label and
loopback binding before any reset, uses only explicit test credentials, copies
the template, and records JSON evidence. Its deliberate mutations require
authorization for disposable test databases. Browser tests require an installed
Chrome/Playwright-compatible browser; see [UI test instructions](../ui/tests/README.md).
