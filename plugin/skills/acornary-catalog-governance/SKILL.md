---
name: acornary-catalog-governance
description: Propose and review Acornary household classification rules, exact one-time intake exceptions, or explicit catalog edits. Use when a branch needs confirmation, an expansion exceeds existing rules, or the user requests catalog governance.
---

# Catalog governance — workflow version 1

Read `get_catalog_policy` and relevant `get_intake_context` data in the current household. A historical directory is current state, never automatically a confirmed norm. Confirm only relevant branches on demand. Keep unknown facts unknown.

Construct one concrete `propose_catalog_change` proposal:

- **policy**: an existing branch, current policy revision and all dependent object/ancestor revisions; its meaning, boundaries, subdivision basis, naming guidance and enforceable naming limits; direct product permission; breadth/depth of allowed semantic extension; explicit aliases and their targets; product identity fields; separately marked historical exceptions; and the reason. Standard names are the referenced catalog names. Explain differences from the prior version and the affected scope. Do not create a huge catalog as a prerequisite.
- **intake_exception**: the complete exact intake body and reason for this purchase only. New top-level groups require this explicit authorization (`parent_id: null`, named `new_groups`). Confirmation creates no category, SKU or physical items; the later whole batch commit does that atomically. Once authorized, use the returned approval ID with that exact body. Do not reuse it for another purchase.
- **catalog_command**: the exact requested standalone create/rename/move or product identity attribute edit, its expected revisions and original idempotency key. Include the reason and user-visible effect. Standalone catalog operations are distinct from intake. The grant covers only that command. General merging and historical cleanup are outside this workflow.

Present the proposal through the Acornary confirmation card. The card explicitly offers either **仅批准本次** or **保存为长期规则**, according to the selected proposal type. If the user wants the other scope, submit the appropriate concrete alternative before approval. Never change the proposal silently after review. UI review and confirmation are app-only and server-bound to current identity, household, content and dependent versions; model output must not request, disclose or relay the challenge.

After a policy confirmation, read its new revision before daily intake. After a one-time grant, submit the exact original intent with its approval ID. A consumed grant cannot authorize a different operation. A stale dependency must be re-read and the proposal reconsidered; never swap revision numbers to force it through. Retry unknown outcomes with the original idempotency key and exact payload; confirmation retries use the same displayed card challenge until it expires.

Report what was confirmed, whether it is long-term or only this operation, what was actually committed, and what remains. Saving a rule never means the catalog was migrated. Preserve original identities, attributes and history; no historical record is automatically moved, merged or corrected.
