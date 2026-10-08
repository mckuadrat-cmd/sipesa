const encoder = new TextEncoder();
const toBytes = (value) => value instanceof Uint8Array ? value : encoder.encode(value);

function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function createMetaWebhookSignature(rawBody, appSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toBytes(rawBody)),
  );
}

export async function verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return { ok: false, reason: "missing_secret" };
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  const supplied = match ? hexToBytes(match[1]) : null;
  if (!supplied) return { ok: false, reason: "invalid_signature" };

  const expected = await createMetaWebhookSignature(rawBody, appSecret);
  return constantTimeEqual(expected, supplied)
    ? { ok: true, reason: "valid" }
    : { ok: false, reason: "invalid_signature" };
}
