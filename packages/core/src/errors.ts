export type TameErrorCode =
  "not_found" | "invalid_input" | "invalid_evidence" | "version_conflict" | "conflict" | "unavailable";

// Messages are written for the agent or user who reads them, so they say what to do next
export class TameError extends Error {
  constructor(
    readonly code: TameErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new TameError("not_found", `${what} was not found.`);
