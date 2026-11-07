export const PROFILE_TABS = ["overview", "structure", "rules", "evidence", "template", "history"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
