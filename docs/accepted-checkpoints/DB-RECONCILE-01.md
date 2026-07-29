# DB-RECONCILE-01 checkpoint

**Status:** Ready for task-owner acceptance

## Accepted production baseline

- CRM studio is linked with Supabase CLI; credentials remain local and ignored.
- Production evidence verified the effects of each tracked migration before repair.
- Local versions are unique and match remote history exactly: `20260222`, `20260427000001`, `20260427000002`, `20260427000003`.
- `supabase db push --dry-run` reports the remote database is up to date.
- No legacy migration SQL, production schema, or business data was replayed or changed.

## Recorded blocker

Docker Desktop is unavailable, so local `supabase start` / `supabase db reset` did not run. The repository also has an unversioned base schema and manual import fields absent from its tracked migrations. A later bootstrap/adoption task must address full from-zero reproducibility.

## Recommended next task

`OUTREACH-01R - Minimal Campaign Domain` may begin with additive migrations only. The manual import-schema drift remains out of scope and must not be changed incidentally.
