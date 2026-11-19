// src/opencode/fallback/rpc.ts
var STEPS_RPC_ID = "opencode-model-fallback.steps";
var LIMITS_RPC_ID = "opencode-model-fallback.limits";
var LIMITED_EVENT = "limited";
var VENDOR = "opencode-model-fallback";
var LIMIT_KINDS = ["quota", "rate", "consumer"];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function schema(check) {
  return {
    "~standard": {
      version: 1,
      vendor: VENDOR,
      validate: (value) => {
        const issue = check(value);
        return issue === void 0 ? { value } : { issues: [{ message: issue }] };
      }
    }
  };
}
function checkString(record, field) {
  return typeof record[field] === "string" ? void 0 : `${field} must be a string`;
}
function checkOptionalString(record, field) {
  return record[field] === void 0 || typeof record[field] === "string" ? void 0 : `${field} must be a string`;
}
function checkOptionalNumber(record, field, nonNegative) {
  const value = record[field];
  if (value === void 0) return void 0;
  const ok = typeof value === "number" && Number.isFinite(value) && (!nonNegative || value >= 0);
  return ok ? void 0 : `${field} must be a ${nonNegative ? "finite non-negative" : "finite"} number`;
}
function checkUsableInput(value) {
  if (!isRecord(value)) return "input must be an object";
  return checkString(value, "agent") ?? checkString(value, "model");
}
function checkUsableOutput(value) {
  if (!isRecord(value)) return "output must be an object";
  if (typeof value.usable !== "boolean") return "usable must be a boolean";
  return checkOptionalString(value, "reason");
}
function checkLimitInput(value) {
  if (!isRecord(value)) return "input must be an object";
  const { error } = value;
  if (!isRecord(error)) return "error must be an object";
  return checkString(value, "agent") ?? checkString(value, "model") ?? checkString(error, "type") ?? checkString(error, "message") ?? checkOptionalNumber(error, "status", false) ?? checkOptionalString(error, "body") ?? checkOptionalNumber(value, "wait_ms", true) ?? checkOptionalNumber(value, "retry_after_ms", true);
}
function checkLimitOutput(value) {
  if (!isRecord(value)) return "output must be an object";
  if (typeof value.limit !== "boolean") return "limit must be a boolean";
  return checkOptionalNumber(value, "wait_ms", true) ?? checkOptionalString(value, "reason");
}
function checkLimitedEvent(value) {
  if (!isRecord(value)) return "event must be an object";
  if (!LIMIT_KINDS.includes(value.kind)) return `kind must be one of ${LIMIT_KINDS.join(", ")}`;
  return checkString(value, "session_id") ?? checkString(value, "agent") ?? checkString(value, "model") ?? checkString(value, "until") ?? checkOptionalNumber(value, "wait_ms", true) ?? checkOptionalString(value, "reason");
}
var STEPS_RPC = {
  id: STEPS_RPC_ID,
  methods: {
    usable: {
      input: schema(checkUsableInput),
      output: schema(checkUsableOutput)
    },
    limit: {
      input: schema(checkLimitInput),
      output: schema(checkLimitOutput)
    }
  },
  events: {}
};
var LIMITS_RPC = {
  id: LIMITS_RPC_ID,
  methods: {},
  events: {
    [LIMITED_EVENT]: { schema: schema(checkLimitedEvent) }
  }
};
export {
  LIMITED_EVENT,
  LIMITS_RPC,
  LIMITS_RPC_ID,
  STEPS_RPC,
  STEPS_RPC_ID
};
