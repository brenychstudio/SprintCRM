# ADR 0004: Domain-restricted public research

**Status:** Accepted for OUTREACH-03B implementation; production activation pending smoke.

AI research is a supervised, single-contact operation. The Edge Function receives only permitted public campaign and lead context and validates the lead website before requesting OpenAI built-in web search. The normalized public company hostname is the sole allowed search domain; the function does not fetch supplied URLs directly.

The provider response is constrained to `research_v1`, source URLs are validated, and an immutable snapshot is created only after successful validation. Human-entered `proof_context` is the exclusive source of a recommended portfolio case. No proof context means no recommended case and an explicit warning. This limits fabricated attribution, prevents private contact data leaving SprintCRM, and retains human review before any later outreach work.
