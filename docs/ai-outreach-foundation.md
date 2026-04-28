# SprintCRM - AI Outreach Foundation

SprintCRM already contains the first technical foundation for the future AI Outreach MVP.

## Current foundation

The project includes a Supabase migration for the AI Outreach data layer:

```text
supabase/migrations/20260427_ai_outreach_foundation.sql
```

This foundation is intended to support AI-assisted outreach as a manual draft layer on top of the existing CRM workflow.

## Intended AI principles

- AI assists with drafting, structure, and workflow support.
- AI does not send messages automatically.
- The user remains responsible for review, copy, apply, and send actions.
- Generated drafts should be versioned rather than silently overwriting the lead snapshot.
- AI activity should be visible in the CRM activity history.

## Existing planned concepts

The AI Outreach layer is expected to work with:

- outreach draft generations;
- lead-level current outreach snapshot;
- channel, language, and variant selection;
- draft subject and body;
- personalization notes;
- apply/copy actions;
- future activity logging for generated/applied/copied drafts.

## Next implementation step

The next UI step is:

Task 38A - AI Outreach Draft Panel Shell

This task should add the first controlled AI Draft panel inside LeadDrawer, without real LLM generation yet.

The first UI shell should include:

- channel selector;
- language selector;
- variant selector;
- draft state area;
- manual-control copy;
- disabled or placeholder generate/apply/copy controls;
- no auto-send behavior.

## Notes

The AI foundation should remain additive. It should not replace the current CRM workflow:

import leads -> review lead -> plan next action -> log result -> track pipeline -> review reports
