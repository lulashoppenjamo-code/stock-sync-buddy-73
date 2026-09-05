CREATE TABLE public.branch_closures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  branch text NOT NULL,
  period date NOT NULL,
  collaborator_id uuid,
  collaborator_name text,
  comments text,
  total_counted numeric NOT NULL DEFAULT 0,
  products_counted integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (category, branch, period)
);
GRANT SELECT, INSERT, UPDATE ON public.branch_closures TO anon, authenticated;
GRANT ALL ON public.branch_closures TO service_role;
ALTER TABLE public.branch_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read branch_closures" ON public.branch_closures FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert branch_closures" ON public.branch_closures FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can update branch_closures" ON public.branch_closures FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.audit_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text,
  branch text,
  collaborator_id uuid,
  collaborator_name text,
  comment text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_comments TO anon, authenticated;
GRANT ALL ON public.audit_comments TO service_role;
ALTER TABLE public.audit_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read audit_comments" ON public.audit_comments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert audit_comments" ON public.audit_comments FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE public.ai_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  collaborator_id uuid,
  collaborator_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_thread_idx ON public.ai_messages (thread_id, created_at);
GRANT SELECT, INSERT ON public.ai_messages TO anon, authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read ai_messages" ON public.ai_messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert ai_messages" ON public.ai_messages FOR INSERT TO anon, authenticated WITH CHECK (true);