// events.json (spec-build3 §3, §4.1, §7; M11 contract §3 stream E, critique
// 20-23): the shipped deck validates; every checkEvents rule has a
// mutate-and-expect case (ids, the next graph, defaults, routers and branch
// lists, the harsh-consequence rule with its way out on the card — free or
// covered by the card's cond — or on every path from a head, paid options,
// danger, targets and picks, district / hub scopes, `mod` mult / add /
// scope, pips stats, ★ defs, flags, categories, placeholders, the puns
// lines); the wave-0 shape rules (mult 0 legal, the job kinds rejected, the
// schedule's fixed keys, intervalS keys); the modifier key split agrees with
// src/sim/modifiers.ts. Copy: every label is ≤ 28 glyphs filled with the
// longest names, every rendered string is in m5x7 glyphs (no `≥`, D-20),
// and the copy-fit placeholder (B3 §3.4, the EventCard lands in M12): the
// title in 1 line and the body in ≤ 4 lines of the 220-px text column beside
// the 48-px picture, each option's generated effects line in ≤ 2 lines of
// the card's 276-px inner width — measured with the m5x7 advance widths and
// the Newspaper's wrapHeadline algorithm, re-implemented here Phaser-free.
// The real fit through the EventCard's layout: tests/data/events-fit.test.ts
// (M12) — run both with vlr test -- tests/data/events.
// The static EV max (B3 §3.8, critique 20: life gains left out) holds for
// every option. Gated on the full deck (M13, ≥ 100 cards): every bounds key
// is used by some card, and ≥ 30 cards are L1-eligible. The M13 review rules
// (plan-build3 §8.4 task 3), each with a mutate-and-expect case: the spec's
// policy band pinned (evBand [−20, 40], evMax 400, nonDefaultShareMin 0.4),
// L1 never costs a life or a vehicle (an L1 head, the rescue, a link that
// can open at L1), decision cards outweigh news in every category, and no
// two drawable cards of one category share a shape.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGameData, validateGameData } from '../../src/data/index.ts'
import {
  isHarshEffect,
  MODIFIER_KEYS,
  MULT_MODIFIER_KEYS,
} from '../../src/data/schema.ts'
import type {
  EventDef,
  EventEffect,
  EventOptionDef,
  GameData,
} from '../../src/data/types.ts'
import { ADD_KEYS, MULT_KEYS } from '../../src/sim/modifiers.ts'
import { staticScore } from '../../src/sim/policies/eventPolicy.ts'
import {
  cardOptions,
  optionLines,
  type CardOption,
} from '../../src/sim/systems/deck.ts'
import type { CardPickRole } from '../../src/data/types.ts'
import type { OpenCard } from '../../src/sim/types.ts'
import { loadRawData } from '../../tools/sim/load.node.ts'
import { makeSim, unlockDistrict } from '../sim/helpers.ts'

/** A mutable deep copy of the shipped tables. */
const fresh = (): Record<string, any> => structuredClone(loadRawData())
const data: GameData = buildGameData(loadRawData())
const deck: readonly EventDef[] = data.events.deck

/** The deck problems after `mutate` (only the events / puns paths). */
function problems(mutate: (raw: Record<string, any>) => void): string[] {
  const raw = fresh()
  mutate(raw)
  return validateGameData(raw).filter(
    (p) => p.startsWith('events.') || p.startsWith('puns.'),
  )
}

const at = (id: string): number => deck.findIndex((c) => c.id === id)
const cardOf = (raw: Record<string, any>, id: string): Record<string, any> =>
  (raw.events.deck as Record<string, any>[]).find((c) => c.id === id)!

describe('events.json: the shipped deck', () => {
  it('validates with no problems', () => {
    expect(validateGameData(loadRawData())).toEqual([])
  })

  it('ids are ev_ prefixed and every card sits in a known category', () => {
    for (const c of deck) {
      expect(c.id).toMatch(/^ev_[a-z0-9_]+$/)
      expect(Object.keys(data.events.categories)).toContain(c.category)
    }
  })

  it('the modifier key split agrees with src/sim/modifiers.ts: MULT ∪ ADD = MODIFIER_KEYS', () => {
    expect([...MULT_KEYS].toSorted()).toEqual(
      [...MULT_MODIFIER_KEYS].toSorted(),
    )
    expect([...MULT_KEYS, ...ADD_KEYS].toSorted()).toEqual(
      [...MODIFIER_KEYS].toSorted(),
    )
    expect(
      MULT_KEYS.filter((k) => (ADD_KEYS as readonly string[]).includes(k)),
    ).toEqual([])
    expect(Object.keys(data.events.modifiers.bounds).toSorted()).toEqual(
      [...MODIFIER_KEYS].toSorted(),
    )
  })

  it('isHarshEffect: a life lost, a vehicle lost, a quit, everyone away', () => {
    const harsh: EventEffect[] = [
      { kind: 'lives', delta: -1 },
      { kind: 'vehicle', lose: 'bike', fallback: -250 },
      { kind: 'staff', quit: 'inspector', pick: 'one' },
      { kind: 'staff', absent: 'vehicles', pick: 'all', days: 1 },
    ]
    const mild: EventEffect[] = [
      { kind: 'lives', delta: 1 },
      { kind: 'vehicle', gain: 'van' },
      { kind: 'staff', absent: 'inspector', pick: 'one', days: 1 },
      { kind: 'money', delta: -500 },
    ]
    expect(harsh.map((e) => isHarshEffect(e))).toEqual([true, true, true, true])
    expect(mild.map((e) => isHarshEffect(e))).toEqual([
      false,
      false,
      false,
      false,
    ])
  })
})

