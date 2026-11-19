function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export type BroadcastCreateAttempt = { payloadSignature: string; idempotencyKey: string };

export function ensureBroadcastCreateAttempt(
  current: BroadcastCreateAttempt | null,
  payload: unknown,
  createId: () => string = () => crypto.randomUUID(),
): BroadcastCreateAttempt {
  const payloadSignature = JSON.stringify(canonicalize(payload));
  if (current?.payloadSignature === payloadSignature) return current;
  return { payloadSignature, idempotencyKey: createId() };
}
