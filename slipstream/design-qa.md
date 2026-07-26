# Design QA — evidence-first action brief

Date: 2026-07-23

## Comparison input

- Selected reference: `design/reference/action-evidence-result.png` — 1424 × 1104
- Release-candidate capture: `.audit/positioning-redesign-2026-07-23/12-release-candidate-1424x1104.jpg` — 1424 × 1104
- Side-by-side comparison: `.audit/positioning-redesign-2026-07-23/13-reference-vs-release-candidate.png`
- Evidence-fix capture: `.audit/positioning-redesign-2026-07-23/14-release-candidate-evidence-fix-1424x1104.png` — 1424 × 1104
- Final evidence-fix comparison: `.audit/positioning-redesign-2026-07-23/15-reference-vs-evidence-fix.png`
- State: demo result, action-first, all detail sections collapsed

The reference and implementation were inspected together at the same viewport. The implementation preserves the reference's defining trust mechanic: full source on the left, ordered actions on the right, and matching numbered/color-coded evidence at both ends. It intentionally adds a compact product header, provenance badges, separate detail disclosures, and a persistent completion/action footer without weakening the source-to-result relationship.

## QA passes

1. Desktop layout — passed at 1424 × 1104, 1180 × 820, and 760 × 900. No cropped primary controls, horizontal overflow, or broken heading layout.
2. Mobile layout — passed at 390 × 844. Source and action panes are both reachable; selecting a term stays in the explanation pane, while its evidence card deliberately returns to the source pane.
3. Evidence mapping — passed. Clicking source evidence opens or focuses the corresponding action, term, or explanation; clicking a result evidence card returns to the exact source quote.
4. Understanding layers — passed. Ordinary words and professional terms have distinct labels. Process context renders “这是什么 / 为什么要做 / 你该怎么做” and retains the original trigger evidence.
5. Verification states — passed. Pending, retrieved, failed, and explicitly verified states are visually distinct. A retrieved official page is presented neutrally and never receives verified styling by default.
6. Result ordering — passed. Action-first is the default; translation-first expands and moves the translation/detail stack before the action path.
7. Interaction and recovery — passed. Reply draft, copy actions, recapture, reanalysis, cancellation, responsive pane switching, disclosures, settings access, and completion details are reachable.
8. Accessibility and runtime — passed. Buttons expose names and pressed/expanded states, evidence marks are keyboard operable, the reply dialog traps focus and closes with Escape, and the final preview produced no browser warnings or errors.

## Fixes made during QA

- Added responsive source/action pane controls so mobile users can reach both halves of the evidence map.
- Kept term selection in the action pane on mobile; source navigation now occurs only through the explicit evidence card.
- Stopped truncating action groups and separated material requirements from the first action.
- Derived privacy copy from result provenance instead of the current settings selection.
- Replaced ambiguous “verified” wording with neutral retrieval receipts unless an explicit semantic assessor confirms support.
- Added visible GOV.UK query approval when discovery has a safe minimal query but no candidate URL.
- Preserved owner-specific exact quotes when one source highlight supports multiple results, while keeping a single uncluttered source anchor.
- Added deadline and verification evidence to the same bidirectional source map; deadline headlines now require an explicit action relationship.
- Rechecked the evidence fixes against the reference in one 2848 × 1104 side-by-side image; source anchors, action cards, disclosures, and footer remain visually clear without clipping.

final result: passed

## 2026-07-24 usability follow-up

- Real Electron action-first capture: `.audit/usability-2026-07-23/31-final-action-first-readable.jpeg` (1180 × 820 CSS window; 1106 × 768 captured pixels).
- Updated comparison input: `.audit/usability-2026-07-23/32-reference-vs-real-window-readable.png` (selected reference and real-window capture shown together at equal rendered height).
- Core action, evidence, translation, terminology, process, warning, and verification text was raised out of the previous 8–10 px range. The reference's numbered/color-coded source-to-action relationship remains dominant and readable.
- Translation-first now means full translation → action path → secondary details. Action-first means action path → full translation → secondary details.
- Persistent evidence focus now keeps unrelated text readable instead of reducing it to 42% opacity.
- Small-screen order controls retain text labels, and the result pane opens on the selected action/translation content while exact evidence links still switch to the source pane.
- The provider setup was separately verified in the real Electron app as a four-step flow with explicit save state, metadata test gating, and disabled full-analysis activation before a current successful test.

follow-up result: passed for the fixture-backed interface and setup interactions; live provider ActionBrief generation remains a separate release evidence gap.
