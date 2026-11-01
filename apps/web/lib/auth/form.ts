import { z } from "zod";

export type AuthActionState = {
  status: "idle" | "error" | "success";
  message: string;
};

export const initialAuthState: AuthActionState = { status: "idle", message: "" };

const credentialsSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email()).transform(value => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

export function readCredentials(formData: FormData, mode: "sign-in" | "sign-up") {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return null;
  if (mode === "sign-up" && parsed.data.password.length < 8) return null;
  return parsed.data;
}
