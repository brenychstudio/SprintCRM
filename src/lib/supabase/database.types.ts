export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          at: string
          channel: Database["public"]["Enums"]["activity_channel"] | null
          id: string
          lead_id: string
          meta: Json
          org_id: string
          owner: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          at?: string
          channel?: Database["public"]["Enums"]["activity_channel"] | null
          id?: string
          lead_id: string
          meta?: Json
          org_id?: string
          owner?: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          at?: string
          channel?: Database["public"]["Enums"]["activity_channel"] | null
          id?: string
          lead_id?: string
          meta?: Json
          org_id?: string
          owner?: string
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generations: {
        Row: {
          applied_at: string | null
          applied_to_lead: boolean
          body: string | null
          cached_input_tokens: number | null
          campaign_id: string | null
          campaign_member_id: string | null
          channel: string
          completed_at: string | null
          created_at: string
          created_by: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          estimated_cost_usd: number | null
          estimated_tokens: number | null
          generation_status: string
          id: string
          input_tokens: number | null
          input_snapshot: Json
          job_type: string
          language: string
          lead_id: string | null
          model_name: string | null
          output_payload: Json | null
          output_tokens: number | null
          org_id: string
          owner: string
          personalization_notes: string | null
          pricing_snapshot: Json | null
          prompt_version: string
          provider: string | null
          provider_request_id: string | null
          provider_response_id: string | null
          request_id: string | null
          schema_version: string | null
          started_at: string | null
          subject: string | null
          total_tokens: number | null
          type: string
          variant: string
        }
        Insert: {
          applied_at?: string | null
          applied_to_lead?: boolean
          body?: string | null
          cached_input_tokens?: number | null
          campaign_id?: string | null
          campaign_member_id?: string | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          estimated_tokens?: number | null
          generation_status?: string
          id?: string
          input_tokens?: number | null
          input_snapshot?: Json
          job_type?: string
          language?: string
          lead_id?: string | null
          model_name?: string | null
          output_payload?: Json | null
          output_tokens?: number | null
          org_id?: string
          owner?: string
          personalization_notes?: string | null
          pricing_snapshot?: Json | null
          prompt_version?: string
          provider?: string | null
          provider_request_id?: string | null
          provider_response_id?: string | null
          request_id?: string | null
          schema_version?: string | null
          started_at?: string | null
          subject?: string | null
          total_tokens?: number | null
          type?: string
          variant?: string
        }
        Update: {
          applied_at?: string | null
          applied_to_lead?: boolean
          body?: string | null
          cached_input_tokens?: number | null
          campaign_id?: string | null
          campaign_member_id?: string | null
          channel?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          estimated_tokens?: number | null
          generation_status?: string
          id?: string
          input_tokens?: number | null
          input_snapshot?: Json
          job_type?: string
          language?: string
          lead_id?: string | null
          model_name?: string | null
          output_payload?: Json | null
          output_tokens?: number | null
          org_id?: string
          owner?: string
          personalization_notes?: string | null
          pricing_snapshot?: Json | null
          prompt_version?: string
          provider?: string | null
          provider_request_id?: string | null
          provider_response_id?: string | null
          request_id?: string | null
          schema_version?: string | null
          started_at?: string | null
          subject?: string | null
          total_tokens?: number | null
          type?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_campaign_member_organization_fkey"
            columns: ["campaign_member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "campaign_members"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "ai_generations_campaign_organization_fkey"
            columns: ["campaign_id", "org_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "ai_generations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          organization_id: string
          payload: Json
          request_id: string | null
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          organization_id?: string
          payload?: Json
          request_id?: string | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_members: {
        Row: {
          added_by: string
          campaign_id: string
          created_at: string
          id: string
          last_error: string | null
          lead_id: string
          organization_id: string
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          added_by?: string
          campaign_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          lead_id: string
          organization_id?: string
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          added_by?: string
          campaign_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          lead_id?: string
          organization_id?: string
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_members_campaign_organization_fkey"
            columns: ["campaign_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "campaign_members_lead_organization_fkey"
            columns: ["lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string
          default_channel: string
          default_language: string
          description: string | null
          id: string
          name: string
          offer_summary: string | null
          organization_id: string
          proof_context: string | null
          status: string
          target_segment: string | null
          tone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          default_channel?: string
          default_language?: string
          description?: string | null
          id?: string
          name: string
          offer_summary?: string | null
          organization_id?: string
          proof_context?: string | null
          status?: string
          target_segment?: string | null
          tone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_channel?: string
          default_language?: string
          description?: string | null
          id?: string
          name?: string
          offer_summary?: string | null
          organization_id?: string
          proof_context?: string | null
          status?: string
          target_segment?: string | null
          tone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          dedup_rules: Json
          file_name: string
          id: string
          mapping_json: Json
          org_id: string
          owner: string
          reverted_at: string | null
          reverted_by: string | null
          rows_imported: number
          rows_skipped: number
          rows_total: number
          uploaded_at: string
        }
        Insert: {
          dedup_rules?: Json
          file_name: string
          id?: string
          mapping_json?: Json
          org_id?: string
          owner?: string
          reverted_at?: string | null
          reverted_by?: string | null
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          uploaded_at?: string
        }
        Update: {
          dedup_rules?: Json
          file_name?: string
          id?: string
          mapping_json?: Json
          org_id?: string
          owner?: string
          reverted_at?: string | null
          reverted_by?: string | null
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          company_name: string
          contact_name: string | null
          country_city: string | null
          created_at: string
          created_by: string
          current_outreach_body: string | null
          current_outreach_channel: string | null
          current_outreach_generation_id: string | null
          current_outreach_personalization_notes: string | null
          current_outreach_subject: string | null
          current_outreach_variant: string | null
          email: string | null
          email_norm: string | null
          id: string
          language: string | null
          last_touch_at: string
          next_action: Database["public"]["Enums"]["next_action"]
          next_action_at: string
          niche: string | null
          notes: string | null
          observed_issue: string | null
          offer_type: string | null
          org_id: string
          outreach_edited_manually: boolean
          outreach_generated_at: string | null
          owner: string
          phone: string | null
          phone_norm: string | null
          preferred_channel: string | null
          reply_status: string | null
          revenue: number | null
          sent_at: string | null
          service_interest: string | null
          source_file: string | null
          source_import_id: string | null
          stage: Database["public"]["Enums"]["lead_stage"]
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          website: string | null
          website_domain: string | null
          website_domain_norm: string | null
        }
        Insert: {
          company_name: string
          contact_name?: string | null
          country_city?: string | null
          created_at?: string
          created_by?: string
          current_outreach_body?: string | null
          current_outreach_channel?: string | null
          current_outreach_generation_id?: string | null
          current_outreach_personalization_notes?: string | null
          current_outreach_subject?: string | null
          current_outreach_variant?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          language?: string | null
          last_touch_at?: string
          next_action?: Database["public"]["Enums"]["next_action"]
          next_action_at?: string
          niche?: string | null
          notes?: string | null
          observed_issue?: string | null
          offer_type?: string | null
          org_id?: string
          outreach_edited_manually?: boolean
          outreach_generated_at?: string | null
          owner?: string
          phone?: string | null
          phone_norm?: string | null
          preferred_channel?: string | null
          reply_status?: string | null
          revenue?: number | null
          sent_at?: string | null
          service_interest?: string | null
          source_file?: string | null
          source_import_id?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          website?: string | null
          website_domain?: string | null
          website_domain_norm?: string | null
        }
        Update: {
          company_name?: string
          contact_name?: string | null
          country_city?: string | null
          created_at?: string
          created_by?: string
          current_outreach_body?: string | null
          current_outreach_channel?: string | null
          current_outreach_generation_id?: string | null
          current_outreach_personalization_notes?: string | null
          current_outreach_subject?: string | null
          current_outreach_variant?: string | null
          email?: string | null
          email_norm?: string | null
          id?: string
          language?: string | null
          last_touch_at?: string
          next_action?: Database["public"]["Enums"]["next_action"]
          next_action_at?: string
          niche?: string | null
          notes?: string | null
          observed_issue?: string | null
          offer_type?: string | null
          org_id?: string
          outreach_edited_manually?: boolean
          outreach_generated_at?: string | null
          owner?: string
          phone?: string | null
          phone_norm?: string | null
          preferred_channel?: string | null
          reply_status?: string | null
          revenue?: number | null
          sent_at?: string | null
          service_interest?: string | null
          source_file?: string | null
          source_import_id?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          website?: string | null
          website_domain?: string | null
          website_domain_norm?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_current_outreach_generation_fk"
            columns: ["current_outreach_generation_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          channel: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          language: string
          name: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          language?: string
          name: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          language?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      outbound_messages: {
        Row: {
          ai_generation_id: string | null
          approved_at: string | null
          approved_by: string | null
          body: string
          campaign_member_id: string
          channel: string
          created_at: string
          created_by: string
          failure_code: string | null
          failure_message: string | null
          id: string
          language: string
          organization_id: string
          research_snapshot_id: string | null
          sent_at: string | null
          source: string
          status: string
          subject: string | null
          template_version_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          ai_generation_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body: string
          campaign_member_id: string
          channel?: string
          created_at?: string
          created_by?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          language?: string
          organization_id?: string
          research_snapshot_id?: string | null
          sent_at?: string | null
          source?: string
          status?: string
          subject?: string | null
          template_version_id?: string | null
          updated_at?: string
          version: number
        }
        Update: {
          ai_generation_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          campaign_member_id?: string
          channel?: string
          created_at?: string
          created_by?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          language?: string
          organization_id?: string
          research_snapshot_id?: string | null
          sent_at?: string | null
          source?: string
          status?: string
          subject?: string | null
          template_version_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_ai_generation_organization_fkey"
            columns: ["ai_generation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "outbound_messages_campaign_member_organization_fkey"
            columns: ["campaign_member_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "campaign_members"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "outbound_messages_research_snapshot_organization_fkey"
            columns: ["research_snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "research_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "outbound_messages_template_version_organization_fkey"
            columns: ["template_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "template_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      research_snapshots: {
        Row: {
          ai_generation_id: string | null
          campaign_member_id: string
          confidence: number | null
          created_at: string
          created_by: string
          evidence: Json
          id: string
          observed_opportunity: string | null
          organization_id: string
          recommended_case: string | null
          recommended_offer: string | null
          source: string
          version: number
          warnings: Json
        }
        Insert: {
          ai_generation_id?: string | null
          campaign_member_id: string
          confidence?: number | null
          created_at?: string
          created_by?: string
          evidence?: Json
          id?: string
          observed_opportunity?: string | null
          organization_id?: string
          recommended_case?: string | null
          recommended_offer?: string | null
          source?: string
          version: number
          warnings?: Json
        }
        Update: {
          ai_generation_id?: string | null
          campaign_member_id?: string
          confidence?: number | null
          created_at?: string
          created_by?: string
          evidence?: Json
          id?: string
          observed_opportunity?: string | null
          organization_id?: string
          recommended_case?: string | null
          recommended_offer?: string | null
          source?: string
          version?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "research_snapshots_ai_generation_organization_fkey"
            columns: ["ai_generation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "research_snapshots_campaign_member_organization_fkey"
            columns: ["campaign_member_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "campaign_members"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      suppression_entries: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean
          organization_id: string
          reason: string | null
          source: string
          subject_type: string
          subject_value: string
          subject_value_normalized: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          reason?: string | null
          source?: string
          subject_type: string
          subject_value: string
          subject_value_normalized?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          reason?: string | null
          source?: string
          subject_type?: string
          subject_value?: string
          subject_value_normalized?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppression_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      template_versions: {
        Row: {
          body_template: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          organization_id: string
          subject_template: string | null
          template_id: string
          variables: Json
          version: number
        }
        Insert: {
          body_template: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          organization_id?: string
          subject_template?: string | null
          template_id: string
          variables?: Json
          version: number
        }
        Update: {
          body_template?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          organization_id?: string
          subject_template?: string | null
          template_id?: string
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "template_versions_template_organization_fkey"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      finish_ai_runtime_probe: {
        Args: {
          p_actor_user_id: string
          p_cached_input_tokens: number | null
          p_duration_ms: number | null
          p_error_code: string | null
          p_error_message: string | null
          p_input_tokens: number | null
          p_job_id: string
          p_output_payload: Json | null
          p_output_tokens: number | null
          p_provider_request_id: string | null
          p_provider_response_id: string | null
          p_status: string
          p_total_tokens: number | null
        }
        Returns: Database["public"]["Tables"]["ai_generations"]["Row"]
        SetofOptions: { from: "*"; to: "ai_generations"; isOneToOne: true; isSetofReturn: false }
      }
      start_ai_runtime_probe: {
        Args: { p_actor_user_id: string; p_campaign_member_id: string; p_model: string; p_request_id: string }
        Returns: {
          cached_input_tokens: number | null
          duration_ms: number | null
          estimated_cost_usd: number | null
          generation_status: string
          input_tokens: number | null
          job_id: string
          model_name: string | null
          output_tokens: number | null
          request_id: string | null
          schema_version: string | null
          total_tokens: number | null
          was_created: boolean
        }[]
      }
      add_campaign_members: {
        Args: { p_campaign_id: string; p_lead_ids: string[] }
        Returns: {
          campaign_member_id: string
          lead_id: string
          outcome: string
          reason: string
        }[]
      }
      approve_manual_outbound_message: {
        Args: { p_outbound_message_id: string }
        Returns: {
          ai_generation_id: string | null
          approved_at: string | null
          approved_by: string | null
          body: string
          campaign_member_id: string
          channel: string
          created_at: string
          created_by: string
          failure_code: string | null
          failure_message: string | null
          id: string
          language: string
          organization_id: string
          research_snapshot_id: string | null
          sent_at: string | null
          source: string
          status: string
          subject: string | null
          template_version_id: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "outbound_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_manual_campaign: {
        Args: {
          p_default_channel: string
          p_default_language: string
          p_description: string
          p_name: string
          p_offer_summary: string
          p_proof_context: string
          p_target_segment: string
          p_tone: string
        }
        Returns: {
          created_at: string
          created_by: string
          default_channel: string
          default_language: string
          description: string | null
          id: string
          name: string
          offer_summary: string | null
          organization_id: string
          proof_context: string | null
          status: string
          target_segment: string | null
          tone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_ai_research_job: {
        Args: { p_actor_user_id: string; p_cached_input_tokens: number | null; p_duration_ms: number; p_error_code: string | null; p_error_message: string | null; p_input_tokens: number | null; p_job_id: string; p_output_payload: Json | null; p_output_tokens: number | null; p_provider_request_id: string | null; p_provider_response_id: string | null; p_status: string; p_total_tokens: number | null }
        Returns: { cached_input_tokens: number | null; duration_ms: number | null; estimated_cost_usd: number | null; generation_status: string; input_tokens: number | null; job_id: string; model_name: string | null; output_tokens: number | null; request_id: string | null; research_snapshot_id: string | null; research_version: number | null; schema_version: string | null; total_tokens: number | null }[]
      }
      fail_stale_ai_research_job: {
        Args: { p_actor_user_id: string; p_error_code: string; p_job_id: string }
        Returns: Database["public"]["Tables"]["ai_generations"]["Row"]
        SetofOptions: { from: "*"; to: "ai_generations"; isOneToOne: true; isSetofReturn: false }
      }
      start_ai_research_job: {
        Args: { p_actor_user_id: string; p_campaign_member_id: string; p_model: string; p_prompt_version: string; p_request_id: string }
        Returns: { cached_input_tokens: number | null; duration_ms: number | null; estimated_cost_usd: number | null; generation_status: string; input_tokens: number | null; job_id: string; model_name: string | null; output_tokens: number | null; request_id: string | null; schema_version: string | null; total_tokens: number | null; was_created: boolean }[]
      }
      current_org_id: { Args: never; Returns: string }
      default_next_step_for_stage: {
        Args: {
          p_base_at?: string
          p_stage: Database["public"]["Enums"]["lead_stage"]
          p_tz?: string
        }
        Returns: {
          next_action: Database["public"]["Enums"]["next_action"]
          next_action_at: string
        }[]
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      save_manual_outbound_message: {
        Args: {
          p_body: string
          p_campaign_member_id: string
          p_channel: string
          p_language: string
          p_research_snapshot_id: string
          p_subject: string
          p_submission_status: string
          p_template_version_id: string
        }
        Returns: {
          ai_generation_id: string | null
          approved_at: string | null
          approved_by: string | null
          body: string
          campaign_member_id: string
          channel: string
          created_at: string
          created_by: string
          failure_code: string | null
          failure_message: string | null
          id: string
          language: string
          organization_id: string
          research_snapshot_id: string | null
          sent_at: string | null
          source: string
          status: string
          subject: string | null
          template_version_id: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "outbound_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_manual_research_snapshot: {
        Args: {
          p_campaign_member_id: string
          p_confidence: number
          p_evidence: Json
          p_observed_opportunity: string
          p_recommended_case: string
          p_recommended_offer: string
          p_warnings: Json
        }
        Returns: {
          ai_generation_id: string | null
          campaign_member_id: string
          confidence: number | null
          created_at: string
          created_by: string
          evidence: Json
          id: string
          observed_opportunity: string | null
          organization_id: string
          recommended_case: string | null
          recommended_offer: string | null
          source: string
          version: number
          warnings: Json
        }
        SetofOptions: {
          from: "*"
          to: "research_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      skip_manual_campaign_member: {
        Args: { p_campaign_member_id: string; p_reason?: string }
        Returns: {
          added_by: string
          campaign_id: string
          created_at: string
          id: string
          last_error: string | null
          lead_id: string
          organization_id: string
          skip_reason: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "campaign_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_manual_campaign: {
        Args: {
          p_campaign_id: string
          p_default_channel: string
          p_default_language: string
          p_description: string
          p_name: string
          p_offer_summary: string
          p_proof_context: string
          p_status: string
          p_target_segment: string
          p_tone: string
        }
        Returns: {
          created_at: string
          created_by: string
          default_channel: string
          default_language: string
          description: string | null
          id: string
          name: string
          offer_summary: string | null
          organization_id: string
          proof_context: string | null
          status: string
          target_segment: string | null
          tone: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      activity_channel: "email" | "ig" | "linkedin" | "other"
      activity_type:
        | "imported"
        | "contacted"
        | "replied"
        | "proposal_sent"
        | "won"
        | "lost"
        | "note"
        | "stage_changed"
        | "next_action_set"
        | "ai_draft_generated"
        | "ai_draft_applied"
        | "ai_draft_copied"
        | "outreach_sent"
        | "followup_scheduled"
        | "reply_marked"
        | "manual_edit"
        | "campaign_added"
        | "research_saved"
        | "outreach_draft_saved"
        | "outreach_approved"
        | "campaign_skipped"
      lead_stage: "new" | "contacted" | "replied" | "proposal" | "won" | "lost"
      lead_status: "active" | "archived"
      next_action: "follow_up" | "send_proposal" | "request_call" | "nurture"
      org_role: "owner" | "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_channel: ["email", "ig", "linkedin", "other"],
      activity_type: [
        "imported",
        "contacted",
        "replied",
        "proposal_sent",
        "won",
        "lost",
        "note",
        "stage_changed",
        "next_action_set",
        "ai_draft_generated",
        "ai_draft_applied",
        "ai_draft_copied",
        "outreach_sent",
        "followup_scheduled",
        "reply_marked",
        "manual_edit",
        "campaign_added",
        "research_saved",
        "outreach_draft_saved",
        "outreach_approved",
        "campaign_skipped",
      ],
      lead_stage: ["new", "contacted", "replied", "proposal", "won", "lost"],
      lead_status: ["active", "archived"],
      next_action: ["follow_up", "send_proposal", "request_call", "nurture"],
      org_role: ["owner", "admin", "member"],
    },
  },
} as const
