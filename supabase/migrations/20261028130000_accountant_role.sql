-- Accountant sits between admin and member. The new enum label cannot be
-- used until this statement's transaction commits, so the finance helper
-- is the next migration.
alter type public.role_enum add value if not exists 'accountant';
