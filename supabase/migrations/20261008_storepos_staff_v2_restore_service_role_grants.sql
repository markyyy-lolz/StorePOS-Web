-- Staff Management v2 production repair. Migration applied without changing any rows.
-- This service_role credential must remain server-only.
GRANT SELECT ON TABLE public.shop_licenses TO service_role;
GRANT SELECT ON TABLE public.license_plans TO service_role;
GRANT INSERT ON TABLE public.user_profiles TO service_role;
GRANT INSERT ON TABLE public.shop_members TO service_role;
GRANT INSERT ON TABLE public.audit_logs TO service_role;
