const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAlertFingerprint, collectInvalidProfiles } = require("../out/ai/invalidProfileDiagnostics");

function createFailure(overrides = {}) {
  return {
    profileId: "primary",
    provider: "openaiCompat",
    endpoint: "https://api.test/v1/chat/completions",
    retryable: false,
    attempt: 1,
    error: "request failed",
    latencyMs: 120,
    ...overrides
  };
}

test("collectInvalidProfiles excludes retry failures for the finally successful profile", () => {
  const failures = [
    createFailure({
      profileId: "openai-main",
      attempt: 1,
      retryable: true,
      error: "rate limited"
    })
  ];

  const invalidProfiles = collectInvalidProfiles(failures, "openai-main");
  assert.deepEqual(invalidProfiles, []);
});

test("collectInvalidProfiles keeps failed primary profile when fallback profile succeeds", () => {
  const failures = [
    createFailure({
      profileId: "openai-main",
      provider: "openaiCompat",
      status: 404,
      error: "model not found"
    })
  ];

  const invalidProfiles = collectInvalidProfiles(failures, "claude-fallback");
  assert.equal(invalidProfiles.length, 1);
  assert.equal(invalidProfiles[0].profileId, "openai-main");
});

test("collectInvalidProfiles merges repeated failures by profile and keeps the last one", () => {
  const failures = [
    createFailure({
      profileId: "openai-main",
      attempt: 1,
      status: 500,
      retryable: true,
      error: "server overload"
    }),
    createFailure({
      profileId: "openai-main",
      attempt: 2,
      status: 404,
      retryable: false,
      error: "model not found"
    })
  ];

  const invalidProfiles = collectInvalidProfiles(failures);
  assert.equal(invalidProfiles.length, 1);
  assert.equal(invalidProfiles[0].attempt, 2);
  assert.equal(invalidProfiles[0].status, 404);
  assert.equal(invalidProfiles[0].error, "model not found");
});

test("collectInvalidProfiles returns all attempted profiles when all providers fail", () => {
  const failures = [
    createFailure({ profileId: "openai-main", attempt: 1, status: 500, retryable: true }),
    createFailure({ profileId: "openai-main", attempt: 2, status: 500, retryable: false }),
    createFailure({ profileId: "claude-fallback", provider: "anthropic", status: 401 }),
    createFailure({ profileId: "gemini-fallback", provider: "gemini", status: 404 })
  ];

  const invalidProfiles = collectInvalidProfiles(failures);
  assert.deepEqual(
    invalidProfiles.map((failure) => failure.profileId),
    ["openai-main", "claude-fallback", "gemini-fallback"]
  );

  const openaiFailure = invalidProfiles.find((failure) => failure.profileId === "openai-main");
  assert.equal(openaiFailure?.attempt, 2);
});

test("buildAlertFingerprint is stable regardless of invalid profile order", () => {
  const failuresA = [
    createFailure({ profileId: "b" }),
    createFailure({ profileId: "a" })
  ];
  const failuresB = [
    createFailure({ profileId: "a" }),
    createFailure({ profileId: "b" })
  ];

  const fingerprintA = buildAlertFingerprint("all_failed", failuresA);
  const fingerprintB = buildAlertFingerprint("all_failed", failuresB);
  assert.equal(fingerprintA, fingerprintB);

  const switchedFingerprint = buildAlertFingerprint("switched", failuresA);
  assert.notEqual(switchedFingerprint, fingerprintA);
});
