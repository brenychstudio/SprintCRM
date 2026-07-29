# ADR 0002: AI is server-side and human-controlled

**Status:** Accepted for implementation planning on 2026-07-22.

AI jobs will use a Supabase Edge Function and validated structured outputs. The frontend may request work and render reviewed state, but it will never receive an OpenAI secret or send messages automatically.

Each job must store versioned output, prompt version, model configuration, usage/cost where available, failure state, and audit information. Gmail begins with approved-message to Gmail-draft handoff; the user sends in Gmail.
