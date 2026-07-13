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
      collaborators: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_admin: boolean
          name: string
          pin_hash: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_admin?: boolean
          name: string
          pin_hash: string
        }
        Update: {
          active?: boolean
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
      products: {
        Row: {
          barcode: string
          category: string | null
          created_at: string
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
    }
    Functions: {
      _check_admin_pin: {
        Args: { p_admin_id: string; p_admin_pin: string }
        Returns: boolean
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
      branch_code: ["A", "B"],
    },
  },
} as const
