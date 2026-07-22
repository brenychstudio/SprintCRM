begin;

alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.research_snapshots enable row level security;
alter table public.message_templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.suppression_entries enable row level security;
alter table public.audit_events enable row level security;

create policy campaigns_select_org on public.campaigns
for select to authenticated
using (public.is_org_member(organization_id));
create policy campaigns_insert_org on public.campaigns
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy campaigns_update_org on public.campaigns
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy campaigns_delete_org on public.campaigns
for delete to authenticated
using (public.is_org_member(organization_id));

create policy campaign_members_select_org on public.campaign_members
for select to authenticated
using (public.is_org_member(organization_id));
create policy campaign_members_insert_org on public.campaign_members
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy campaign_members_update_org on public.campaign_members
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy campaign_members_delete_org on public.campaign_members
for delete to authenticated
using (public.is_org_member(organization_id));

create policy research_snapshots_select_org on public.research_snapshots
for select to authenticated
using (public.is_org_member(organization_id));
create policy research_snapshots_insert_org on public.research_snapshots
for insert to authenticated
with check (public.is_org_member(organization_id));

create policy message_templates_select_org on public.message_templates
for select to authenticated
using (public.is_org_member(organization_id));
create policy message_templates_insert_org on public.message_templates
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy message_templates_update_org on public.message_templates
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy message_templates_delete_org on public.message_templates
for delete to authenticated
using (public.is_org_member(organization_id));

create policy template_versions_select_org on public.template_versions
for select to authenticated
using (public.is_org_member(organization_id));
create policy template_versions_insert_org on public.template_versions
for insert to authenticated
with check (public.is_org_member(organization_id));

create policy outbound_messages_select_org on public.outbound_messages
for select to authenticated
using (public.is_org_member(organization_id));
create policy outbound_messages_insert_org on public.outbound_messages
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy outbound_messages_update_org on public.outbound_messages
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy outbound_messages_delete_org on public.outbound_messages
for delete to authenticated
using (public.is_org_member(organization_id));

create policy suppression_entries_select_org on public.suppression_entries
for select to authenticated
using (public.is_org_member(organization_id));
create policy suppression_entries_insert_org on public.suppression_entries
for insert to authenticated
with check (public.is_org_member(organization_id));
create policy suppression_entries_update_org on public.suppression_entries
for update to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy suppression_entries_delete_org on public.suppression_entries
for delete to authenticated
using (public.is_org_member(organization_id));

create policy audit_events_select_org on public.audit_events
for select to authenticated
using (public.is_org_member(organization_id));
create policy audit_events_insert_org on public.audit_events
for insert to authenticated
with check (public.is_org_member(organization_id));

commit;
