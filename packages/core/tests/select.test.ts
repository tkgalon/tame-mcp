import { describe, expect, it } from "vitest";
import { selectProfile } from "../src/select";

const ctf = {
  profileId: "ctf",
  name: "CTF Write-up",
  description: "Weekly CTF lab reports",
  whenToUse: ["Forensics or web challenge write-ups"],
};
const memo = {
  profileId: "memo",
  name: "Meeting notes",
  description: "Notes after a team meeting",
  whenToUse: ["Summarising a meeting"],
};

describe("selectProfile", () => {
  it("returns none without profiles", () => {
    expect(selectProfile([], "anything")).toEqual({ kind: "none" });
  });

  it("selects the only profile even without a task", () => {
    expect(selectProfile([ctf])).toEqual({ kind: "selected", profileId: "ctf" });
  });

  it("selects the profile whose name matches the task", () => {
    expect(selectProfile([ctf, memo], "bikin write-up Lab-08 pakai TAME")).toEqual({
      kind: "selected",
      profileId: "ctf",
    });
  });

  it("asks the user when nothing in the task matches", () => {
    expect(selectProfile([ctf, memo], "tolong rapikan ini").kind).toBe("ambiguous");
  });

  it("asks the user when two profiles tie", () => {
    const other = { ...ctf, profileId: "ctf-2" };
    expect(selectProfile([ctf, other], "CTF write-up").kind).toBe("ambiguous");
  });
});
