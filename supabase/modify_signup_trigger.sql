-- SQL Script to modify the handle_new_user() trigger function on Supabase.
-- This script removes the automatic insertion of the signup phone number into the `wa_numbers` table,
-- which was causing contact numbers to mistakenly show up in the broadcast numbers page.
--
-- Instructions: Run this script in your Supabase Dashboard -> SQL Editor -> New Query -> Run.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
  new_org_name text;
BEGIN
  -- 1. Create a new organization (org) for the registrant
  new_org_name := coalesce(new.raw_user_meta_data->>'org_name', 'Instansi Baru');
  INSERT INTO public.orgs (name, is_active, plan)
  VALUES (new_org_name, false, 'pro')
  RETURNING id INTO new_org_id;

  -- 2. Create the user profile in app_users
  INSERT INTO public.app_users (id, email, username, full_name, role, org_id, is_active, created_at)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', new.email),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'owner',
    new_org_id,
    false,
    now()
  );

  -- 3. Initialize billing balance for the new organization
  INSERT INTO public.billing_balance (org_id, tokens_balance, token_price_idr, updated_at)
  VALUES (new_org_id, 0, 1500, now());

  -- NOTE: We NO LONGER insert into public.wa_numbers here!
  -- WABA numbers must be added via "Tambah Nomor" button in the dashboard,
  -- by inputting the Access Token and WABA IDs.
  
  RETURN new;
END;
$$;
