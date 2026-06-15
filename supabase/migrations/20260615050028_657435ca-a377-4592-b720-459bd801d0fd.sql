
DROP VIEW IF EXISTS public.collaborator_directory;
CREATE VIEW public.collaborator_directory
WITH (security_invoker = true) AS
SELECT id, name, is_admin, active FROM public.collaborators WHERE active = true;
GRANT SELECT ON public.collaborator_directory TO anon, authenticated;

-- Also allow anon to read base table id/name only (needed for view with security_invoker)
CREATE POLICY "Anon read collaborator basic" ON public.collaborators FOR SELECT TO anon, authenticated USING (active = true);
