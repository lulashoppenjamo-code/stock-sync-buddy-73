ALTER FUNCTION public.verify_pin(uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public._check_admin_pin(uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public.admin_create_collaborator(uuid, text, text, text, boolean) SET search_path = public, extensions;
ALTER FUNCTION public.admin_update_collaborator(uuid, text, uuid, text, text, boolean, boolean) SET search_path = public, extensions;