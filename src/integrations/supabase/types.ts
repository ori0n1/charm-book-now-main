export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      appointment_services: {
        Row: {
          appointment_id: string;
          duration_min: number;
          id: string;
          is_upsell: boolean;
          price: number;
          service_id: string;
        };
        Insert: {
          appointment_id: string;
          duration_min: number;
          id?: string;
          is_upsell?: boolean;
          price: number;
          service_id: string;
        };
        Update: {
          appointment_id?: string;
          duration_min?: number;
          id?: string;
          is_upsell?: boolean;
          price?: number;
          service_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointment_services_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      appointments: {
        Row: {
          cancellation_reason: string | null;
          client_id: string;
          confirmation_sent_at: string | null;
          created_at: string;
          ends_at: string;
          id: string;
          notes: string | null;
          reminder_sent_at: string | null;
          staff_id: string;
          starts_at: string;
          status: Database["public"]["Enums"]["appointment_status"];
          studio_id: string;
          total_duration_min: number;
          total_price: number;
          updated_at: string;
        };
        Insert: {
          cancellation_reason?: string | null;
          client_id: string;
          confirmation_sent_at?: string | null;
          created_at?: string;
          ends_at: string;
          id?: string;
          notes?: string | null;
          reminder_sent_at?: string | null;
          staff_id: string;
          starts_at: string;
          status?: Database["public"]["Enums"]["appointment_status"];
          studio_id: string;
          total_duration_min?: number;
          total_price?: number;
          updated_at?: string;
        };
        Update: {
          cancellation_reason?: string | null;
          client_id?: string;
          confirmation_sent_at?: string | null;
          created_at?: string;
          ends_at?: string;
          id?: string;
          notes?: string | null;
          reminder_sent_at?: string | null;
          staff_id?: string;
          starts_at?: string;
          status?: Database["public"]["Enums"]["appointment_status"];
          studio_id?: string;
          total_duration_min?: number;
          total_price?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "appointments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_payment_requests: {
        Row: {
          appointment_id: string | null;
          client_email: string | null;
          client_name: string;
          client_phone: string;
          created_at: string;
          ends_at: string;
          expires_at: string;
          failure_reason: string | null;
          id: string;
          notes: string | null;
          service_ids: string[];
          staff_id: string;
          starts_at: string;
          status: string;
          studio_id: string;
          total_duration_min: number;
          total_price: number;
          updated_at: string;
        };
        Insert: {
          appointment_id?: string | null;
          client_email?: string | null;
          client_name: string;
          client_phone: string;
          created_at?: string;
          ends_at: string;
          expires_at?: string;
          failure_reason?: string | null;
          id?: string;
          notes?: string | null;
          service_ids: string[];
          staff_id: string;
          starts_at: string;
          status?: string;
          studio_id: string;
          total_duration_min?: number;
          total_price?: number;
          updated_at?: string;
        };
        Update: {
          appointment_id?: string | null;
          client_email?: string | null;
          client_name?: string;
          client_phone?: string;
          created_at?: string;
          ends_at?: string;
          expires_at?: string;
          failure_reason?: string | null;
          id?: string;
          notes?: string | null;
          service_ids?: string[];
          staff_id?: string;
          starts_at?: string;
          status?: string;
          studio_id?: string;
          total_duration_min?: number;
          total_price?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_payment_requests_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_payment_requests_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_payment_requests_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_policy_acceptances: {
        Row: {
          accepted_at: string;
          appointment_id: string | null;
          booking_request_id: string | null;
          id: string;
          ip_address: string | null;
          payload: Json;
          payment_timestamp: string | null;
          policy_version: string;
          studio_id: string;
          user_agent: string | null;
        };
        Insert: {
          accepted_at?: string;
          appointment_id?: string | null;
          booking_request_id?: string | null;
          id?: string;
          ip_address?: string | null;
          payload?: Json;
          payment_timestamp?: string | null;
          policy_version: string;
          studio_id: string;
          user_agent?: string | null;
        };
        Update: {
          accepted_at?: string;
          appointment_id?: string | null;
          booking_request_id?: string | null;
          id?: string;
          ip_address?: string | null;
          payload?: Json;
          payment_timestamp?: string | null;
          policy_version?: string;
          studio_id?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_policy_acceptances_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_policy_acceptances_booking_request_id_fkey";
            columns: ["booking_request_id"];
            isOneToOne: false;
            referencedRelation: "booking_payment_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_policy_acceptances_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          created_at: string;
          date_of_birth: string | null;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string;
          studio_id: string;
          total_spent: number;
          total_visits: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date_of_birth?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone: string;
          studio_id: string;
          total_spent?: number;
          total_visits?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date_of_birth?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string;
          studio_id?: string;
          total_spent?: number;
          total_visits?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications_log: {
        Row: {
          appointment_id: string | null;
          channel: string;
          created_at: string;
          error: string | null;
          id: string;
          kind: string;
          payload: Json | null;
          recipient: string;
          status: string;
          studio_id: string;
        };
        Insert: {
          appointment_id?: string | null;
          channel: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind: string;
          payload?: Json | null;
          recipient: string;
          status?: string;
          studio_id: string;
        };
        Update: {
          appointment_id?: string | null;
          channel?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          payload?: Json | null;
          recipient?: string;
          status?: string;
          studio_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_log_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_log_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      onboarding_progress: {
        Row: {
          completed_at: string;
          id: string;
          step: string;
          studio_id: string;
        };
        Insert: {
          completed_at?: string;
          id?: string;
          step: string;
          studio_id: string;
        };
        Update: {
          completed_at?: string;
          id?: string;
          step?: string;
          studio_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_intents: {
        Row: {
          amount_cents: number;
          appointment_id: string | null;
          booking_request_id: string | null;
          client_secret: string | null;
          created_at: string;
          currency: string;
          expires_at: string | null;
          hosted_voucher_url: string | null;
          id: string;
          method: string;
          multibanco_entity: string | null;
          multibanco_reference: string | null;
          status: string;
          stripe_payment_intent_id: string | null;
          studio_id: string;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          appointment_id?: string | null;
          booking_request_id?: string | null;
          client_secret?: string | null;
          created_at?: string;
          currency?: string;
          expires_at?: string | null;
          hosted_voucher_url?: string | null;
          id?: string;
          method: string;
          multibanco_entity?: string | null;
          multibanco_reference?: string | null;
          status?: string;
          stripe_payment_intent_id?: string | null;
          studio_id: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          appointment_id?: string | null;
          booking_request_id?: string | null;
          client_secret?: string | null;
          created_at?: string;
          currency?: string;
          expires_at?: string | null;
          hosted_voucher_url?: string | null;
          id?: string;
          method?: string;
          multibanco_entity?: string | null;
          multibanco_reference?: string | null;
          status?: string;
          stripe_payment_intent_id?: string | null;
          studio_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_intents_booking_request_id_fkey";
            columns: ["booking_request_id"];
            isOneToOne: false;
            referencedRelation: "booking_payment_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_message_logs: {
        Row: {
          appointment_id: string | null;
          created_at: string;
          id: string;
          idempotency_key: string;
          message: string | null;
          payload: Json;
          payment_intent_id: string | null;
          provider: string;
          provider_message_id: string | null;
          reason: string | null;
          recipient_phone: string | null;
          status: string;
          studio_id: string;
          updated_at: string;
        };
        Insert: {
          appointment_id?: string | null;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          message?: string | null;
          payload?: Json;
          payment_intent_id?: string | null;
          provider?: string;
          provider_message_id?: string | null;
          reason?: string | null;
          recipient_phone?: string | null;
          status: string;
          studio_id: string;
          updated_at?: string;
        };
        Update: {
          appointment_id?: string | null;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          message?: string | null;
          payload?: Json;
          payment_intent_id?: string | null;
          provider?: string;
          provider_message_id?: string | null;
          reason?: string | null;
          recipient_phone?: string | null;
          status?: string;
          studio_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_logs_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_message_logs_payment_intent_id_fkey";
            columns: ["payment_intent_id"];
            isOneToOne: false;
            referencedRelation: "payment_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_message_logs_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      refund_requests: {
        Row: {
          appointment_id: string | null;
          booking_request_id: string | null;
          client_email: string | null;
          client_name: string | null;
          client_phone: string | null;
          created_at: string;
          decision_note: string | null;
          id: string;
          payment_intent_id: string | null;
          reason: string;
          reviewed_at: string | null;
          status: string;
          studio_id: string;
          updated_at: string;
        };
        Insert: {
          appointment_id?: string | null;
          booking_request_id?: string | null;
          client_email?: string | null;
          client_name?: string | null;
          client_phone?: string | null;
          created_at?: string;
          decision_note?: string | null;
          id?: string;
          payment_intent_id?: string | null;
          reason: string;
          reviewed_at?: string | null;
          status?: string;
          studio_id: string;
          updated_at?: string;
        };
        Update: {
          appointment_id?: string | null;
          booking_request_id?: string | null;
          client_email?: string | null;
          client_name?: string | null;
          client_phone?: string | null;
          created_at?: string;
          decision_note?: string | null;
          id?: string;
          payment_intent_id?: string | null;
          reason?: string;
          reviewed_at?: string | null;
          status?: string;
          studio_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "refund_requests_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refund_requests_booking_request_id_fkey";
            columns: ["booking_request_id"];
            isOneToOne: false;
            referencedRelation: "booking_payment_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refund_requests_payment_intent_id_fkey";
            columns: ["payment_intent_id"];
            isOneToOne: false;
            referencedRelation: "payment_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "refund_requests_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      service_categories: {
        Row: {
          created_at: string;
          id: string;
          label: string;
          sort_order: number;
          studio_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          label: string;
          sort_order?: number;
          studio_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          label?: string;
          sort_order?: number;
          studio_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_categories_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      service_category_suggestions: {
        Row: {
          created_at: string;
          id: string;
          invite_code: string | null;
          invite_expires_at: string | null;
          invite_role: string | null;
          invite_status: string | null;
          invite_token: string | null;
          is_active: boolean;
          label: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          label: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          label?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      services: {
        Row: {
          category_id: string | null;
          created_at: string;
          description: string | null;
          duration_min: number;
          id: string;
          is_active: boolean;
          is_recommended: boolean;
          media: Json;
          name: string;
          price: number;
          commission_percent: number | null;
          deposit_professional_percent: number | null;
          deposit_recipient: string | null;
          sort_order: number;
          studio_id: string;
          updated_at: string;
        };
        Insert: {
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          duration_min: number;
          id?: string;
          is_active?: boolean;
          is_recommended?: boolean;
          media?: Json;
          name: string;
          price: number;
          commission_percent?: number | null;
          deposit_professional_percent?: number | null;
          deposit_recipient?: string | null;
          sort_order?: number;
          studio_id: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          duration_min?: number;
          id?: string;
          is_active?: boolean;
          is_recommended?: boolean;
          media?: Json;
          name?: string;
          price?: number;
          commission_percent?: number | null;
          deposit_professional_percent?: number | null;
          deposit_recipient?: string | null;
          sort_order?: number;
          studio_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "service_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "services_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      staff: {
        Row: {
          bio: string | null;
          created_at: string;
          current_status: string | null;
          id: string;
          is_active: boolean;
          name: string;
          photo_url: string | null;
          rating: number | null;
          reviews_count: number;
          role: string | null;
          commission_percent: number | null;
          deposit_professional_percent: number | null;
          deposit_recipient: string | null;
          sort_order: number;
          studio_id: string;
          updated_at: string;
          user_id: string | null;
          whatsapp: string | null;
        };
        Insert: {
          bio?: string | null;
          created_at?: string;
          current_status?: string | null;
          id?: string;
          invite_code?: string | null;
          invite_expires_at?: string | null;
          invite_role?: string | null;
          invite_status?: string | null;
          invite_token?: string | null;
          is_active?: boolean;
          name: string;
          photo_url?: string | null;
          rating?: number | null;
          reviews_count?: number;
          role?: string | null;
          commission_percent?: number | null;
          deposit_professional_percent?: number | null;
          deposit_recipient?: string | null;
          sort_order?: number;
          studio_id: string;
          updated_at?: string;
          user_id?: string | null;
          whatsapp?: string | null;
        };
        Update: {
          bio?: string | null;
          created_at?: string;
          current_status?: string | null;
          id?: string;
          invite_code?: string | null;
          invite_expires_at?: string | null;
          invite_role?: string | null;
          invite_status?: string | null;
          invite_token?: string | null;
          is_active?: boolean;
          name?: string;
          photo_url?: string | null;
          rating?: number | null;
          reviews_count?: number;
          role?: string | null;
          commission_percent?: number | null;
          deposit_professional_percent?: number | null;
          deposit_recipient?: string | null;
          sort_order?: number;
          studio_id?: string;
          updated_at?: string;
          user_id?: string | null;
          whatsapp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "staff_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_availability: {
        Row: {
          end_time: string;
          id: string;
          staff_id: string;
          start_time: string;
          studio_id: string;
          weekday: number;
        };
        Insert: {
          end_time: string;
          id?: string;
          staff_id: string;
          start_time: string;
          studio_id: string;
          weekday: number;
        };
        Update: {
          end_time?: string;
          id?: string;
          staff_id?: string;
          start_time?: string;
          studio_id?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "staff_availability_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_availability_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_services: {
        Row: {
          service_id: string;
          staff_id: string;
        };
        Insert: {
          service_id: string;
          staff_id: string;
        };
        Update: {
          service_id?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_services_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_services_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_time_off: {
        Row: {
          ends_at: string;
          id: string;
          reason: string | null;
          staff_id: string;
          starts_at: string;
          studio_id: string;
        };
        Insert: {
          ends_at: string;
          id?: string;
          reason?: string | null;
          staff_id: string;
          starts_at: string;
          studio_id: string;
        };
        Update: {
          ends_at?: string;
          id?: string;
          reason?: string | null;
          staff_id?: string;
          starts_at?: string;
          studio_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_time_off_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_time_off_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
      studio_reviews: {
        Row: {
          id: string;
          studio_id: string;
          user_id: string;
          appointment_id: string | null;
          rating: number;
          comment: string | null;
          staff_ids: string[];
          reviewer_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          studio_id: string;
          user_id: string;
          appointment_id?: string | null;
          rating: number;
          comment?: string | null;
          staff_ids?: string[];
          reviewer_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          studio_id?: string;
          user_id?: string;
          appointment_id?: string | null;
          rating?: number;
          comment?: string | null;
          staff_ids?: string[];
          reviewer_name?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "studio_reviews_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "studio_reviews_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
        ];
      };
      studios: {
        Row: {
          accepted_payment_methods: string[];
          business_segment: string;
          brand_color: string | null;
          cancellation_after_deadline_policy: string;
          cancellation_min_notice_hours: number;
          cancellation_policy_text: string | null;
          commission_percent: number;
          created_at: string;
          currency: string;
          deposit_percent: number;
          deposit_professional_percent: number;
          deposit_recipient: string;
          description: string | null;
          email: string | null;
          hero_gallery_urls: Json;
          hero_image_url: string | null;
          id: string;
          instagram: string | null;
          is_active: boolean;
          location: string | null;
          logo_url: string | null;
          min_booking_notice_min: number;
          name: string;
          onboarding_completed_at: string | null;
          owner_name: string | null;
          payment_policy: string;
          phone: string | null;
          plan: Database["public"]["Enums"]["subscription_plan"];
          public_amenities: Json;
          rating: number | null;
          refund_requests_enabled: boolean;
          reviews_count: number;
          slug: string;
          tagline: string | null;
          timezone: string;
          trial_ends_at: string | null;
          updated_at: string;
          whatsapp: string | null;
          whatsapp_auto_send_enabled: boolean;
          whatsapp_default_message: string | null;
          legal_policy_version: string;
        };
        Insert: {
          accepted_payment_methods?: string[];
          business_segment?: string;
          brand_color?: string | null;
          cancellation_after_deadline_policy?: string;
          cancellation_min_notice_hours?: number;
          cancellation_policy_text?: string | null;
          commission_percent?: number;
          created_at?: string;
          currency?: string;
          deposit_percent?: number;
          deposit_professional_percent?: number;
          deposit_recipient?: string;
          description?: string | null;
          email?: string | null;
          hero_gallery_urls?: Json;
          hero_image_url?: string | null;
          id?: string;
          instagram?: string | null;
          is_active?: boolean;
          location?: string | null;
          logo_url?: string | null;
          min_booking_notice_min?: number;
          name: string;
          onboarding_completed_at?: string | null;
          owner_name?: string | null;
          payment_policy?: string;
          phone?: string | null;
          plan?: Database["public"]["Enums"]["subscription_plan"];
          public_amenities?: Json;
          rating?: number | null;
          refund_requests_enabled?: boolean;
          reviews_count?: number;
          slug: string;
          tagline?: string | null;
          timezone?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
          whatsapp_auto_send_enabled?: boolean;
          whatsapp_default_message?: string | null;
          legal_policy_version?: string;
        };
        Update: {
          accepted_payment_methods?: string[];
          business_segment?: string;
          brand_color?: string | null;
          cancellation_after_deadline_policy?: string;
          cancellation_min_notice_hours?: number;
          cancellation_policy_text?: string | null;
          commission_percent?: number;
          created_at?: string;
          currency?: string;
          deposit_percent?: number;
          deposit_professional_percent?: number;
          deposit_recipient?: string;
          description?: string | null;
          email?: string | null;
          hero_gallery_urls?: Json;
          hero_image_url?: string | null;
          id?: string;
          instagram?: string | null;
          is_active?: boolean;
          location?: string | null;
          logo_url?: string | null;
          min_booking_notice_min?: number;
          name?: string;
          onboarding_completed_at?: string | null;
          owner_name?: string | null;
          payment_policy?: string;
          phone?: string | null;
          plan?: Database["public"]["Enums"]["subscription_plan"];
          public_amenities?: Json;
          rating?: number | null;
          refund_requests_enabled?: boolean;
          reviews_count?: number;
          slug?: string;
          tagline?: string | null;
          timezone?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
          whatsapp_auto_send_enabled?: boolean;
          whatsapp_default_message?: string | null;
          legal_policy_version?: string;
        };
        Relationships: [];
      };
      upsell_offers: {
        Row: {
          conversions_count: number;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number | null;
          display_mode: string;
          discounted_price: number;
          duration_min: number | null;
          extra_revenue: number;
          id: string;
          is_active: boolean;
          offered_service_id: string;
          studio_id: string;
          trigger_service_id: string;
          views_count: number;
        };
        Insert: {
          conversions_count?: number;
          created_at?: string;
          description?: string | null;
          discount_type?: string;
          discount_value?: number | null;
          display_mode?: string;
          discounted_price: number;
          duration_min?: number | null;
          extra_revenue?: number;
          id?: string;
          is_active?: boolean;
          offered_service_id: string;
          studio_id: string;
          trigger_service_id: string;
          views_count?: number;
        };
        Update: {
          conversions_count?: number;
          created_at?: string;
          description?: string | null;
          discount_type?: string;
          discount_value?: number | null;
          display_mode?: string;
          discounted_price?: number;
          duration_min?: number | null;
          extra_revenue?: number;
          id?: string;
          is_active?: boolean;
          offered_service_id?: string;
          studio_id?: string;
          trigger_service_id?: string;
          views_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "upsell_offers_offered_service_id_fkey";
            columns: ["offered_service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "upsell_offers_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "upsell_offers_trigger_service_id_fkey";
            columns: ["trigger_service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          studio_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          studio_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          studio_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_studio_id_fkey";
            columns: ["studio_id"];
            isOneToOne: false;
            referencedRelation: "studios";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      confirm_paid_booking_request: {
        Args: { p_request_id: string; p_stripe_payment_intent_id?: string };
        Returns: string;
      };
      create_public_booking: {
        Args: {
          p_client_email?: string;
          p_client_name: string;
          p_client_phone: string;
          p_notes?: string;
          p_service_ids: string[];
          p_staff_id: string;
          p_starts_at: string;
          p_studio_slug: string;
        };
        Returns: Json;
      };
      create_studio_with_owner: {
        Args: {
          p_currency?: string;
          p_business_segment?: string;
          p_name: string;
          p_slug: string;
          p_timezone?: string;
        };
        Returns: string;
      };
      expire_pending_appointments: { Args: never; Returns: number };
      get_available_slots: {
        Args: {
          p_date: string;
          p_duration_min: number;
          p_slot_step_min?: number;
          p_staff_id: string;
          p_studio_slug: string;
        };
        Returns: {
          slot_label: string;
          slot_start: string;
          staff_id: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _studio_id: string;
          _user_id: string;
        };
        Returns: boolean;
      };
      is_studio_member: {
        Args: { _studio_id: string; _user_id: string };
        Returns: boolean;
      };
      record_public_policy_acceptance: {
        Args: {
          p_studio_id: string;
          p_booking_request_id: string | null;
          p_appointment_id: string | null;
          p_policy_version: string;
          p_payload?: Json;
        };
        Returns: string;
      };
      record_upsell_acceptances_for_services: {
        Args: { p_service_ids: string[]; p_studio_id: string };
        Returns: undefined;
      };
      resolve_booking_service_pricing: {
        Args: { p_service_ids: string[]; p_studio_id: string };
        Returns: {
          duration_min: number;
          is_upsell: boolean;
          offer_id: string;
          price: number;
          service_id: string;
        }[];
      };
      submit_public_refund_request: {
        Args: {
          p_booking_request_id: string | null;
          p_appointment_id: string | null;
          p_reason: string;
        };
        Returns: string;
      };
      track_upsell_acceptances: {
        Args: { p_offer_ids: string[] };
        Returns: undefined;
      };
      track_upsell_views: {
        Args: { p_offer_ids: string[] };
        Returns: undefined;
      };
      user_studio_ids: { Args: { _user_id: string }; Returns: string[] };
    };
    Enums: {
      app_role: "saas_owner" | "studio_owner" | "manager" | "staff" | "desk_staff";
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
        | "pending_payment";
      subscription_plan: "trial" | "starter" | "pro" | "business";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["saas_owner", "studio_owner", "manager", "staff", "desk_staff"],
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
        "pending_payment",
      ],
      subscription_plan: ["trial", "starter", "pro", "business"],
    },
  },
} as const;
