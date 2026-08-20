import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { createClient } from "jsr:@supabase/supabase-js@2";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "apikey"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  })
);

function sb() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum terpasang");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Helper to compute sha-512 hex signature
async function computeSignature(orderId: string, statusCode: string, grossAmount: string, serverKey: string): Promise<string> {
  const rawString = orderId + statusCode + grossAmount + serverKey;
  const encoder = new TextEncoder();
  const data = encoder.encode(rawString);
  const hashBuffer = await crypto.subtle.digest("SHA-512", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

app.post("/", async (c) => {
  try {
    const payload = await c.req.json();
    console.log("Midtrans Webhook Received:", JSON.stringify(payload));

    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status
    } = payload;

    if (!order_id) {
      return c.json({ error: "Missing order_id" }, 400);
    }

    const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY") || "";
    if (!serverKey) {
      console.error("MIDTRANS_SERVER_KEY is not configured.");
      return c.json({ error: "Server Key configuration missing" }, 500);
    }

    // 1. Verify Midtrans Signature
    const calculatedSignature = await computeSignature(order_id, status_code, gross_amount, serverKey);
    if (calculatedSignature !== signature_key) {
      console.warn(`Invalid signature for order_id: ${order_id}. Calculated: ${calculatedSignature}, Received: ${signature_key}`);
      return c.json({ error: "Invalid signature_key" }, 403);
    }

    const supa = sb();

    // 2. Fetch the pending transaction from key_info
    const txKey = `midtrans_tx:${order_id}`;
    const { data: txRow, error: getErr } = await supa
      .from("key_info")
      .select("value")
      .eq("key", txKey)
      .maybeSingle();

    if (getErr) {
      console.error(`Database error fetching transaction info: ${getErr.message}`);
      return c.json({ error: getErr.message }, 500);
    }

    if (!txRow) {
      console.warn(`Transaction not found in key_info: ${order_id}`);
      return c.json({ message: "Transaction record not found in key_info, skipped" }, 200);
    }

    const tx = txRow.value;
    if (tx.status !== "pending") {
      console.log(`Transaction ${order_id} is already processed with status: ${tx.status}`);
      return c.json({ message: "Transaction already processed" }, 200);
    }

    // 3. Process payment status
    const isSuccess =
      transaction_status === "settlement" ||
      (transaction_status === "capture" && (fraud_status === "accept" || !fraud_status));

    const isFailure =
      transaction_status === "deny" ||
      transaction_status === "cancel" ||
      transaction_status === "expire";

    if (isSuccess) {
      const { data: balance, error: balErr } = await supa
        .from("billing_balance")
        .select("tokens_balance")
        .eq("org_id", tx.org_id)
        .maybeSingle();

      if (balErr) {
        console.error("Gagal mendapatkan billing_balance:", balErr);
        return c.json({ error: balErr.message }, 500);
      }

      const currentBalance = balance ? Number(balance.tokens_balance ?? 0) : 0;
      const newBalance = currentBalance + Number(tx.amount_tokens);

      const { error: upsertErr } = await supa
        .from("billing_balance")
        .upsert({
          org_id: tx.org_id,
          tokens_balance: newBalance,
          updated_at: new Date().toISOString(),
        }, { onConflict: "org_id" });

      if (upsertErr) {
        console.error("Gagal update billing_balance:", upsertErr);
        return c.json({ error: upsertErr.message }, 500);
      }

      const { error: txErr } = await supa
        .from("billing_transactions")
        .insert({
          org_id: tx.org_id,
          type: "topup",
          tokens_delta: Number(tx.amount_tokens),
          amount_idr: Number(tx.amount_idr),
          description: `Top-up otomatis (${tx.amount_tokens} token) - Order ID: ${order_id}`,
          created_by: tx.user_id || null,
        });

      if (txErr) {
        console.warn("Gagal menambahkan riwayat billing_transactions:", txErr);
      }

      await supa.from("app_activity").insert({
        org_id: tx.org_id,
        actor_user_id: tx.user_id || null,
        type: "billing_topup",
        message: `Top-up token otomatis sukses (${tx.amount_tokens} token)`,
        meta: { order_id, amount_idr: tx.amount_idr, tokens: tx.amount_tokens },
      }).catch(err => console.error("Failed to insert activity log:", err));

      tx.status = "settlement";
      tx.settled_at = new Date().toISOString();
      await supa.from("key_info").upsert({ key: txKey, value: tx });

      console.log(`Payment successfully applied for order_id: ${order_id}. Added ${tx.amount_tokens} tokens.`);

    } else if (isFailure) {
      tx.status = transaction_status;
      tx.failed_at = new Date().toISOString();
      await supa.from("key_info").upsert({ key: txKey, value: tx });

      console.log(`Payment failed for order_id: ${order_id} with status: ${transaction_status}`);
    }

    return c.json({ status: "success" });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error("Webhook processing error:", errorMsg);
    return c.json({ error: errorMsg }, 500);
  }
});

Deno.serve((req) => {
  const url = new URL(req.url);
  let pathname = url.pathname;

  if (pathname.startsWith("/functions/v1/midtrans-webhook")) {
    pathname = pathname.replace(/^\/functions\/v1\/midtrans-webhook/, "") || "/";
  } else if (pathname.startsWith("/midtrans-webhook")) {
    pathname = pathname.replace(/^\/midtrans-webhook/, "") || "/";
  }

  const rewrittenUrl = new URL(req.url);
  rewrittenUrl.pathname = pathname;

  return app.fetch(new Request(rewrittenUrl.toString(), req));
});