describe('events.json: the shape (wave 0)', () => {
  it('mult 0 is legal (ev_sec_insurance: wrongTossFee ×0, perm)', () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_tech_barcode').options[0].effects = [
          { kind: 'mod', key: 'wrongTossFee', mult: 0 },
        ]
      }),
    ).toEqual([])
  })

  it('job / jobDecline effects are synthesized, never in events.json', () => {
    const i = at('ev_money_grant')
    expect(
      problems((r) => {
        cardOf(r, 'ev_money_grant').options[0].effects = [
          { kind: 'job', templateId: 'rush_district' },
        ]
      }),
    ).toContainEqual(
      `events.deck[${i}].options[0].effects[0].kind: "job" effects are synthesized, never in events.json`,
    )
  })

  it('the schedule: one open card, links never restart the timer, level keys from "1"', () => {
    const p = problems((r) => {
      r.events.schedule.maxOpen = 2
      r.events.schedule.linkRestartsTimer = true
      r.events.schedule.intervalS = { '0': [1, 2], '2': [5.5, 9] }
    })
    expect(p).toContainEqual(
      'events.schedule.maxOpen: expected one of 1, got 2',
    )
    expect(p).toContainEqual(
      'events.schedule.linkRestartsTimer: expected one of false, got true',
    )
    expect(p).toContainEqual(
      'events.schedule.intervalS.0: expected a level number key ("1", "2", …)',
    )
    expect(p).toContainEqual(
      'events.schedule.intervalS.1: missing (the level-1 band)',
    )
    expect(p).toContainEqual(
      'events.schedule.intervalS.2[0]: expected an integer, got 5.5',
    )
  })

  it('unknown keys and bad leaf types are problems', () => {
    const i = at('ev_wx_rain')
    const p = problems((r) => {
      const c = cardOf(r, 'ev_wx_rain')
      c.colour = 'red'
      c.options[0].effects = [{ kind: 'money', delta: 1.5 }]
    })
    expect(p).toContainEqual(`events.deck[${i}].colour: unknown key`)
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[0].delta: expected an integer, got 1.5`,
    )
  })
})

describe('checkEvents: ids and the next graph', () => {
  it('ids are unique', () => {
    expect(
      problems((r) => {
        r.events.deck.push({ ...cardOf(r, 'ev_wx_rain') })
      }),
    ).toContainEqual(
      `events.deck[${deck.length}].id: duplicate id "ev_wx_rain" (first at events.deck[${at('ev_wx_rain')}])`,
    )
  })

  it('every next, branch and end names a card', () => {
    const gang = at('ev_crime_gang')
    const day = at('ev_city_audit_day')
    const fail = at('ev_city_audit_fail')
    const grant = at('ev_money_grant')
    const p = problems((r) => {
      cardOf(r, 'ev_crime_gang').options[1].effects[0].eventId = 'ev_nope'
      cardOf(r, 'ev_city_audit_day').next.branches[1].id = 'ev_gone'
      cardOf(r, 'ev_city_audit_fail').options[1].effects[0].branches[0].id =
        'ev_lost'
      cardOf(r, 'ev_money_grant').options[0].effects.push({
        kind: 'end',
        eventId: 'ev_nobody',
      })
    })
    expect(p).toContainEqual(
      `events.deck[${gang}].options[1].effects[0].eventId: unknown event "ev_nope"`,
    )
    expect(p).toContainEqual(
      `events.deck[${day}].next.branches[1].id: unknown event "ev_gone"`,
    )
    expect(p).toContainEqual(
      `events.deck[${fail}].options[1].effects[0].branches[0].id: unknown event "ev_lost"`,
    )
    expect(p).toContainEqual(
      `events.deck[${grant}].options[0].effects[1].eventId: unknown event "ev_nobody"`,
    )
  })

  it('the next graph is acyclic', () => {
    const p = problems((r) => {
      cardOf(r, 'ev_crime_gang_bust').options[0].effects.push({
        kind: 'next',
        eventId: 'ev_crime_gang_watch',
        days: 1,
      })
    })
    expect(p).toContainEqual(
      `events.deck[${at('ev_crime_gang_watch')}].id: the next graph has a cycle through "ev_crime_gang_watch" ("ev_crime_gang_return", "ev_crime_gang_bust", "ev_crime_gang_watch")`,
    )
  })

  it('no chain runs past schedule.chainMaxLinks cards (routers count)', () => {
    const p = problems((r) => {
      r.events.schedule.chainMaxLinks = 3
    })
    expect(p).toContainEqual(
      `events.deck[${at('ev_crime_gang')}]: a chain from "ev_crime_gang" runs 4 cards, more than schedule.chainMaxLinks 3`,
    )
    expect(p).toContainEqual(
      `events.deck[${at('ev_city_audit')}]: a chain from "ev_city_audit" runs 4 cards, more than schedule.chainMaxLinks 3`,
    )
  })

  it('a booked link, a router and a rescue card are never drawable', () => {
    const p = problems((r) => {
      cardOf(r, 'ev_crime_gang_return').drawable = true
      cardOf(r, 'ev_city_audit_day').drawable = true
      cardOf(r, 'ev_luck_loaner').drawable = true
    })
    expect(p).toContainEqual(
      `events.deck[${at('ev_crime_gang_return')}].drawable: a chain link (booked by a next or a router) must be \`drawable: false\``,
    )
    expect(p).toContainEqual(
      `events.deck[${at('ev_city_audit_day')}].drawable: a router must be \`drawable: false\``,
    )
    expect(p).toContainEqual(
      `events.deck[${at('ev_luck_loaner')}].drawable: a rescue card must be \`drawable: false\``,
    )
  })

  it('a next is due within schedule.linkMaxDays', () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_crime_gang').options[1].effects[0].days = 4
      }),
    ).toContainEqual(
      `events.deck[${at('ev_crime_gang')}].options[1].effects[0].days: 4 is more than schedule.linkMaxDays 3`,
    )
  })

  it('a branch list ends with exactly one if-less branch', () => {
    const day = at('ev_city_audit_day')
    const fail = at('ev_city_audit_fail')
    const p = problems((r) => {
      cardOf(r, 'ev_city_audit_day').next.branches[1].if = {
        flag: 'audit_ready',
      }
      delete cardOf(r, 'ev_city_audit_fail').options[1].effects[0].branches[0]
        .if
    })
    expect(p).toContainEqual(
      `events.deck[${day}].next.branches[1].if: the last branch is the else: it has no \`if\``,
    )
    expect(p).toContainEqual(
      `events.deck[${fail}].options[1].effects[0].branches[0]: only the last branch may omit \`if\` (exactly one else, at the end)`,
    )
  })
})

