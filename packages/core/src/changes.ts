import type { ProfileChanges, ProfilePayload } from "@tame/contracts";

const COMPARED_FIELDS = [
  "name",
  "description",
  "whenToUse",
  "whenNotToUse",
  "output",
  "structure",
] as const satisfies readonly (keyof ProfilePayload)[];

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function diffProfiles(before: ProfilePayload, after: ProfilePayload): ProfileChanges {
  const previousRules = new Map(before.rules.map((rule) => [rule.id, rule]));
  const nextRules = new Map(after.rules.map((rule) => [rule.id, rule]));
  return {
    fields: COMPARED_FIELDS.filter((field) => !same(before[field], after[field])),
    rulesAdded: [...nextRules.keys()].filter((id) => !previousRules.has(id)),
    rulesRemoved: [...previousRules.keys()].filter((id) => !nextRules.has(id)),
    rulesChanged: [...nextRules]
      .filter(([id, rule]) => previousRules.has(id) && !same(previousRules.get(id), rule))
      .map(([id]) => id),
    evidenceChanged: !same(before.evidence, after.evidence),
  };
}

export function hasChanges(changes: ProfileChanges): boolean {
  return (
    changes.fields.length > 0 ||
    changes.rulesAdded.length > 0 ||
    changes.rulesRemoved.length > 0 ||
    changes.rulesChanged.length > 0 ||
    changes.evidenceChanged
  );
}
