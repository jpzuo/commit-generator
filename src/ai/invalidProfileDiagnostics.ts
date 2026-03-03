import { ProviderFailure } from "./types";

export type InvalidProfileAlertMode = "switched" | "all_failed";

export function collectInvalidProfiles(
  failures: ProviderFailure[],
  successProfileId?: string
): ProviderFailure[] {
  const lastFailureByProfile = new Map<string, ProviderFailure>();

  for (const failure of failures) {
    if (successProfileId && failure.profileId === successProfileId) {
      continue;
    }
    lastFailureByProfile.set(failure.profileId, failure);
  }

  return [...lastFailureByProfile.values()];
}

export function buildAlertFingerprint(
  mode: InvalidProfileAlertMode,
  invalidProfiles: ProviderFailure[]
): string {
  const ids = [...new Set(invalidProfiles.map((failure) => failure.profileId))].sort();
  return `${mode}:${ids.join(",")}`;
}
