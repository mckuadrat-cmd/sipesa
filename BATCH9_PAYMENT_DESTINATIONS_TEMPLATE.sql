-- Batch 9 payment destination setup template.
-- IMPORTANT: Do not run unchanged. Replace every <...> value first.
-- The main migration must be applied before this configuration.

-- Bank transfer example (uncomment only after replacing all placeholders):
-- INSERT INTO public.payment_destinations (
--   method, provider_name, account_reference, account_holder,
--   instructions, active, display_order
-- ) VALUES (
--   'bank_transfer',
--   '<BANK NAME>',
--   '<ACCOUNT NUMBER>',
--   '<ACCOUNT HOLDER>',
--   'Transfer sesuai nominal yang ditampilkan, lalu unggah bukti pembayaran.',
--   true,
--   10
-- );

-- QRIS static setup:
-- 1. Upload the approved QRIS image to the private `payment-assets` bucket.
-- 2. Use its object path below (never use a service-role or public URL).
-- 3. Uncomment only after replacing all placeholders.
-- INSERT INTO public.payment_destinations (
--   method, provider_name, qris_object_path, instructions, active, display_order
-- ) VALUES (
--   'qris_static',
--   '<QRIS DISPLAY NAME>',
--   '<PRIVATE OBJECT PATH IN payment-assets>',
--   'Pindai QRIS, bayar sesuai nominal, lalu unggah bukti pembayaran.',
--   true,
--   20
-- );

-- Read-only confirmation; account_reference is intentionally masked.
SELECT
  id,
  method,
  provider_name,
  CASE
    WHEN account_reference IS NULL THEN NULL
    WHEN length(account_reference) <= 4 THEN repeat('*', length(account_reference))
    ELSE repeat('*', length(account_reference) - 4) || right(account_reference, 4)
  END AS masked_account_reference,
  account_holder,
  qris_object_path,
  active,
  display_order
FROM public.payment_destinations
ORDER BY display_order, created_at;
