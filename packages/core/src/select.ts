export type ProfileCandidate = {
  profileId: string;
  name: string;
  description: string;
  whenToUse: string[];
};

export type Selection =
  | { kind: "none" }
  | { kind: "selected"; profileId: string }
  | { kind: "ambiguous"; candidates: ProfileCandidate[] };

const words = (value: string) => new Set(value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

function score(task: Set<string>, candidate: ProfileCandidate): number {
  const name = words(candidate.name);
  const context = words([candidate.description, ...candidate.whenToUse].join(" "));
  let total = 0;
  for (const word of task) {
    if (name.has(word)) total += 3;
    else if (context.has(word)) total += 1;
  }
  return total;
}

// Literal word overlap is enough for a handful of personal profiles and is easy to explain.
// When two profiles tie, the agent asks the user instead of guessing.
export function selectProfile(candidates: ProfileCandidate[], task?: string): Selection {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "selected", profileId: candidates[0]!.profileId };
  if (!task?.trim()) return { kind: "ambiguous", candidates };

  const taskWords = words(task);
  const ranked = candidates
    .map((candidate) => ({ candidate, score: score(taskWords, candidate) }))
    .sort((left, right) => right.score - left.score);
  const [best, second] = ranked;
  if (best && best.score > 0 && best.score > (second?.score ?? 0)) {
    return { kind: "selected", profileId: best.candidate.profileId };
  }
  return { kind: "ambiguous", candidates };
}
