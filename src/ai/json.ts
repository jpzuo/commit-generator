export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asStringRecord(value: unknown): Record<string, string> {
  const source = asRecord(value);
  if (!source) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (typeof item === "string" && item.trim().length > 0) {
      result[key] = item;
    }
  }
  return result;
}
