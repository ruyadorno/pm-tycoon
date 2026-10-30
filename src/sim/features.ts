// Which later-milestone systems the sim runs (plan.md §12.4-§12.6). M1 shipped
// the city loop with a pass-through lane; the flags flip as the milestones
// land: `lane` (checkers roll, flagged parcels divert to the Hold Bay; the
// policy Tosses) and `lives` (malware delivered costs a life) are on since
// M2, `levels` (level-ups, region unlocks, lane growth) and `payroll`
// (paydays, walkouts) since M3 — every playtest-1 gate window is active.
// `people` (build 2, M6: applicants, stats, the Hold Bay sorter, drivers)
// gates nothing in the sim — the state shape cannot be toggled — but
// tools/sim/report.ts reads it for the people rows and the delegating policy.
// `quests` (build 2, M7: offers, goal counters, rewards, the magic parcel,
// the Golden Release) gates the quests tick step and its event observer.
// `levels3plus` (build 2, M8: the L3 row live — hubs, docks 2-3, the
// Battery checker) turns on the competent policy's L3 plan
// (src/sim/policies/levelPlan.ts) and gates the level3Min /
// firstOverseasClearedAfterLevel3MaxMin rows; `levels45` (M9: L4-L5) adds
// the plan's L4-L5 rows and gates level4Min / level5Min. The sim itself
// reads levels from data (economy.playtestMaxLevel), not from these flags.
// tools/sim/report.ts reads the same flags so a gate window whose system is
// not built yet prints as informational instead of failing.

export const SIM_FEATURES = {
  lane: true,
  lives: true,
  levels: true,
  payroll: true,
  people: true,
  quests: true,
  levels3plus: true,
  levels45: false,
}

export type SimFeature = keyof typeof SIM_FEATURES

/** The milestone that turns a feature on (gate notes, CLI output). */
export const FEATURE_MILESTONE: Record<SimFeature, string> = {
  lane: 'M2',
  lives: 'M2',
  levels: 'M3',
  payroll: 'M3',
  people: 'M6',
  quests: 'M7',
  levels3plus: 'M8',
  levels45: 'M9',
}
