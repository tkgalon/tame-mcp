import { describe, expect, it } from "vitest";
import { readAuthConfig } from "../lib/auth/config";

const configuration = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only",
  TAME_SITE_URL: "https://tame.example",
};

describe("authentication configuration", () => {
  it("requires complete configuration and rejects secret keys", () => {
    expect(readAuthConfig({})).toBeNull();
    expect(readAuthConfig({ ...configuration, TAME_SITE_URL: "" })).toBeNull();
    expect(readAuthConfig({ ...configuration, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" })).toBeNull();
    const serviceRole = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
    expect(readAuthConfig({ ...configuration, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceRole })).toBeNull();
  });

  it("supports publishable keys and legacy anon keys", () => {
    expect(readAuthConfig(configuration)?.siteUrl).toBe("https://tame.example");
    const anon = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
    expect(readAuthConfig({ ...configuration, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon })).not.toBeNull();
  });

  it("allows HTTP only on loopback and normalizes the callback origin", () => {
    expect(readAuthConfig({ ...configuration, NEXT_PUBLIC_SUPABASE_URL: "http://remote.example" })).toBeNull();
    expect(readAuthConfig({ ...configuration, TAME_SITE_URL: "javascript:alert(1)" })).toBeNull();
    expect(readAuthConfig({ ...configuration, TAME_SITE_URL: "http://localhost:3000/path?next=bad" })?.siteUrl).toBe("http://localhost:3000");
  });
});