describe('checkEvents: cards, routers, defaults', () => {
  it('exactly one default per card', () => {
    const p = problems((r) => {
      delete cardOf(r, 'ev_wx_rain').options[0].default
      cardOf(r, 'ev_press_ad').options[0].default = true
    })
    expect(p).toContainEqual(
      `events.deck[${at('ev_wx_rain')}].options: exactly one option is the default, got 0`,
    )
    expect(p).toContainEqual(
      `events.deck[${at('ev_press_ad')}].options: exactly one option is the default, got 2`,
    )
  })

  it('a router has next (0 days) and no body or options', () => {
    const i = at('ev_city_audit_day')
    const p = problems((r) => {
      const c = cardOf(r, 'ev_city_audit_day')
      c.body = 'Audit day.'
      c.options = [{ label: 'OK', default: true, effects: [] }]
      c.next.days = 1
    })
    expect(p).toContainEqual(
      `events.deck[${i}].next.days: a router resolves at once (0), got 1`,
    )
    expect(p).toContainEqual(`events.deck[${i}].body: a router has no body`)
    expect(p).toContainEqual(
      `events.deck[${i}].options: a router has no options`,
    )
    expect(
      problems((r) => {
        delete cardOf(r, 'ev_city_audit_day').next
      }),
    ).toContainEqual(`events.deck[${i}].next: a router needs \`next\``)
  })

  it('a card that is not a router has a body, options and no next', () => {
    const i = at('ev_wx_rain')
    const p = problems((r) => {
      const c = cardOf(r, 'ev_wx_rain')
      delete c.body
      c.next = { days: 0, branches: [{ id: 'ev_city_audit_pass' }] }
    })
    expect(p).toContainEqual(`events.deck[${i}].body: missing`)
    expect(p).toContainEqual(
      `events.deck[${i}].next: only a router has \`next\` (an option books its own)`,
    )
    expect(
      problems((r) => {
        delete cardOf(r, 'ev_wx_rain').options
      }),
    ).toContainEqual(`events.deck[${i}].options: missing (1–3 options)`)
  })

  it('a rescue card has one option', () => {
    const i = at('ev_luck_loaner')
    expect(
      problems((r) => {
        cardOf(r, 'ev_luck_loaner').options.push({ label: 'No', effects: [] })
      }),
    ).toContainEqual(
      `events.deck[${i}].options: a rescue card has one option, got 2`,
    )
  })

  it('the default is always shown and affordable; some option is always shown', () => {
    const ad = at('ev_press_ad')
    const rain = at('ev_wx_rain')
    const p = problems((r) => {
      const c = cardOf(r, 'ev_press_ad')
      c.options[0].default = true
      delete c.options[1].default
      cardOf(r, 'ev_wx_rain').options[0].if = { livesAtLeast: 2 }
    })
    expect(p).toContainEqual(
      `events.deck[${ad}].options[0].cost: a paid default needs the card's cond balanceAtLeast ≥ 120 (the default must be affordable)`,
    )
    expect(p).toContainEqual(
      `events.deck[${rain}].options[0].if: the default option is always shown (no \`if\`)`,
    )
    expect(p).toContainEqual(
      `events.deck[${rain}].options: at least one option has no \`if\` (always shown)`,
    )
  })

  it('minLevel names a level', () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_wx_rain').minLevel = 9
      }),
    ).toContainEqual(
      `events.deck[${at('ev_wx_rain')}].minLevel: level 9 does not exist`,
    )
  })
})

describe('checkEvents: the harsh-consequence rule (B3 §3.5, critique 21-22)', () => {
  it('never on a one-option card', () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_wx_rain').options[0].effects.push({
          kind: 'staff',
          quit: 'inspector',
          pick: 'worst',
        })
      }),
    ).toContainEqual(
      `events.deck[${at('ev_wx_rain')}].options[0]: a harsh effect (a life, a vehicle, a worker) never sits on a one-option card`,
    )
  })

  it('a drawn card needs a way out: another always-shown, harsh-free option the card keeps affordable', () => {
    const i = at('ev_sec_recall')
    const msg = `events.deck[${i}].options[1]: a harsh effect needs a way out on a drawn card: another option with no \`if\`, free of harsh effects, and free or covered by the card's cond balanceAtLeast`
    // The shipped recall: Pay ($250) is covered by cond balanceAtLeast 250.
    expect(problems(() => {})).not.toContainEqual(msg)
    // Without the cond the strike could be the only affordable option.
    expect(
      problems((r) => {
        delete cardOf(r, 'ev_sec_recall').cond
      }),
    ).toContainEqual(msg)
    // A cond below the fine is not enough either.
    expect(
      problems((r) => {
        cardOf(r, 'ev_sec_recall').cond = { balanceAtLeast: 200 }
      }),
    ).toContainEqual(msg)
    // A way out behind an `if` may be hidden.
    expect(
      problems((r) => {
        cardOf(r, 'ev_sec_recall').options[0].if = { livesAtLeast: 1 }
      }),
    ).toContainEqual(msg)
    // A free sibling is always a way out.
    expect(
      problems((r) => {
        const c = cardOf(r, 'ev_sec_recall')
        delete c.cond
        delete c.options[0].cost
      }),
    ).not.toContainEqual(msg)
  })

  it('a link may leave its way out on the chain: every path from a head passes a card that avoids it', () => {
    // The gang's watch with its "Yes" hidden: the head's Accept ($300)
    // never books the watch — a way out once the head's cond covers it.
    const watch = at('ev_crime_gang_watch')
    const msg = `events.deck[${watch}].options[1]: a harsh effect with no way out on this link, and none on the way from "ev_crime_gang" (every path from a head needs an always-shown option that avoids it)`
    expect(
      problems((r) => {
        cardOf(r, 'ev_crime_gang_watch').options[0].if = { flag: 'gang_paid' }
        cardOf(r, 'ev_crime_gang').cond = { balanceAtLeast: 300 }
      }).filter((p) => p.startsWith(`events.deck[${watch}].options[1]`)),
    ).toEqual([])
    // Uncovered (review policy-2): the head can grey out its Accept, so the
    // only shown answer books the watch — no way out.
    expect(
      problems((r) => {
        cardOf(r, 'ev_crime_gang_watch').options[0].if = { flag: 'gang_paid' }
      }),
    ).toContainEqual(msg)
    // Once the head's Accept also books the watch, no path avoids it.
    expect(
      problems((r) => {
        cardOf(r, 'ev_crime_gang_watch').options[0].if = { flag: 'gang_paid' }
        cardOf(r, 'ev_crime_gang').cond = { balanceAtLeast: 300 }
        cardOf(r, 'ev_crime_gang').options[0].effects = [
          { kind: 'next', eventId: 'ev_crime_gang_watch', days: 2 },
        ]
      }),
    ).toContainEqual(msg)
  })

  it('a harsh or unaffordable option is no escape on the way to a link (review policy-2)', () => {
    const watch = at('ev_crime_gang_watch')
    const msg = (j: number): string =>
      `events.deck[${watch}].options[${j}]: a harsh effect with no way out on this link, and none on the way from "ev_crime_gang" (every path from a head needs an always-shown option that avoids it)`
    /** The watch: both answers take a life. */
    const deadly = (r: Record<string, any>): void => {
      const w = cardOf(r, 'ev_crime_gang_watch')
      w.options[0] = {
        label: 'Yes',
        danger: true,
        effects: [{ kind: 'lives', delta: -1 }],
      }
      w.options[1] = {
        label: 'No',
        default: true,
        danger: true,
        effects: [{ kind: 'lives', delta: -1 }],
      }
    }
    // The head's other answer takes a life itself: it is no escape.
    const fight = problems((r) => {
      deadly(r)
      cardOf(r, 'ev_crime_gang').options[0] = {
        label: 'Fight them',
        danger: true,
        effects: [{ kind: 'lives', delta: -1 }],
      }
    })
    expect(fight).toContainEqual(msg(0))
    expect(fight).toContainEqual(msg(1))
    // A paid escape the head's cond does not cover is none either …
    const paid = (r: Record<string, any>): void => {
      cardOf(r, 'ev_crime_gang_watch').options = [
        { label: 'Pay ($500)', cost: 500, effects: [] },
        {
          label: 'Take the strike',
          default: true,
          danger: true,
          effects: [{ kind: 'lives', delta: -1 }],
        },
      ]
    }
    expect(problems(paid)).toContainEqual(msg(1))
    // … and is one once the cond covers it; so is a free harsh-free answer.
    expect(
      problems((r) => {
        paid(r)
        cardOf(r, 'ev_crime_gang').cond = { balanceAtLeast: 300 }
      }),
    ).not.toContainEqual(msg(1))
    expect(
      problems((r) => {
        deadly(r)
        delete cardOf(r, 'ev_crime_gang').options[0].cost
      }),
    ).not.toContainEqual(msg(1))
  })

  it("the audit fine: the way out three cards up (the failed audit's Pay, covered by its cond) counts; uncovered or hidden, it does not", () => {
    const fine = at('ev_city_audit_fine')
    const msg = `events.deck[${fine}].options[1]: a harsh effect with no way out on this link, and none on the way from "ev_city_audit" (every path from a head needs an always-shown option that avoids it)`
    expect(
      problems((r) => {
        delete cardOf(r, 'ev_city_audit_fine').cond
        cardOf(r, 'ev_city_audit_fail').cond = { balanceAtLeast: 250 }
      }),
    ).not.toContainEqual(msg)
    expect(
      problems((r) => {
        delete cardOf(r, 'ev_city_audit_fine').cond
      }),
    ).toContainEqual(msg)
    expect(
      problems((r) => {
        delete cardOf(r, 'ev_city_audit_fine').cond
        cardOf(r, 'ev_city_audit_fail').cond = { balanceAtLeast: 250 }
        cardOf(r, 'ev_city_audit_fail').options[0].if = { flag: 'audit_ready' }
      }),
    ).toContainEqual(msg)
  })

  it('an option that can take a life is danger', () => {
    expect(
      problems((r) => {
        delete cardOf(r, 'ev_sec_recall').options[1].danger
      }),
    ).toContainEqual(
      `events.deck[${at('ev_sec_recall')}].options[1].danger: an option that can take a life is \`danger: true\``,
    )
  })

  it('a paid option has an unpaid, always-shown sibling', () => {
    const i = at('ev_tech_barcode')
    const p = problems((r) => {
      cardOf(r, 'ev_tech_barcode').options[1].cost = 10
    })
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].cost: a paid option needs an unpaid sibling with no \`if\` (a card never greys out every option)`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[1].cost: a paid option needs an unpaid sibling with no \`if\` (a card never greys out every option)`,
    )
  })

  it('review deck-1: costPerVehicle is a price — never with cost, never on the default, and it needs an unpaid sibling', () => {
    const radio = at('ev_staff_radio')
    const snow = at('ev_wx_snow')
    const service = at('ev_fleet_service')
    expect(problems(() => {})).toEqual([])
    const p = problems((r) => {
      cardOf(r, 'ev_staff_radio').options[0].cost = 10
      const l = cardOf(r, 'ev_wx_snow')
      l.options[1].costPerVehicle = { each: 5 }
      const sv = cardOf(r, 'ev_fleet_service')
      sv.options[1].costPerVehicle = { each: 5, type: 'van' }
    })
    expect(p).toContainEqual(
      `events.deck[${radio}].options[0].costPerVehicle: an option takes \`cost\` or \`costPerVehicle\`, not both`,
    )
    expect(p).toContainEqual(
      `events.deck[${snow}].options[1].costPerVehicle: the default never takes a per-vehicle price (a fleet-sized price no cond can cover)`,
    )
    expect(p).toContainEqual(
      `events.deck[${snow}].options[0].costPerVehicle: a paid option needs an unpaid sibling with no \`if\` (a card never greys out every option)`,
    )
    expect(p).toContainEqual(
      `events.deck[${service}].options[1].costPerVehicle: a paid option needs an unpaid sibling with no \`if\` (a card never greys out every option)`,
    )
    expect(
      problems((r) => {
        cardOf(r, 'ev_staff_radio').options[0].costPerVehicle = { each: 0 }
      }).length,
    ).toBeGreaterThan(0)
  })
})

