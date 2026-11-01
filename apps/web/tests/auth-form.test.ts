import { describe, expect, it } from "vitest";
import { readCredentials } from "../lib/auth/form";

function form(email: string, password: string) {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

describe("credentials", () => {
  it("normalizes email without changing the password", () => {
    expect(readCredentials(form("  User@Example.com ", " password "), "sign-in")).toEqual({
      email: "user@example.com", password: " password ",
    });
  });

  it("rejects missing, malformed, oversized, and file input", () => {
    expect(readCredentials(new FormData(), "sign-in")).toBeNull();
    expect(readCredentials(form("not-an-email", "password"), "sign-in")).toBeNull();
    expect(readCredentials(form("user@example.com", "a".repeat(129)), "sign-in")).toBeNull();
    const data = form("user@example.com", "password");
    data.set("email", new File(["user@example.com"], "email.txt"));
    expect(readCredentials(data, "sign-in")).toBeNull();
  });

  it("requires eight characters for new accounts without blocking older short passwords at sign-in", () => {
    expect(readCredentials(form("user@example.com", "short"), "sign-up")).toBeNull();
    expect(readCredentials(form("user@example.com", "short"), "sign-in")).not.toBeNull();
  });
});
