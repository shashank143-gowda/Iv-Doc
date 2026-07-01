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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      corpus_entries: {
        Row: {
          corrected_fields: Json
          created_at: string
          doc_type: string | null
          document_id: string
          id: string
          image_path: string | null
          original_fields: Json
          project_id: string
          user_id: string
        }
        Insert: {
          corrected_fields?: Json
          created_at?: string
          doc_type?: string | null
          document_id: string
          id?: string
          image_path?: string | null
          original_fields?: Json
          project_id: string
          user_id: string
        }
        Update: {
          corrected_fields?: Json
          created_at?: string
          doc_type?: string | null
          document_id?: string
          id?: string
          image_path?: string | null
          original_fields?: Json
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "corpus_entries_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corpus_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      document_override_history: {
        Row: {
          action: string
          after_fields: Json
          before_fields: Json
          created_at: string
          document_id: string
          id: string
          note: string | null
          session_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          after_fields?: Json
          before_fields?: Json
          created_at?: string
          document_id: string
          id?: string
          note?: string | null
          session_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          after_fields?: Json
          before_fields?: Json
          created_at?: string
          document_id?: string
          id?: string
          note?: string | null
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_override_history_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_override_history_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "processing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_splits: {
        Row: {
          confidence: number | null
          created_at: string | null
          document_type: string | null
          extracted_fields: Json | null
          id: string
          needs_review: boolean
          page_end: number | null
          page_range: string | null
          page_start: number | null
          parent_document_id: string | null
          segment_type: string | null
          signals: Json
          status: string
          storage_path: string | null
          user_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          document_type?: string | null
          extracted_fields?: Json | null
          id?: string
          needs_review?: boolean
          page_end?: number | null
          page_range?: string | null
          page_start?: number | null
          parent_document_id?: string | null
          segment_type?: string | null
          signals?: Json
          status?: string
          storage_path?: string | null
          user_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          document_type?: string | null
          extracted_fields?: Json | null
          id?: string
          needs_review?: boolean
          page_end?: number | null
          page_range?: string | null
          page_start?: number | null
          parent_document_id?: string | null
          segment_type?: string | null
          signals?: Json
          status?: string
          storage_path?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_splits_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          doc_type: string | null
          id: string
          original_filename: string
          page_count: number | null
          status: string | null
          storage_path: string | null
          uploaded_at: string | null
          user_id: string | null
        }
        Insert: {
          doc_type?: string | null
          id?: string
          original_filename: string
          page_count?: number | null
          status?: string | null
          storage_path?: string | null
          uploaded_at?: string | null
          user_id?: string | null
        }
        Update: {
          doc_type?: string | null
          id?: string
          original_filename?: string
          page_count?: number | null
          status?: string | null
          storage_path?: string | null
          uploaded_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      processing_sessions: {
        Row: {
          created_at: string
          id: string
          name: string | null
          package_decision: string | null
          package_decision_reason: string | null
          package_validation: Json
          package_validation_results: Json
          project_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          package_decision?: string | null
          package_decision_reason?: string | null
          package_validation?: Json
          package_validation_results?: Json
          project_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          package_decision?: string | null
          package_decision_reason?: string | null
          package_validation?: Json
          package_validation_results?: Json
          project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_documents: {
        Row: {
          classification_confidence: number | null
          corrected_fields: Json
          created_at: string
          decision: string | null
          decision_reason: string | null
          document_type: string | null
          error: string | null
          extraction_source: string | null
          field_confidence: Json
          fields: Json
          file_name: string
          file_size: number | null
          id: string
          language: string | null
          mime_type: string
          override_history: Json
          page_count: number | null
          page_info: Json
          pages: Json
          preprocessing: Json
          project_id: string
          raw_text: string | null
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          segments: Json
          session_id: string | null
          status: string
          storage_path: string | null
          template_fingerprint: Json
          template_id: string | null
          updated_at: string
          user_id: string
          validation: Json
        }
        Insert: {
          classification_confidence?: number | null
          corrected_fields?: Json
          created_at?: string
          decision?: string | null
          decision_reason?: string | null
          document_type?: string | null
          error?: string | null
          extraction_source?: string | null
          field_confidence?: Json
          fields?: Json
          file_name: string
          file_size?: number | null
          id?: string
          language?: string | null
          mime_type: string
          override_history?: Json
          page_count?: number | null
          page_info?: Json
          pages?: Json
          preprocessing?: Json
          project_id: string
          raw_text?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          segments?: Json
          session_id?: string | null
          status?: string
          storage_path?: string | null
          template_fingerprint?: Json
          template_id?: string | null
          updated_at?: string
          user_id: string
          validation?: Json
        }
        Update: {
          classification_confidence?: number | null
          corrected_fields?: Json
          created_at?: string
          decision?: string | null
          decision_reason?: string | null
          document_type?: string | null
          error?: string | null
          extraction_source?: string | null
          field_confidence?: Json
          fields?: Json
          file_name?: string
          file_size?: number | null
          id?: string
          language?: string | null
          mime_type?: string
          override_history?: Json
          page_count?: number | null
          page_info?: Json
          pages?: Json
          preprocessing?: Json
          project_id?: string
          raw_text?: string | null
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          segments?: Json
          session_id?: string | null
          status?: string
          storage_path?: string | null
          template_fingerprint?: Json
          template_id?: string | null
          updated_at?: string
          user_id?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "processing_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
          webhook_secret: string | null
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          webhook_secret?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      templates: {
        Row: {
          active: boolean
          anchor_keywords: Json
          coordinate_regions: Json
          created_at: string
          document_type: string | null
          fields: Json
          id: string
          name: string
          regex_patterns: Json
          template_key: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          anchor_keywords?: Json
          coordinate_regions?: Json
          created_at?: string
          document_type?: string | null
          fields?: Json
          id?: string
          name: string
          regex_patterns?: Json
          template_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          anchor_keywords?: Json
          coordinate_regions?: Json
          created_at?: string
          document_type?: string | null
          fields?: Json
          id?: string
          name?: string
          regex_patterns?: Json
          template_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          created_at: string
          error: string | null
          id: string
          project_id: string
          request_body: Json | null
          session_id: string | null
          status_code: number | null
          success: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          project_id: string
          request_body?: Json | null
          session_id?: string | null
          status_code?: number | null
          success?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          project_id?: string
          request_body?: Json | null
          session_id?: string | null
          status_code?: number | null
          success?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "processing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