describe('checkEvents: targets, picks and scopes', () => {
  it('a target scope or {district} needs a target on the card or its chain head', () => {
    const i = at('ev_cust_refund')
    const p = problems((r) => {
      delete cardOf(r, 'ev_cust_refund').target
    })
    expect(p).toContainEqual(
      `events.deck[${i}].body: {district} needs \`target\` on the card or on its chain head`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[0].scope: scope "target" needs \`target\` on the card or on its chain head`,
    )
    // A link inherits its head's target: the gang's return gets one only
    // through the head.
    const ret = at('ev_crime_gang_return')
    const linked = (head: boolean): string[] =>
      problems((r) => {
        cardOf(r, 'ev_crime_gang_return').options[1].effects[0].scope = 'target'
        if (head) cardOf(r, 'ev_crime_gang').target = 'busiest'
      })
    const msg = `events.deck[${ret}].options[1].effects[0].scope: scope "target" needs \`target\` on the card or on its chain head`
    expect(linked(false)).toContainEqual(msg)
    expect(linked(true)).not.toContainEqual(msg)
  })

  it('a person placeholder or a `one` effect needs a pick of that role', () => {
    const i = at('ev_staff_training')
    const p = problems((r) => {
      delete cardOf(r, 'ev_staff_training').pick
    })
    expect(p).toContainEqual(
      `events.deck[${i}].options[1].label: {inspector} needs \`pick: "inspector"\` on the card or on its chain head`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[1].effects[0].scope: "one" needs \`pick: "inspector"\` on the card or on its chain head`,
    )
    const q = problems((r) => {
      cardOf(r, 'ev_staff_training').pick = 'driver'
    })
    expect(q).toContainEqual(
      `events.deck[${i}].options[1].label: {inspector} needs \`pick: "inspector"\` on the card or on its chain head`,
    )
  })

  it('absent vehicles with `one` needs pick "vehicle"; a driver is away with the vehicle', () => {
    const i = at('ev_wx_rain')
    const p = problems((r) => {
      cardOf(r, 'ev_wx_rain').options[0].effects = [
        { kind: 'staff', absent: 'vehicles', pick: 'one', days: 1 },
        { kind: 'staff', absent: 'driver', pick: 'all', days: 1 },
      ]
    })
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[0].pick: "one" needs \`pick: "vehicle"\` on the card or on its chain head`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[1].absent: a driver is away with the vehicle: use absent "vehicles"`,
    )
  })

  it('a staff quit `one` needs the pick of its role', () => {
    const i = at('ev_staff_training')
    expect(
      problems((r) => {
        cardOf(r, 'ev_staff_training').options[0].effects.push({
          kind: 'staff',
          quit: 'sorter',
          pick: 'one',
        })
      }),
    ).toContainEqual(
      `events.deck[${i}].options[0].effects[1].pick: "one" needs \`pick: "sorter"\` on the card or on its chain head`,
    )
  })

  it('a target: random card is never eligible on its target (D-28)', () => {
    const i = at('ev_cust_refund')
    expect(
      problems((r) => {
        const c = cardOf(r, 'ev_cust_refund')
        c.target = 'random'
        c.cond = { satBelow: { scope: 'target', value: 50 } }
      }),
    ).toContainEqual(
      `events.deck[${i}].cond.satBelow: a target: "random" card cannot be eligible on its target (D-28): the target is drawn after the card`,
    )
  })

  it('targets, spawn scopes and parcels.at are spawning districts; clearanceS scopes a hub', () => {
    const refund = at('ev_cust_refund')
    const ad = at('ev_press_ad')
    const port = at('ev_port_fastlane')
    const grant = at('ev_money_grant')
    const p = problems((r) => {
      cardOf(r, 'ev_cust_refund').target = 'docks'
      cardOf(r, 'ev_press_ad').options[0].effects[0].scope = 'airport'
      cardOf(r, 'ev_port_fastlane').options[0].effects[0].scope = 'downtown'
      cardOf(r, 'ev_money_grant').options[0].effects.push({
        kind: 'parcels',
        spawn: { size: 'L', count: 3, at: 'docks' },
      })
    })
    expect(p).toContainEqual(
      `events.deck[${refund}].target: "docks" is an overseas hub, not a spawning district`,
    )
    expect(p).toContainEqual(
      `events.deck[${ad}].options[0].effects[0].scope: "airport" is an overseas hub, not a spawning district`,
    )
    expect(p).toContainEqual(
      `events.deck[${port}].options[0].effects[0].scope: clearanceS scopes an overseas hub, got "downtown"`,
    )
    expect(p).toContainEqual(
      `events.deck[${grant}].options[0].effects[1].spawn.at: "docks" is an overseas hub, not a spawning district`,
    )
    const q = problems((r) => {
      cardOf(r, 'ev_cust_refund').target = 'nowhere'
      cardOf(r, 'ev_cust_refund').options[0].effects[0].scope = 'everyone'
    })
    expect(q).toContainEqual(
      `events.deck[${refund}].target: expected busiest | lowest | random | a spawning district id, got "nowhere"`,
    )
    expect(q).toContainEqual(
      `events.deck[${refund}].options[0].effects[0].scope: expected all | target | busiest | lowest | a spawning district id, got "everyone"`,
    )
  })

  it('hubLive names an overseas district; a sat scope is known', () => {
    const i = at('ev_port_fastlane')
    const p = problems((r) => {
      cardOf(r, 'ev_port_fastlane').cond = {
        anyOf: [
          { hubLive: 'downtown' },
          { satAtLeast: { scope: 'docks', value: 40 } },
        ],
      }
    })
    expect(p).toContainEqual(
      `events.deck[${i}].cond.hubLive: "downtown" is not an overseas district`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].cond.satAtLeast.scope: expected all | target | busiest | lowest | a spawning district id, got "docks"`,
    )
  })
})

describe('checkEvents: effects', () => {
  it('a mod has exactly one of mult (mult keys) and add (add keys)', () => {
    const i = at('ev_tech_barcode')
    const p = problems((r) => {
      cardOf(r, 'ev_tech_barcode').options[0].effects = [
        { kind: 'mod', key: 'processS', mult: 0.9, add: 1 },
        { kind: 'mod', key: 'inspectorP', mult: 1.1 },
        { kind: 'mod', key: 'income', add: 0.1 },
      ]
    })
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[0]: a mod has exactly one of mult and add`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[1].mult: "inspectorP" is additive: use add`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[2].add: "income" is multiplicative: use mult`,
    )
  })

  it('a mod scope: speed a vehicle type, processS desk | machine, none on the other keys', () => {
    const i = at('ev_tech_barcode')
    const p = problems((r) => {
      cardOf(r, 'ev_tech_barcode').options[0].effects = [
        { kind: 'mod', key: 'speed', mult: 0.9, scope: 'boat', days: 1 },
        { kind: 'mod', key: 'processS', mult: 0.9, scope: 'sorter' },
        { kind: 'mod', key: 'income', mult: 1.1, scope: 'bike', days: 1 },
      ]
    })
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[0].scope: speed scopes a vehicle type, got "boat"`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[1].scope: processS scopes desk | machine, got "sorter"`,
    )
    expect(p).toContainEqual(
      `events.deck[${i}].options[0].effects[2].scope: "income" takes no scope (only speed, spawn, processS, clearanceS)`,
    )
  })

  it("pips name one of the role's stats", () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_staff_training').options[0].effects[0].stat = 'speed'
      }),
    ).toContainEqual(
      `events.deck[${at('ev_staff_training')}].options[0].effects[0].stat: "speed" is not a inspector stat (eye, pace, charisma)`,
    )
  })

  it('★ defs and the volunteer driver get the quest star checks', () => {
    const friend = at('ev_luck_friend')
    const loaner = at('ev_luck_loaner')
    const p = problems((r) => {
      const star = cardOf(r, 'ev_luck_friend').options[0].effects[0].star
      star.pips = { speed: 4, energy: 4, charisma: 3 }
      star.role = 'inspector'
      const v = cardOf(r, 'ev_luck_loaner').options[0].effects[0].withDriver
      v.role = 'sorter'
      v.pips = { judgement: 3, pace: 3 }
    })
    expect(p).toContainEqual(
      `events.deck[${friend}].options[0].effects[0].star.pips: expected the inspector stats ["eye","pace","charisma"], got ["speed","energy","charisma"]`,
    )
    expect(p).toContainEqual(
      `events.deck[${friend}].options[0].effects[0].star.pips.charisma: 3 is outside 0..2`,
    )
    expect(p).toContainEqual(
      `events.deck[${loaner}].options[0].effects[0].withDriver.role: the volunteer is a driver`,
    )
  })

  it('end names a card that applies a modifier', () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_press_ad').options[1].effects = [
          { kind: 'end', eventId: 'ev_money_grant' },
        ]
      }),
    ).toContainEqual(
      `events.deck[${at('ev_press_ad')}].options[1].effects[0].eventId: "ev_money_grant" applies no modifier (mod or cap) to end`,
    )
    expect(
      problems((r) => {
        cardOf(r, 'ev_press_ad').options[1].effects = [
          { kind: 'end', eventId: 'ev_tech_barcode' },
        ]
      }),
    ).toEqual([])
  })

  it('a condition reads only flags some option sets', () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_money_grant').cond = { notFlag: 'grant_taken' }
      }),
    ).toContainEqual(
      `events.deck[${at('ev_money_grant')}].cond.notFlag: no option sets the flag "grant_taken"`,
    )
    expect(
      problems((r) => {
        const c = cardOf(r, 'ev_money_grant')
        c.cond = { notFlag: 'grant_taken' }
        c.options[0].effects.push({ kind: 'flag', set: 'grant_taken' })
      }),
    ).toEqual([])
  })
})

