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
      ai_messages: {
        Row: {
          collaborator_id: string | null
          collaborator_name: string | null
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          collaborator_id?: string | null
          collaborator_name?: string | null
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
        }
        Update: {
          collaborator_id?: string | null
          collaborator_name?: string | null
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: []
      }
      audit_comments: {
        Row: {
          barcode: string | null
          branch: string | null
          category: string | null
          collaborator_id: string | null
          collaborator_name: string | null
          comment: string
          created_at: string
          id: string
          product_name: string | null
          session_id: string | null
        }
        Insert: {
          barcode?: string | null
          branch?: string | null
          category?: string | null
          collaborator_id?: string | null
          collaborator_name?: string | null
          comment: string
          created_at?: string
          id?: string
          product_name?: string | null
          session_id?: string | null
        }
        Update: {
          barcode?: string | null
          branch?: string | null
          category?: string | null
          collaborator_id?: string | null
          collaborator_name?: string | null
          comment?: string
          created_at?: string
          id?: string
          product_name?: string | null
          session_id?: string | null
        }
        Relationships: []
      }
      audit_history: {
        Row: {
          barcode: string
          branch: string
          category: string
          collaborator_id: string | null
          collaborator_name: string | null
          counted_quantity: number
          created_at: string
          difference: number
          id: string
          product_name: string
          session_id: string
          system_stock: number
        }
        Insert: {
          barcode: string
          branch: string
          category: string
          collaborator_id?: string | null
          collaborator_name?: string | null
          counted_quantity: number
          created_at?: string
          difference: number
          id?: string
          product_name: string
          session_id: string
          system_stock: number
        }
        Update: {
          barcode?: string
          branch?: string
          category?: string
          collaborator_id?: string | null
          collaborator_name?: string | null
          counted_quantity?: number
          created_at?: string
          difference?: number
          id?: string
          product_name?: string
          session_id?: string
          system_stock?: number
        }
        Relationships: []
      }
      audits: {
        Row: {
          barcode: string
          branch: Database["public"]["Enums"]["branch_code"] | null
          client_uid: string | null
          collaborator_id: string | null
          collaborator_name: string | null
          created_at: string
          difference: number
          id: string
          physical_count: number
          product_name: string
          system_stock: number
        }
        Insert: {
          barcode: string
          branch?: Database["public"]["Enums"]["branch_code"] | null
          client_uid?: string | null
          collaborator_id?: string | null
          collaborator_name?: string | null
          created_at?: string
          difference: number
          id?: string
          physical_count: number
          product_name: string
          system_stock: number
        }
        Update: {
          barcode?: string
          branch?: Database["public"]["Enums"]["branch_code"] | null
          client_uid?: string | null
          collaborator_id?: string | null
          collaborator_name?: string | null
          created_at?: string
          difference?: number
          id?: string
          physical_count?: number
          product_name?: string
          system_stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "audits_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborator_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audits_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_closures: {
        Row: {
          branch: string
          category: string
          collaborator_id: string | null
          collaborator_name: string | null
          comments: string | null
          created_at: string
          id: string
          period: string
          products_counted: number
          status: string | null
          total_counted: number
        }
        Insert: {
          branch: string
          category: string
          collaborator_id?: string | null
          collaborator_name?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          period: string
          products_counted?: number
          status?: string | null
          total_counted?: number
        }
        Update: {
          branch?: string
          category?: string
          collaborator_id?: string | null
          collaborator_name?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          period?: string
          products_counted?: number
          status?: string | null
          total_counted?: number
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      closed_counts: {
        Row: {
          barcode: string
          category: string
          closed_at: string
          closed_by: string | null
          count_details: Json
          created_at: string
          difference: number
          difference_value: number
          id: string
          last_counted_at: string | null
          last_counted_by: string | null
          mina_count: number
          morelos_count: number
          product_name: string
          scanned_mina: boolean
          scanned_morelos: boolean
          session_id: string
          system_stock: number
          total_counted: number
          unit_price: number
        }
        Insert: {
          barcode: string
          category: string
          closed_at?: string
          closed_by?: string | null
          count_details?: Json
          created_at?: string
          difference?: number
          difference_value?: number
          id?: string
          last_counted_at?: string | null
          last_counted_by?: string | null
          mina_count?: number
          morelos_count?: number
          product_name: string
          scanned_mina?: boolean
          scanned_morelos?: boolean
          session_id: string
          system_stock?: number
          total_counted?: number
          unit_price?: number
        }
        Update: {
          barcode?: string
          category?: string
          closed_at?: string
          closed_by?: string | null
          count_details?: Json
          created_at?: string
          difference?: number
          difference_value?: number
          id?: string
          last_counted_at?: string | null
          last_counted_by?: string | null
          mina_count?: number
          morelos_count?: number
          product_name?: string
          scanned_mina?: boolean
          scanned_morelos?: boolean
          session_id?: string
          system_stock?: number
          total_counted?: number
          unit_price?: number
        }
        Relationships: []
      }
      collaborators: {
        Row: {
          active: boolean
          branch: string | null
          created_at: string
          id: string
          is_admin: boolean
          name: string
          pin_hash: string
        }
        Insert: {
          active?: boolean
          branch?: string | null
          created_at?: string
          id?: string
          is_admin?: boolean
          name: string
          pin_hash: string
        }
        Update: {
          active?: boolean
          branch?: string | null
          created_at?: string
          id?: string
          is_admin?: boolean
          name?: string
          pin_hash?: string
        }
        Relationships: []
      }
      csv_imports: {
        Row: {
          collaborator_id: string | null
          collaborator_name: string | null
          created_at: string
          filename: string | null
          id: string
          new_count: number
          skipped_count: number
          updated_count: number
        }
        Insert: {
          collaborator_id?: string | null
          collaborator_name?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          new_count?: number
          skipped_count?: number
          updated_count?: number
        }
        Update: {
          collaborator_id?: string | null
          collaborator_name?: string | null
          created_at?: string
          filename?: string | null
          id?: string
          new_count?: number
          skipped_count?: number
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "csv_imports_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborator_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_imports_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_scan_events: {
        Row: {
          barcode: string
          client_uid: string
          created_at: string
          delta: number | null
          location: string
          mode: string
          quantity: number | null
          session_id: string
        }
        Insert: {
          barcode: string
          client_uid: string
          created_at?: string
          delta?: number | null
          location: string
          mode: string
          quantity?: number | null
          session_id: string
        }
        Update: {
          barcode?: string
          client_uid?: string
          created_at?: string
          delta?: number | null
          location?: string
          mode?: string
          quantity?: number | null
          session_id?: string
        }
        Relationships: []
      }
      inventory_session_items: {
        Row: {
          barcode: string
          category: string | null
          counted_at: string | null
          counted_by: string | null
          created_at: string
          difference: number | null
          id: string
          mina_count: number
          morelos_count: number
          physical_count: number | null
          product_name: string
          session_id: string
          system_stock_snapshot: number
          touched: boolean
          unit_cost_snapshot: number
        }
        Insert: {
          barcode: string
          category?: string | null
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          mina_count?: number
          morelos_count?: number
          physical_count?: number | null
          product_name: string
          session_id: string
          system_stock_snapshot?: number
          touched?: boolean
          unit_cost_snapshot?: number
        }
        Update: {
          barcode?: string
          category?: string | null
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          difference?: number | null
          id?: string
          mina_count?: number
          morelos_count?: number
          physical_count?: number | null
          product_name?: string
          session_id?: string
          system_stock_snapshot?: number
          touched?: boolean
          unit_cost_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sessions: {
        Row: {
          finished_at: string | null
          finished_by_id: string | null
          finished_by_name: string | null
          id: string
          notes: string | null
          started_at: string
          started_by_id: string | null
          started_by_name: string | null
          status: string
          total_products: number
        }
        Insert: {
          finished_at?: string | null
          finished_by_id?: string | null
          finished_by_name?: string | null
          id?: string
          notes?: string | null
          started_at?: string
          started_by_id?: string | null
          started_by_name?: string | null
          status?: string
          total_products?: number
        }
        Update: {
          finished_at?: string | null
          finished_by_id?: string | null
          finished_by_name?: string | null
          id?: string
          notes?: string | null
          started_at?: string
          started_by_id?: string | null
          started_by_name?: string | null
          status?: string
          total_products?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sessions_finished_by_id_fkey"
            columns: ["finished_by_id"]
            isOneToOne: false
            referencedRelation: "collaborator_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_finished_by_id_fkey"
            columns: ["finished_by_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_started_by_id_fkey"
            columns: ["started_by_id"]
            isOneToOne: false
            referencedRelation: "collaborator_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_started_by_id_fkey"
            columns: ["started_by_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string
          category: string | null
          created_at: string
          price: number
          product_name: string
          stock_a: number
          stock_b: number
          uom: string | null
          updated_at: string
        }
        Insert: {
          barcode: string
          category?: string | null
          created_at?: string
          price?: number
          product_name: string
          stock_a?: number
          stock_b?: number
          uom?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string
          category?: string | null
          created_at?: string
          price?: number
          product_name?: string
          stock_a?: number
          stock_b?: number
          uom?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transfers: {
        Row: {
          barcode: string
          client_uid: string | null
          collaborator_id: string | null
          collaborator_name: string | null
          created_at: string
          destination: Database["public"]["Enums"]["branch_code"]
          id: string
          origin: Database["public"]["Enums"]["branch_code"]
          photo_url: string
          product_name: string
          quantity: number
          received_at: string | null
          received_by_id: string | null
          received_by_name: string | null
          received_photo_url: string | null
          received_quantity: number | null
          received_receiver_name: string | null
          received_scanned_barcode: string | null
          received_sender_name: string | null
          receiver_name: string
          sender_name: string
        }
        Insert: {
          barcode: string
          client_uid?: string | null
          collaborator_id?: string | null
          collaborator_name?: string | null
          created_at?: string
          destination: Database["public"]["Enums"]["branch_code"]
          id?: string
          origin: Database["public"]["Enums"]["branch_code"]
          photo_url: string
          product_name: string
          quantity: number
          received_at?: string | null
          received_by_id?: string | null
          received_by_name?: string | null
          received_photo_url?: string | null
          received_quantity?: number | null
          received_receiver_name?: string | null
          received_scanned_barcode?: string | null
          received_sender_name?: string | null
          receiver_name: string
          sender_name: string
        }
        Update: {
          barcode?: string
          client_uid?: string | null
          collaborator_id?: string | null
          collaborator_name?: string | null
          created_at?: string
          destination?: Database["public"]["Enums"]["branch_code"]
          id?: string
          origin?: Database["public"]["Enums"]["branch_code"]
          photo_url?: string
          product_name?: string
          quantity?: number
          received_at?: string | null
          received_by_id?: string | null
          received_by_name?: string | null
          received_photo_url?: string | null
          received_quantity?: number | null
          received_receiver_name?: string | null
          received_scanned_barcode?: string | null
          received_sender_name?: string | null
          receiver_name?: string
          sender_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborator_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      zobaze_corrections: {
        Row: {
          category: string
          corrected: boolean
          corrected_at: string
          corrected_by: string | null
          created_at: string
          id: string
          session_id: string
        }
        Insert: {
          category: string
          corrected?: boolean
          corrected_at?: string
          corrected_by?: string | null
          created_at?: string
          id?: string
          session_id: string
        }
        Update: {
          category?: string
          corrected?: boolean
          corrected_at?: string
          corrected_by?: string | null
          created_at?: string
          id?: string
          session_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      collaborator_directory: {
        Row: {
          active: boolean | null
          id: string | null
          is_admin: boolean | null
          name: string | null
        }
        Insert: {
          active?: boolean | null
          id?: string | null
          is_admin?: boolean | null
          name?: string | null
        }
        Update: {
          active?: boolean | null
          id?: string | null
          is_admin?: boolean | null
          name?: string | null
        }
        Relationships: []
      }
      v_categorias_cerradas_mes_actual: {
        Row: {
          category: string | null
          primer_cierre: string | null
          productos: number | null
          sesiones: number | null
          ultimo_cierre: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _check_admin_pin: {
        Args: { p_admin_id: string; p_admin_pin: string }
        Returns: boolean
      }
      admin_correct_closed_count_row: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_mina_count: number
          p_morelos_count: number
          p_row_id: string
          p_system_stock: number
          p_update_inventory?: boolean
        }
        Returns: undefined
      }
      admin_correct_closed_count_row_v2: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_inventory_mina?: number
          p_inventory_morelos?: number
          p_mina_count: number
          p_morelos_count: number
          p_row_id: string
          p_system_stock: number
          p_update_inventory?: boolean
        }
        Returns: undefined
      }
      admin_create_collaborator: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_is_admin?: boolean
          p_name: string
          p_pin: string
        }
        Returns: string
      }
      admin_delete_audit_history_row: {
        Args: { p_admin_id: string; p_admin_pin: string; p_row_id: string }
        Returns: undefined
      }
      admin_reset_audit_category: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_branch: string
          p_category: string
        }
        Returns: number
      }
      admin_reset_realtime_audits: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_barcodes: string[]
          p_branch: string
          p_since: string
        }
        Returns: number
      }
      admin_set_zobaze_correction: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_category: string
          p_corrected: boolean
          p_session_id: string
        }
        Returns: undefined
      }
      admin_update_audit_history_row: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_counted_quantity: number
          p_row_id: string
        }
        Returns: undefined
      }
      admin_update_closed_count_row: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_mina_count: number
          p_morelos_count: number
          p_row_id: string
        }
        Returns: undefined
      }
      admin_update_collaborator: {
        Args: {
          p_active: boolean
          p_admin_id: string
          p_admin_pin: string
          p_is_admin: boolean
          p_name: string
          p_pin: string
          p_target_id: string
        }
        Returns: undefined
      }
      admin_wipe_audit_category: {
        Args: {
          p_admin_id: string
          p_admin_pin: string
          p_category: string
          p_period: string
          p_since: string
          p_until: string
          p_zero_stock: boolean
        }
        Returns: number
      }
      apply_transfer: {
        Args: {
          p_barcode: string
          p_client_uid: string
          p_collaborator_id: string
          p_collaborator_name: string
          p_destination: Database["public"]["Enums"]["branch_code"]
          p_origin: Database["public"]["Enums"]["branch_code"]
          p_photo_url: string
          p_quantity: number
          p_receiver_name: string
          p_sender_name: string
        }
        Returns: string
      }
      create_inventory_session: {
        Args: { p_started_by_id: string; p_started_by_name: string }
        Returns: string
      }
      finalize_inventory_session: {
        Args: {
          p_finished_by_id: string
          p_finished_by_name: string
          p_session_id: string
        }
        Returns: {
          coincide: number
          counted: number
          faltante: number
          pending: number
          perdida_neta: number
          products_total: number
          sobrante: number
          valor_fisico: number
          valor_teorico: number
        }[]
      }
      inventory_manual_set: {
        Args: {
          p_barcode: string
          p_client_uid: string
          p_collaborator_name: string
          p_location: Database["public"]["Enums"]["branch_code"]
          p_quantity: number
          p_session_id: string
        }
        Returns: {
          barcode: string
          difference: number
          mina_count: number
          morelos_count: number
          physical_count: number
          product_name: string
          system_stock_snapshot: number
          touched: boolean
        }[]
      }
      inventory_scan: {
        Args: {
          p_barcode: string
          p_client_uid: string
          p_collaborator_name: string
          p_delta: number
          p_location: Database["public"]["Enums"]["branch_code"]
          p_session_id: string
        }
        Returns: {
          barcode: string
          difference: number
          mina_count: number
          morelos_count: number
          physical_count: number
          product_name: string
          system_stock_snapshot: number
          touched: boolean
        }[]
      }
      verify_pin: {
        Args: { p_collaborator_id: string; p_pin: string }
        Returns: {
          id: string
          is_admin: boolean
          name: string
        }[]
      }
    }
    Enums: {
      branch_code: "A" | "B"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      branch_code: ["A", "B"],
    },
  },
} as const
