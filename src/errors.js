export class SmartContextError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SmartContextError";
    this.code = code;
    this.details = details;
  }
}

export function structuredError(error) {
  if (error instanceof SmartContextError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  }
  return { ok: false, error: { code: "internal_error", message: error.message || "Unexpected error", details: {} } };
}