describe('checkEvents: tables, categories and copy', () => {
  it('every category picture is ev_pic_<category>', () => {
    expect(
      problems((r) => {
        r.events.categories.luck.picture = 'ev_pic_lucky'
      }),
    ).toContainEqual(
      'events.categories.luck.picture: expected "ev_pic_luck", got "ev_pic_lucky"',
    )
  })

  it('only the known placeholders', () => {
    expect(
      problems((r) => {
        cardOf(r, 'ev_money_grant').body = 'The {boss} signs a grant.'
      }),
    ).toContainEqual(
      `events.deck[${at('ev_money_grant')}].body: unknown placeholder {boss} (expected {district} {inspector} {driver} {sorter} {vehicle})`,
    )
  })

  it('the puns lines the deck fills keep their placeholders', () => {
    const p = problems((r) => {
      r.puns.tickerEvent.offered = '{category}'
      // A data key (puns.json eventWords.then), never a thenable.
      // oxlint-disable-next-line unicorn/no-thenable
      r.puns.eventWords.then = '…then: {title}'
      r.puns.eventWords.youChose = 'You chose'
    })
    expect(p).toContainEqual('puns.tickerEvent.offered: must contain {title}')
    expect(p).toContainEqual('puns.eventWords.then: must contain {days}')
    expect(p).toContainEqual('puns.eventWords.youChose: must contain {option}')
  })

  it('bounds keep the identity (×1 / +0); the policy pips name stats', () => {
    const p = problems((r) => {
      r.events.modifiers.bounds.speed = [1.1, 1.5]
      r.events.modifiers.bounds.inspectorP = [0.01, 0.2]
      r.events.policy.weights.pips.luck = 10
    })
    expect(p).toContainEqual(
      'events.modifiers.bounds.speed: [1.1, 1.5] excludes 1 (no modifier must fold to the identity)',
    )
    expect(p).toContainEqual(
      'events.modifiers.bounds.inspectorP: [0.01, 0.2] excludes 0 (no modifier must fold to the identity)',
    )
    expect(p).toContainEqual(
      'events.policy.weights.pips.luck: unknown stat "luck"',
    )
  })
})

