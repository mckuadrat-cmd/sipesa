export type RecipientMessageIdentityInput = {
  variables?: string[];
  mediaUrl?: string;
  fileName?: string;
  headerTextVariables?: string[];
  buttonValues?: Array<{ index: number; type: "URL" | "COPY_CODE"; value: string }>;
  location?: { latitude: number; longitude: number; name: string; address: string };
};

export function normalizeBroadcastPhone(value: unknown): string {
  let raw = String(value ?? "").trim().replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("08")) return `62${raw.slice(1)}`;
  if (raw.startsWith("8")) return `62${raw}`;
  if (raw.startsWith("+62")) return raw.slice(1);
  if (raw.startsWith("62")) return raw;
  if (raw.startsWith("+")) return raw.slice(1);
  return raw;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value ?? null;
}

export function buildRecipientMessageIdentity(
  templateId: string | null | undefined,
  input: RecipientMessageIdentityInput,
  requiredVariableCount?: number,
): string {
  const bodyVariables = requiredVariableCount === undefined
    ? (input.variables ?? []).map((value) => String(value ?? ""))
    : Array.from(
        { length: Math.max(0, requiredVariableCount) },
        (_, index) => String(input.variables?.[index] ?? ""),
      );

  return JSON.stringify(canonicalize({
    templateId: String(templateId ?? ""),
    bodyVariables,
    headerTextVariables: (input.headerTextVariables ?? []).map((value) => String(value ?? "")),
    buttonValues: [...(input.buttonValues ?? [])]
      .map((button) => ({
        index: Number(button.index),
        type: String(button.type).toUpperCase(),
        value: String(button.value ?? ""),
      }))
      .sort((left, right) => left.index - right.index || left.type.localeCompare(right.type)),
    location: input.location
      ? {
          latitude: Number(input.location.latitude),
          longitude: Number(input.location.longitude),
          name: String(input.location.name ?? ""),
          address: String(input.location.address ?? ""),
        }
      : null,
    mediaUrl: String(input.mediaUrl ?? ""),
    fileName: String(input.fileName ?? ""),
  }));
}

export function describeRepeatedPayload(
  identity: string,
  otherRows: Array<{ rowNumber: number; identity: string }>,
): { identicalRows: number[]; differentRows: number[]; summary: string } {
  const identicalRows = otherRows.filter((row) => row.identity === identity).map((row) => row.rowNumber);
  const differentRows = otherRows.filter((row) => row.identity !== identity).map((row) => row.rowNumber);
  const parts: string[] = [];
  if (identicalRows.length) parts.push(`Pesan identik dengan baris #${identicalRows.join(", #")}`);
  if (differentRows.length) parts.push(`Payload berbeda dari baris #${differentRows.join(", #")}`);
  return { identicalRows, differentRows, summary: parts.join("; ") };
}

export function selectRecipientRows<T extends { rowNumber?: number }>(
  rows: T[],
  selectedRowNumbers: Iterable<number>,
): T[] {
  const selected = new Set(selectedRowNumbers);
  return rows.filter((row, index) => selected.has(row.rowNumber ?? index + 1));
}

export function summarizeRepeatedRecipients<T extends RecipientMessageIdentityInput & { phone: string }>(
  rows: T[],
  templateId: string | null | undefined,
  requiredVariableCount?: number,
) {
  const priorIdentities = new Map<string, Set<string>>();
  let additionalRows = 0;
  let identicalAdditionalRows = 0;
  let differentAdditionalRows = 0;

  rows.forEach((row) => {
    const phone = normalizeBroadcastPhone(row.phone);
    if (!phone) return;
    const identity = buildRecipientMessageIdentity(templateId, row, requiredVariableCount);
    const identities = priorIdentities.get(phone);
    if (identities) {
      additionalRows += 1;
      if (identities.has(identity)) identicalAdditionalRows += 1;
      else differentAdditionalRows += 1;
      identities.add(identity);
    } else {
      priorIdentities.set(phone, new Set([identity]));
    }
  });

  return { additionalRows, identicalAdditionalRows, differentAdditionalRows };
}
