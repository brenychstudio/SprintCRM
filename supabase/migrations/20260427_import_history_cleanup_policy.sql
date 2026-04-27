begin;

drop policy if exists imports_delete_org on public.imports;

create policy imports_delete_org
on public.imports
for delete
to authenticated
using (public.is_org_member(org_id));

commit;