// ---- copy: m5x7 metrics ----------------------------------------------------------

const xml = readFileSync(
  new URL('../../src/assets/m5x7.xml', import.meta.url),
  'utf8',
)
const adv = new Map<number, number>()
for (const m of xml.matchAll(/<char id="(\d+)"[^>]*xadvance="(-?\d+)"/g))
  adv.set(Number(m[1]), Number(m[2]))
const width = (s: string): number =>
  [...s].reduce((w, ch) => w + (adv.get(ch.codePointAt(0)!) ?? 6), 0)
const missingGlyphs = (s: string): string[] =>
  [...new Set(s)].filter((ch) => ch !== '\n' && !adv.has(ch.codePointAt(0)!))

/**
 * src/ui/Newspaper.ts wrapHeadline (Phaser-free copy): greedy word wrap into
 * `maxLines` of `maxW` px; out of lines, the last one runs on (the caller
 * checks it fits — no ellipsis here, a cut is an overflow).
 */
function wrap(text: string, maxW: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (!line || width(next) <= maxW) {
      line = next
      continue
    }
    lines.push(line)
    line = w
  }
  if (line) lines.push(line)
  return lines.length > maxLines
    ? [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' ')]
    : lines
}

/** Fits `maxLines` lines of `maxW` px (every line inside, no word cut). */
const fits = (s: string, maxW: number, maxLines: number): boolean =>
  wrap(s, maxW, maxLines).every((l) => width(l) <= maxW)

/** B3 §3.4: the card 300 wide, 12-px padding; the 48-px picture + 8-px gap. */
const CARD_INNER_W = 300 - 2 * 12
const TEXT_W = CARD_INNER_W - 48 - 8
const LABEL_MAX = 28

const spawning = data.districts.filter((d) => d.kind === 'district')
const longest = (xs: readonly string[]): string =>
  xs.reduce((a, b) => ([...b].length > [...a].length ? b : a), '')
const LONG_DISTRICT = longest(spawning.map((d) => d.flavour))
const LONG_DISTRICT_ID = spawning.find((d) => d.flavour === LONG_DISTRICT)!.id
const LONG_PERSON = longest(data.puns.peopleNames)
const LONG_VEHICLE = 'Truck 12'

/** The worst-case fill: the longest district, person and vehicle names. */
function fillLong(text: string): string {
  return text
    .replaceAll('{district}', LONG_DISTRICT)
    .replaceAll('{inspector}', LONG_PERSON)
    .replaceAll('{driver}', LONG_PERSON)
    .replaceAll('{sorter}', LONG_PERSON)
    .replaceAll('{vehicle}', LONG_VEHICLE)
}

/** Every string a card renders from data (title, body, labels, hints). */
function cardTexts(c: EventDef): string[] {
  const out = [c.title]
  if (c.body !== undefined) out.push(c.body)
  for (const o of c.options ?? []) {
    out.push(o.label)
    for (const e of o.effects)
      if (e.kind === 'next' && 'hint' in e) out.push(e.hint)
  }
  return out.map(fillLong)
}

/** The role a card's `one` effects (or its pick) name, for the worst-case pick. */
function pickRole(c: EventDef): CardPickRole | null {
  for (const o of c.options ?? [])
    for (const e of o.effects) {
      if (e.kind === 'pips' && e.scope === 'one') return e.role
      if (e.kind === 'staff' && 'quit' in e && e.pick === 'one') return e.quit
      if (e.kind === 'staff' && 'absent' in e && e.pick === 'one')
        return e.absent === 'vehicles' ? 'vehicle' : e.absent
    }
  return c.pick ?? null
}

/** A deck card opened by hand on `sim` with the worst-case target and pick. */
function openOf(c: EventDef, tick: number): OpenCard {
  const role = pickRole(c)
  return {
    eventId: c.id,
    kind: (c.options?.length ?? 0) === 1 ? 'news' : 'decision',
    category: c.category,
    questId: null,
    target: LONG_DISTRICT_ID,
    pick:
      role === null
        ? null
        : {
            role,
            id: 1,
            name: role === 'vehicle' ? LONG_VEHICLE : LONG_PERSON,
          },
    openedTick: tick,
    parentChoice: null,
    chainHeadId: c.id,
    depth: 1,
    drawn: false,
    gapTicks: null,
  }
}

function optionOf(o: EventOptionDef, index: number): CardOption {
  const cond = o.effects.find(
    (e): e is Extract<EventEffect, { kind: 'next'; hint: string }> =>
      e.kind === 'next' && 'hint' in e,
  )
  return {
    index,
    label: fillLong(o.label),
    effects: o.effects,
    cost: o.cost ?? 0,
    ...(o.costPerVehicle ? { perVehicle: { ...o.costPerVehicle } } : {}),
    default: o.default === true,
    danger: o.danger === true,
    visible: true,
    affordable: true,
    hint: cond ? fillLong(cond.hint) : null,
  }
}

/**
 * A sim where the state-aware lines run longest: 1 life, one bike (the last
 * vehicle), the longest-named district live (the target's name is shown).
 */
function worstSim() {
  const sim = makeSim(1)
  sim.state.economy.balance = 100_000
  sim.dispatch({ kind: 'buyVehicle', type: 'bike', applicantId: null })
  sim.state.economy.lives = 1
  unlockDistrict(sim, LONG_DISTRICT_ID)
  return sim
}

