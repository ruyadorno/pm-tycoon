// Which later-milestone systems the sim runs (plan.md §12.4-§12.6). M1 shipped
// the city loop with a pass-through lane; the flags flip as the milestones
// land: `lane` (checkers roll, flagged parcels divert to the Hold Bay; the
// policy Tosses) and `lives` (malware delivered costs a life) are on since
// M2, `levels` (level-ups, region unlocks, lane growth) and `payroll`
// (paydays, walkouts) since M3 — every playtest-1 gate window is active.
// tools/sim/report.ts reads the same flags so a gate window whose system is
// not built yet prints as informational instead of failing.

export const SIM_FEATURES = {
  lane: true,
  lives: true,
  levels: true,
  payroll: true,
}

export type SimFeature = keyof typeof SIM_FEATURES

/** The milestone that turns a feature on (gate notes, CLI output). */
export const FEATURE_MILESTONE: Record<SimFeature, string> = {
  lane: 'M2',
  lives: 'M2',
  levels: 'M3',
  payroll: 'M3',
}
