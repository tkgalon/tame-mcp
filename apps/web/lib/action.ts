import "server-only";
import { TameError } from "@tame/core";
import type { ActionState } from "./action-state";

export type { ActionState } from "./action-state";

// Known domain errors carry a message meant for the user, anything else stays generic
export function failure(error: unknown, fallback = "Something went wrong. Try again."): ActionState {
  return { status: "error", message: error instanceof TameError ? error.message : fallback };
}