describe('events.json copy (B3 §3.3-§3.4, D-20)', () => {
  it(`labels are ≤ ${LABEL_MAX} glyphs filled with the longest names (${LONG_DISTRICT}, ${LONG_PERSON}, ${LONG_VEHICLE})`, () => {
    const over = deck.flatMap((c) =>
      (c.options ?? [])
        .map((o) => fillLong(o.label))
        .filter((l) => [...l].length > LABEL_MAX)
        .map((l) => `${c.id}: "${l}" (${[...l].length})`),
    )
    expect(over).toEqual([])
  })

  it('every rendered string is drawn in m5x7 glyphs (no ≥, D-20)', () => {
    const strings = [
      ...deck.flatMap((c) => cardTexts(c)),
      ...Object.values(data.events.categories).map((c) => c.word),
      ...Object.values(data.puns.tickerEvent),
      ...Object.values(data.puns.eventWords),
    ]
    const bad = strings.flatMap((s) => {
      const miss = missingGlyphs(s)
      return miss.length ? [`"${s}" lacks ${miss.join(' ')}`] : []
    })
    expect(bad).toEqual([])
    expect(strings.join(' ')).not.toContain('≥')
  })

  it(`copy fit (placeholder for M12's EventCard): the title in 1 line and the body in ≤ 4 lines of ${TEXT_W} px`, () => {
    const over: string[] = []
    for (const c of deck) {
      if (c.router) continue
      const title = fillLong(c.title)
      if (!fits(title, TEXT_W, 1))
        over.push(`${c.id} title "${title}" (${width(title)} px)`)
      const body = fillLong(c.body ?? '')
      if (!fits(body, TEXT_W, 4))
        over.push(`${c.id} body: ${wrap(body, TEXT_W, 99).length} lines`)
    }
    expect(over).toEqual([])
  })

  it(`copy fit: each option's generated effects line in ≤ 2 lines of ${CARD_INNER_W} px (the cost, the effects, the then: line)`, () => {
    const over: string[] = []
    const sim = worstSim()
    for (const c of deck) {
      if (c.router) continue
      const card = openOf(c, sim.state.tick)
      ;(c.options ?? []).forEach((o, i) => {
        const lines = optionLines(sim, card, optionOf(o, i))
        const text = lines.map((l) => l.text).join(' · ')
        const miss = missingGlyphs(text)
        if (miss.length)
          over.push(`${c.id}[${i}] "${text}" lacks ${miss.join(' ')}`)
        if (!fits(text, CARD_INNER_W, 2))
          over.push(`${c.id}[${i}] "${text}" (${width(text)} px)`)
        if (o.label && !fits(fillLong(o.label), CARD_INNER_W, 1))
          over.push(`${c.id}[${i}] label "${o.label}"`)
      })
    }
    expect(over).toEqual([])
  })

  it('copy fit: every job card (Accept / Decline) fits the same rows', () => {
    const over: string[] = []
    for (const t of data.quests.templates) {
      const sim = worstSim()
      const r = sim.dispatch({ kind: 'debugOfferQuest', templateId: t.id })
      const open = sim.state.events.open
      if (!r.ok || open === null) continue
      for (const opt of cardOptions(sim, open)) {
        const text = optionLines(sim, open, opt)
          .map((l) => l.text)
          .join(' · ')
        if (missingGlyphs(text).length || !fits(text, CARD_INNER_W, 2))
          over.push(`${t.id} ${opt.label}: "${text}"`)
      }
    }
    expect(over).toEqual([])
  })
})

describe('events.json policy design rules (B3 §3.8)', () => {
  it('no option scores above policy.evMax on its own (static, life gains left out — critique 20)', () => {
    const w = data.events.policy.weights
    const over: string[] = []
    for (const c of deck)
      for (const o of c.options ?? []) {
        const gains = o.effects.reduce(
          (s, e) => s + (e.kind === 'lives' && e.delta > 0 ? e.delta : 0),
          0,
        )
        const score = staticScore(data, c, o) - w.life * gains
        if (score > data.events.policy.evMax)
          over.push(`${c.id} "${o.label}": ${score}`)
      }
    expect(over).toEqual([])
  })

  it('review deck-3: no harsh option ties a harsh-free sibling state-free (a tie goes to the default, so a paid way out at the harsh price loses the worker every time)', () => {
    const ties = (d: GameData): string[] => {
      const out: string[] = []
      for (const c of d.events.deck) {
        const opts = c.options ?? []
        const sc = opts.map((o) => staticScore(d, c, o))
        opts.forEach((o, i) => {
          if (!o.effects.some((e) => isHarshEffect(e))) return
          opts.forEach((x, j) => {
            if (j === i || x.effects.some((e) => isHarshEffect(e))) return
            if (Math.abs(sc[i]! - sc[j]!) < 0.005)
              out.push(`${c.id} "${o.label}" = "${x.label}" (${sc[i]})`)
          })
        })
      }
      return out
    }
    expect(ties(data)).toEqual([])
    // The M12 poach: a $200 bonus against staffQuit 200 was an exact tie.
    const raw = fresh()
    const poach = cardOf(raw, 'ev_cust_rival_poach')
    poach.options[0].cost = data.events.policy.weights.staffQuit
    poach.cond.balanceAtLeast = data.events.policy.weights.staffQuit
    expect(ties(buildGameData(raw))).toEqual([
      `ev_cust_rival_poach "Let them go" = "Pay a bonus ($180)" (${-data.events.policy.weights.staffQuit + data.events.policy.weights.chain})`,
    ])
  })
})

describe('the full deck (M13: ≥ 100 cards)', () => {
  const full = deck.length >= 100

  it.skipIf(!full)('every modifiers.bounds key is used by some card', () => {
    const used = new Set(
      deck.flatMap((c) =>
        (c.options ?? []).flatMap((o) =>
          o.effects.flatMap((e) =>
            e.kind === 'mod' ? [e.key] : e.kind === 'cap' ? ['shelfCap'] : [],
          ),
        ),
      ),
    )
    expect(
      MODIFIER_KEYS.filter((k) => !used.has(k)),
      'unused modifier keys (B3 §3.6: removed, not kept)',
    ).toEqual([])
  })

  it.skipIf(!full)(
    'the ship list: 100–120 cards, routers and the rescue left out (Q-B3-11, plan-build3 §8.4 task 3)',
    () => {
      const shipped = deck.filter((c) => !c.router && !c.rescue)
      expect(shipped.length).toBeGreaterThanOrEqual(100)
      expect(shipped.length).toBeLessThanOrEqual(120)
      // Every decision category keeps a hand of its own (the 9-categories row needs them all).
      const by = new Map<string, number>()
      for (const c of shipped) by.set(c.category, (by.get(c.category) ?? 0) + 1)
      expect(new Set(by.keys())).toEqual(
        new Set(Object.keys(data.events.categories).filter((k) => k !== 'job')),
      )
      expect(Math.min(...by.values())).toBeGreaterThanOrEqual(5)
    },
  )

  it.skipIf(!full)('≥ 30 cards are eligible at L1', () => {
    const l1 = deck.filter(
      (c) =>
        c.drawable !== false &&
        !c.router &&
        !c.rescue &&
        (c.minLevel ?? 1) <= 1,
    )
    expect(l1.length).toBeGreaterThanOrEqual(30)
  })
})

