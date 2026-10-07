# Prompt 3.7-fix25 — Item 3.5: Audit paint-only `transition: background/color`

**Parent ticket:** `tickets/ticket-3.7.md` — read it first.

## Objective

Audit the four `transition: background` / `transition: color` rules flagged by the perf review and decide per-rule whether to remove the transition (snap instead) or keep it. The review allows either, but `color`/`background` transitions trigger paint, not GPU composite.

## Context

- `css/styles.css:1381` — `.settings-toggle-row` `transition: background 0.15s ease`
- `css/styles.css:1876` — `.library-subnav-item` `transition: color 0.15s ease`
- `css/styles.css:3430` — (unverified context, around lyrics or NP) — `transition: color 0.15s ease`
- `css/styles.css:3816` — `transition: background 0.15s ease, color 0.15s ease`
- These do NOT violate CLAUDE.md's banned-property list (only `width/height/margin/padding/font-size/border` are explicitly banned). They are allowed but cost paint.

## Task

For each rule:

1. Read the surrounding context to identify what state change triggers the transition (focus, hover, selected, etc.).
2. If the transition is on a focus state and is < 16 ms perceptible difference, remove it (set `transition: none` for that property; the colour/background still snaps to the new value via the class swap).
3. If the transition is critical to the design feel (e.g. settings page row hover), keep it but flag the rule with a CSS comment noting the cost.
4. Document the decision and reasoning per rule in PROGRESS.md.

## Constraints

- Do not change the colour values or focus class structure.
- Do not introduce any new transitions.
- Snap-vs-transition difference must be sub-frame (~16 ms) — verify by toggling the focus state in DevTools.

## Acceptance criteria

- Each of the four flagged rules is either kept-with-comment or removed.
- Visual difference between V3-6-fix5 and post-fix is imperceptible at 60 fps.
- Browser Smoke Test passes.

## Out of scope

- Other CSS rules not in the four-rule list.
- Refactoring focus class names.

## Verification

1. Side-by-side: open V3-6-fix5 in one window and the post-fix in another. Focus the affected elements one at a time. The transitions should be either gone (snap) or visually identical.
2. Browser Smoke Test from ticket-3.7.md.
