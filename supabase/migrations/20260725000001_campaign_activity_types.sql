begin;

alter type public.activity_type add value if not exists 'campaign_added';
alter type public.activity_type add value if not exists 'research_saved';
alter type public.activity_type add value if not exists 'outreach_draft_saved';
alter type public.activity_type add value if not exists 'outreach_approved';
alter type public.activity_type add value if not exists 'campaign_skipped';

commit;