// M13 deck review rules over the shipped deck (plan-build3 §8.4 tasks 3-4) ---------------

/** A card's direct children: next ids, conditional branch ids, a router's branches. */
function childIds(c: EventDef): string[] {
  const out: string[] = []
  for (const b of c.next?.branches ?? []) out.push(b.id)
  for (const o of c.options ?? [])
    for (const e of o.effects)
      if (e.kind === 'next')
        out.push(
          ...('branches' in e ? e.branches.map((b) => b.id) : [e.eventId]),
        )
  return out
}

/**
 * The life / vehicle losses a player can meet at L1: on an L1 head, the
 * rescue, and every link reachable from one whose minLevel lets it open at
 * L1 (deck.ts drops a link below its minLevel).
 */
function l1Harsh(cards: readonly EventDef[]): string[] {
  const by = new Map(cards.map((c) => [c.id, c]))
  const stack = cards
    .filter(
      (c) =>
        (c.minLevel ?? 1) <= 1 &&
        (c.rescue === true || (c.drawable !== false && !c.router)),
    )
    .map((c) => c.id)
  const seen = new Set<string>()
  const out: string[] = []
  while (stack.length > 0) {
    const id = stack.pop()!
    const c = by.get(id)
    if (!c || seen.has(id) || (c.minLevel ?? 1) > 1) continue
    seen.add(id)
    for (const o of c.options ?? [])
      for (const e of o.effects)
        if (
          (e.kind === 'lives' && e.delta < 0) ||
          (e.kind === 'vehicle' && 'lose' in e)
        )
          out.push(`${id} "${o.label}": ${e.kind}`)
    stack.push(...childIds(c))
  }
  return out
}

/** The draw weight (deck.ts weightOf): `weight`, else weightDefault by kind. */
const drawWeight = (d: GameData, c: EventDef): number =>
  c.weight ??
  d.events.schedule.weightDefault[
    (c.options?.length ?? 0) >= 2 ? 'decision' : 'news'
  ]

/** Per category: a news card at least as heavy as the category's lightest decision card. */
function newsOverDecisions(d: GameData, cards: readonly EventDef[]): string[] {
  const drawn = cards.filter(
    (c) => c.drawable !== false && !c.router && !c.rescue,
  )
  const out: string[] = []
  for (const cat of new Set(drawn.map((c) => c.category))) {
    const inCat = drawn.filter((c) => c.category === cat)
    const decisions = inCat.filter((c) => (c.options?.length ?? 0) >= 2)
    const lightest = Math.min(...decisions.map((c) => drawWeight(d, c)))
    for (const n of inCat.filter((c) => (c.options?.length ?? 0) === 1))
      if (drawWeight(d, n) >= lightest)
        out.push(`${cat}: ${n.id} weight ${drawWeight(d, n)} ≥ ${lightest}`)
  }
  return out
}

/** An effect's shape: its kind with its key / type / role / scope / sign. */
function effectToken(e: EventEffect): string {
  switch (e.kind) {
    case 'mod':
      return `mod:${e.key}`
    case 'vehicle':
      return 'lose' in e ? `vehicle-:${e.lose}` : `vehicle+:${e.gain}`
    case 'staff':
      return 'quit' in e
        ? `quit:${e.quit}`
        : 'star' in e
          ? `star:${e.star.role}`
          : `absent:${e.absent}`
    case 'satisfaction':
      return `sat:${e.scope}`
    case 'pips':
      return `pips:${e.role}`
    case 'parcels':
      return 'spawn' in e ? 'parcels+' : 'parcels-'
    case 'lives':
      return e.delta < 0 ? 'lives-' : 'lives+'
    default:
      return e.kind
  }
}

/** A card's shape: per option its price and its effects' shapes. */
function shapeOf(c: EventDef): string {
  return JSON.stringify(
    (c.options ?? [])
      .map((o) => [
        o.cost !== undefined || o.costPerVehicle !== undefined
          ? 'paid'
          : 'free',
        ...o.effects.map(effectToken).toSorted(),
      ])
      .toSorted((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  )
}

/** Drawable cards of one category sharing a shape. */
function sameShapes(cards: readonly EventDef[]): string[] {
  const groups = new Map<string, string[]>()
  for (const c of cards) {
    if (c.drawable === false || c.router || c.rescue) continue
    const k = `${c.category} ${shapeOf(c)}`
    groups.set(k, [...(groups.get(k) ?? []), c.id])
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ids.join(' = '))
}

describe('M13: the deck review rules on the shipped deck (plan-build3 §8.4 task 3; B3 §3.5, §3.8)', () => {
  it("the policy design rules are the spec's: evBand [−20, 40], evMax 400, nonDefaultShareMin 0.4 (a gate row is never passed by moving its band)", () => {
    expect(data.events.policy.evBand).toEqual([-20, 40])
    expect(data.events.policy.evMax).toBe(400)
    expect(data.events.policy.nonDefaultShareMin).toBe(0.4)
  })

  it('L1 never costs a life or a vehicle: no L1 head, rescue or link that can open at L1 takes one', () => {
    expect(l1Harsh(deck)).toEqual([])
    // The rule bites: a strike on the L1 VIP's furious ending, a lost bike on a
    // link that cannot open before L2 (left alone).
    const raw = fresh()
    cardOf(raw, 'ev_cust_vip_mad').options[0].effects.push({
      kind: 'lives',
      delta: -1,
    })
    cardOf(raw, 'ev_sec_crate_open').options[1].effects.push({
      kind: 'vehicle',
      lose: 'bike',
      fallback: 0,
    })
    expect(l1Harsh(raw.events.deck as EventDef[])).toEqual([
      'ev_cust_vip_mad "OK": lives',
    ])
  })

  it('decision cards are weighted over news: in every category the lightest drawable decision card outweighs every news card', () => {
    expect(newsOverDecisions(data, deck)).toEqual([])
    const raw = fresh()
    const news = (raw.events.deck as Record<string, any>[]).find(
      (c) => c.drawable !== false && !c.rescue && c.options?.length === 1,
    )!
    news.weight = 99
    expect(newsOverDecisions(data, raw.events.deck as EventDef[])).toHaveLength(
      1,
    )
  })

  it('no two drawable cards in one category share a shape (each option: its price and its effect kinds / keys)', () => {
    expect(sameShapes(deck)).toEqual([])
    const raw = fresh()
    const twin = structuredClone(cardOf(raw, 'ev_cust_refund'))
    twin.id = 'ev_cust_refund_twin'
    ;(raw.events.deck as Record<string, any>[]).push(twin)
    expect(sameShapes(raw.events.deck as EventDef[])).toEqual([
      'ev_cust_refund = ev_cust_refund_twin',
    ])
  })
})
