begin;

drop policy if exists leads_delete_org on public.leads;
create policy leads_delete_org
on public.leads
for delete
to authenticated
using (public.is_org_member(org_id));

drop policy if exists activities_delete_org on public.activities;
create policy activities_delete_org
on public.activities
for delete
to authenticated
using (public.is_org_member(org_id));

drop policy if exists imports_update_org on public.imports;
create policy imports_update_org
on public.imports
for update
to authenticated
using (public.is_org_member(org_id))
with check (public.is_org_member(org_id));

commit;
