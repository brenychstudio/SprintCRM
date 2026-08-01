# ADR 0004: Domain-restricted public research

**Status:** Accepted for OUTREACH-03B implementation; production activation pending smoke.

AI research is a supervised, single-contact operation. The Edge Function receives only permitted public campaign and lead context and validates the lead website before requesting OpenAI built-in web search. The normalized public company hostname is the sole allowed search domain; the function does not fetch supplied URLs directly.

The provider response is constrained to `research_v2`, source URLs are validated, and an immutable snapshot is created only after successful validation. Trusted Responses instructions are separate from the serialized public CRM input, which is treated as untrusted along with website content. Human-entered `proof_context` is the exclusive source of a recommended portfolio case: no proof context means no recommended case and the resolved-language no-proof warning; non-empty proof requires a recognizable matching case phrase and rejects an absent-proof contradiction. This limits fabricated attribution, prevents private contact data leaving SprintCRM, and retains human review before any later outreach work. Website-only confidence is capped at 0.85 and evidence is limited to two or three unique, concise, reviewable sources.
