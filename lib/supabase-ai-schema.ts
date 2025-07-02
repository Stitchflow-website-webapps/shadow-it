import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Create Supabase admin client for AI-database-shadow-it schema
export const supabaseAIAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    db: {
      schema: 'AI-database-shadow-it'
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
); 