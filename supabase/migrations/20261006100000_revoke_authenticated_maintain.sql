-- Batch 3 follow-up: authenticated application sessions do not perform table
-- maintenance. Keep this correction limited to the exact cloud-audited ACLs.

REVOKE MAINTAIN ON TABLE
  public.app_activity,
  public.app_users,
  public.billing_balance,
  public.billing_transactions,
  public.key_info,
  public.orgs,
  public.wa_broadcast_recipients,
  public.wa_broadcasts,
  public.wa_contacts,
  public.wa_messages,
  public.wa_numbers,
  public.wa_templates
FROM authenticated;
