export type ActionState = { status: "idle" | "error" | "success"; message: string };

export const idle: ActionState = { status: "idle", message: "" };
