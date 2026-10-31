# Batch 1 tree guards

Scope: `migrations/010_tree_guards.sql` and `tests/batch1/tree-guards.test.ts`.
This implements the tree portion of D22 using the existing household/parent and
item/catalog indexes identified in D04. No new tables, columns, indexes,
dependencies, application checks, or other lanes' files are changed.

Both `BEFORE INSERT OR UPDATE OF ...` row trigger functions are explicitly
`VOLATILE`. Their first statement is
`PERFORM pg_advisory_xact_lock(hashtextextended(NEW.household_id, 0));`, matching
`service.ts`. Validation uses separate SQL statements after the lock so READ
COMMITTED writers see a preceding writer's commit even when the outer UPDATE
started before that commit. Ordinary writes cannot change `id` or `household_id`.

Items require a same-household SKU and, when parented, a same-household item with
the exact JSON boolean capability binding
`{"template_id":"container","values":{"can_contain":true}}`. A parent with
children cannot lose that capability. Catalog parents must be GROUPs; SKUs
cannot have children; a catalog node referenced by items must remain a SKU.
Self-parenting and cycles are rejected. Recursive queries carry a visited array
and stop on repetition, including when the proposed parent already belongs to
malformed historical data. Attaching to that malformed chain is rejected.

Tree violations use SQLSTATE `23514` and message prefixes:

- `TREE_IMMUTABLE_IDENTITY`
- `TREE_ITEM_SKU`, `TREE_ITEM_PARENT`, `TREE_ITEM_SELF_PARENT`, `TREE_ITEM_CYCLE`
- `TREE_CONTAINER_IN_USE`
- `TREE_CATALOG_PARENT`, `TREE_CATALOG_SELF_PARENT`, `TREE_CATALOG_CYCLE`
- `TREE_SKU_CHILDREN`, `TREE_SKU_IN_USE`

Existing schema constraints retain their own errors. Application error mapping
is outside this lane.

Name/display-name-only updates do not fire these guards. Contents is embedded
in `items.attributes`, so an attributes update necessarily fires its trigger
and takes the required lock. It returns before tree reads if the structural
fields and effective container capability are unchanged. Unrelated bindings,
including unknown bindings, remain untouched. This is not a historical-data
repair or a scan/validation of all existing rows.

## Test execution

No PostgreSQL URL was present locally. No database server or Docker was started.
The DB suite skips without `BATCH1_TEST_DATABASE_URL` or `DATABASE_URL` (the
Batch 1 variable takes precedence). With a URL, it connects to that server,
creates a uniquely named `acornary_test_tree_*` database, runs the actual baseline
migrations 001–008 plus 010, and drops that database afterward. The role needs
`CREATEDB`. It does not alter tables in the database named by the supplied URL.
A disposable database is necessary because migration 002 explicitly targets
the `public` schema. Other Batch 1 lanes' migrations are not tested here.

The root Vitest configuration includes only `tests/*.test.ts`; the requested
CLI command therefore reports “No test files found.” Use the following targeted
equivalent from this worktree without changing shared configuration:

```sh
node --input-type=module <<'NODE'
import { startVitest } from 'vitest/node';
const ctx = await startVitest([], {
  config: false,
  watch: false,
  include: ['tests/batch1/tree-*.test.ts'],
  reporters: ['dot'],
  testTimeout: 30000,
  hookTimeout: 30000,
});
await ctx.close();
NODE
```

Local checks:

- `../../node_modules/.bin/tsc --noEmit`: passed.
- `../../node_modules/.bin/vitest run tests/batch1/tree-*.test.ts --reporter=dot`:
  no files discovered because of the root config above.
- Targeted equivalent above: 25 DB cases skipped; 1 TREE04 TODO. These skips
  are not database acceptance evidence.
- `../../node_modules/.bin/vitest run tests/repair-batch0.test.ts tests/domain.test.ts --reporter=dot`:
  23 passed, 76 existing TODOs.

## Integrator acceptance still required

Run the targeted equivalent with an explicit test database URL. The suite uses
two real writer connections and a third observer. Before A commits, `pg_locks`
must show B waiting on A's advisory lock with the exact service household hash.
The polling interval only polls that barrier; it does not determine operation
overlap. Server statement timeouts, a bounded barrier wait, cancellation and
rollback bound failures. Deadlocks are never accepted as tree-validation
success: pre-commit deadlocks require a full snapshot rollback and at most
three attempts; a deadlock after A committed fails the test.

| Case   | Coverage                                                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TREE01 | Opposite item moves; loser returns `TREE_ITEM_CYCLE`; final graph is acyclic.                                                                                                      |
| TREE02 | Opposite GROUP moves; loser returns `TREE_CATALOG_CYCLE`; final graph is acyclic.                                                                                                  |
| TREE03 | Move versus capability removal, in both lock orders.                                                                                                                               |
| TREE04 | TODO: service integrator must wire rejection of non-READ COMMITTED writes after locking, while permitting read-only REPEATABLE READ.                                               |
| TREE05 | Rejected transaction also rolls back an earlier name edit; lock release and first-writer rollback allow subsequent valid writes.                                                   |
| TREE06 | Catalog move versus new item-to-SKU reference; both valid writes serialize and commit. SKU kind change versus reference creation rejects the invalid second write in either order. |

Additional cases cover both orders of child move versus GROUP-to-SKU conversion,
service-lock compatibility, INSERT and UPDATE validation, exact capability
types, immutable identities, historical cycles seeded before 010, atomic
multi-row cycle rejection, and name/contents update behavior.

Assumptions and boundaries:

- The concurrency guarantee is for READ COMMITTED writes, one household per
  transaction, as specified in `02-tree-concurrency.md`. Non-READ COMMITTED
  rejection is the app-level TREE04 integration task explicitly excluded by the
  lane assignment; 010 does not add that rejection. Direct SQL maintenance must
  also use READ COMMITTED. Stronger-isolation write safety is not claimed.
- TREE06 uses the existing item-to-SKU association. The future REFERENCE type
  and barcode-index maintenance are outside this change.
- Historical anomalies must be audited and repaired before production
  constraint rollout. The legacy fixtures exercise termination without
  disabling any trigger.
- The integrator must include this nested suite in the combined test runner
  and test migration ordering/error mapping alongside the other lanes.
  `vitest.config.ts`, `service.ts`, shared contracts and evidence remain untouched.

No ownership blocker was encountered. Live PostgreSQL acceptance and TREE04
application wiring remain outstanding; this document does not mark them passed.
