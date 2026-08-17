# Slipstream

**看懂英文，办对事情。**

Slipstream is a privacy-first macOS action assistant for Chinese users handling consequential English. It turns clipboard text or local screenshot OCR into a structured Chinese brief with source-backed actions, deadlines, materials, term explanations, and clearly separated process context.

For an unambiguous source date, the result header keeps the exact date and adds local urgency such as “今天截止”, “明天截止”, remaining days, or overdue days. When several deadlines exist, it prioritizes the earliest trustworthy date linked to a mandatory user action, shows the total count, and opens every date with its evidence. Date-only sources remain calendar dates; Slipstream does not fabricate an end-of-day time, timezone, or ordering for incomparable relative dates.

## Requirements

- macOS 12 or later
- Node.js 22.12 or later
- Xcode Command Line Tools for the local Apple Vision OCR helper

## Development

```bash
npm ci
npm run dev
```

For deterministic native UI QA without touching the normal Slipstream profile, launch a development-only fixture such as `npm run dev:ui-fixture -- --path='/?demo=setup'`. It creates a fresh temporary `userData` directory, accepts only the exact loopback renderer origin, uses a demo-only preload, and does not start production IPC, tray, global shortcuts, or clipboard monitoring. Invalid or packaged fixture attempts fail closed; never pass live credentials in fixture URLs.

The automated runtime gate launches hidden real Electron 43 Settings scenarios at 520×680 and at 400×400 with 200% Chromium scaling. They exercise shared draft/connection ownership, AppQuit stacking, keyboard and pointer containment, validation stop races, control locking, result focus, eight enlarged-text focus paths, complete focus-ring geometry, and horizontal dialog overflow while rechecking the isolated profile, preload, network, and secret boundaries. Visible current-run before/after evidence accepts the same bounded transition journey at 520×680, the supported 400×400 minimum, and 400×400/200%. This remains unsigned development evidence rather than signed/notarized installed-app or VoiceOver acceptance, and the wider application header/capture shell still needs 200% reflow work.

Three additional native journeys cover a simultaneous menu-bar/clipboard degraded state without collapsing capture, confirmation-gated corrupt-settings archive recovery with focus on the safe success notice, and an unreachable provider that succeeds only after an explicit retry and focuses the new result. Their fixed inputs cannot accept arbitrary JSON or secret-bearing values; every run preserves the normal profile and real clipboard and must make zero external-network requests.

Primary triggers:

- `Option+Shift+S`: select a screen region, run local OCR, and analyze it.
- `Option+C`: analyze the current clipboard text.
- `Command+,`: open the standard macOS `设置…` destination.
- Manual input: paste text and choose Analyze.

The Settings command reuses the mounted Settings surface, so a repeated invocation preserves an unsaved draft, scroll position, and focused editor. During active analysis it opens one modal stop-or-continue decision instead of navigating behind the task. Settings opens only after a requested stop is confirmed; if the task completes first, the result remains available and the user's explicit Settings choice continues safely. Returning restores a semantic task control rather than treating `body` or `html` as a focus origin.

Clipboard monitoring is optional and off by default. Enabling it requires an explicit, destination-specific confirmation: Ollama processes every new non-empty clipboard text on this Mac, while a cloud model or free translation automatically sends each new text to the named service. The main task surface and macOS menu keep the active destination and a direct off action visible, including while another task is running or the window is hidden. A new monitored copy never silently replaces a task, draft, verification, or completed result already on screen. Only the latest waiting copy stays in memory, the window and menu bar mark it as waiting, and the user chooses to process or ignore it; processing remains unavailable until the active task settles. Closing monitoring stops future clipboard triggers, discards any waiting copy without sending it, and does not cancel analysis already underway. If persistence fails, the last confirmed state stays visible with one targeted retry instead of implying the change succeeded.

Every app-owned copy has one short-lived opaque consequence identity. Post-copy cleanup and consequence handling never read, clear, or overwrite the system clipboard automatically. The notice follows the user across task, Settings, and Saved Terms surfaces without retaining copied plaintext; a later confirmed app-owned write replaces the prior consequence. If the renderer is interrupted, the reloaded interface receives only that opaque identity—never copied text, a fingerprint, receipt, or task identity—and warns that the earlier content may still remain. Until the user confirms they checked or manually overwrote it, quit and full reset offer only truthful preserve choices. Opt-in clipboard monitoring remains a separate, explicitly consented feature that reads new clipboard text for the selected processing destination.

Global capture shortcuts follow the same rule during active work and while Settings is open. Option+C keeps the current source and task visible while newly captured text waits for an explicit choice. On an empty task surface, its short delayed start remains valid only while the captured source is unchanged; editing cancels automatic submission, keeps the latest draft, and requires Generate or Command+Enter, so the pre-edit capture cannot run later. When an unsaved source correction, draft, or ten-second clear undo owns the screen, the waiting action names exactly what processing will abandon and the safe action returns focus to the correction field, draft, or undo control. Recovery, the saved-term library, settings confirmation, and app quit confirmation remain in front; captured text cannot be processed behind them. The screenshot shortcut does not abort analysis, official verification, or provider validation: it offers a stop-or-continue decision where work is active and opens frame selection only after the application confirms that work stopped or finished. It follows the same foreground ownership boundary. When the foreground state ends, focus moves to an explicit start-or-keep choice, and an expired undo choice is removed rather than left stale. In Settings, unsaved connection fields must be kept or explicitly discarded, provider validation must be stopped first, and choosing to continue editing leaves the capture visibly pending instead of running it behind the screen. Empty clipboard shortcuts report the problem in Settings without changing work.

After local screenshot OCR, missing or low overall confidence—and any meaningful block with missing or low confidence—stops before processing. Slipstream focuses an editable review that states the current destination and that the source has not yet been sent. Confirming unchanged text creates a SHA-256 receipt bound to the exact source and current provider, processing location, and exact configurable endpoint. A monotonic config revision means changing away and back—or replacing a same-provider credential—still requires a new confirmation. Editing instead converts the text to a manual draft that still requires a separate Generate or Command+Enter action. The main process independently recomputes the bounded OCR assessment, rejects absent or stale confirmation before any analysis handoff or provider call, and returns an authoritative rejection to the editable review instead of a retry loop.

Saved shortcut text is not treated as proof that macOS accepted the registration. If Option+C or the screenshot shortcut is unavailable at startup, the main task surface names the affected shortcut and links directly to its focused setting. Existing F1–F24 choices are preserved but carry an Fn/Globe warning on Apple keyboards and a one-click route to the recommended Option+Shift+S combination. In Settings, choose “Change” and press the new combination directly—there is no accelerator format to type. The recorder uses macOS-facing key names, explains incomplete or unsafe input, prevents duplicate capture shortcuts, and supports Escape or Tab to leave without changing anything. Settings shows the actual enabled, caution, unavailable, or checking state for each shortcut; an invalid or conflicting replacement keeps the previous working shortcut registered, and interface capture buttons remain available throughout recovery.

## Model configuration

The full action brief requires Ollama or a configured Anthropic, OpenAI, DeepSeek, or compatible endpoint, with an API key where that service requires one. A compatible endpoint is called a service on this Mac only when it validates as HTTP loopback (`localhost`, `127/8`, or `::1`); the service itself may still network, retain, forward, or charge. Public HTTPS is labelled online, and invalid or ambiguous destinations cannot start analysis. Ollama is also restricted to HTTP loopback; unsafe legacy or injected values fail closed and are not labelled local. Formal custom/Ollama requests revalidate immediately before submission and reject every redirect before a second hop. Custom error bodies are discarded, and successful compatible responses require identity encoding and remain within a 4 MiB declared/streamed limit. API keys use macOS secure storage.

Saved API keys are never returned to the Settings renderer for display. A saved field names that boundary directly and does not offer a misleading reveal action. The eye control appears only for a new replacement value, is labeled as revealing the new input, and disappears after that draft is cleared or saved.

Before full analysis can be enabled, Slipstream first checks model metadata and then asks the selected model to process a fixed, fictional compatibility message with built-in `action-brief.prompt.v3`. The response travels through the production model call, parser, and `ActionBriefV1` validator, then must pass additional probe-specific checks for grounded translation, deadline, material, actions, terms, and process context; merely valid JSON is insufficient. The candidate contract and schema remain v1-compatible. This test never uses screenshots, clipboard content, task text, saved terms, or the optional custom analysis preference; cloud providers may record or charge for the request. It is a representative compatibility probe, not a guarantee for arbitrary future inputs. Long tests show progress and can be cancelled without changing the saved configuration.

Leaving or switching Settings now resolves competing work in one fixed order: unsaved API Key, endpoint, or model input first, an active provider test second, and the requested action only after both settle. The shared decision dialog blocks background pointer and assistive activation, contains Tab, Shift+Tab, Escape, and programmatic focus, and yields when AppQuit is above it. It locks same-frame repeats, keeps focus useful through busy, error, and completed states, and restores the exact initiating control after the settled two-frame render. Short content scrolls, and actions become a single column at 620px or below.

Explicit discard resets the visible API Key, endpoint, and model drafts to their saved values before the requested transition continues. If that transition then fails to persist, the saved provider remains selected, its validation action stays coherent, and the recovery card retries the same pending choice. Connection fields and full-data reset stay unavailable while validation or its cancellation is still owned. A renderer run token prevents an older result overwriting a newer test. If stopping reports an error but the provider later finishes, the dialog changes from that stale warning to the completed outcome; `查看验证结果` then focuses the retained connection result. Transition titles, body copy, notices, and actions use readable compact sizes with 44px action targets; warning/error/success focus rings are opaque, errors are described by the dialog, Reduced Motion stops the spinner, and status-focused Tab/Shift+Tab enters the first/last action. At 200%, dialog-internal focus also scrolls its target and complete ring into view with reserved edge spacing; this guarantee does not yet extend to the full application shell.

The unfinished setup experience is intentionally focused: diagnostics are read only after the user expands the support entry, secondary preferences remain collapsed, and destructive reset controls are not presented as part of the first-use task. The regular settings screen restores the full support and reset tools after configuration, but keeps the already-selected basic-translation explanation collapsed. It exposes one main heading, and each custom radio group uses one Tab stop with Arrow, Home, and End keys moving focus and selection together.

The full reset is a fail-closed, sender-bound two-phase renderer/main transaction rather than a settings-only shortcut. Before any renderer purge, the user explicitly chooses to preserve the system clipboard and the main process issues a short-lived one-time ticket bound to the exact opaque clipboard consequence. The renderer then clears the current source, result, action progress, clear-undo snapshot, pending capture text or intent, and same-window interruption record; commit revalidates the same ticket before the main process clears saved terms, credentials, settings, and recognized startup-recovery archives. Only confirmed completion returns to first use. Mismatch, expiry, replay, renderer loss, or a changed consequence stops the transaction. If the persistent step fails, the interface truthfully says the current session is already gone and retries only the remaining deletion stage.

Rejected online credentials enter a guarded recovery state: the same failed key cannot be tested repeatedly, the recovery action focuses the relevant API-key field, and the test is unlocked only after a replacement credential has been saved successfully.

If a real analysis later fails, the recovery action follows the reason instead of dropping the user at the top of Settings. Credential, model, connection, and transient service failures preserve the source and last valid result, focus the relevant field or full-analysis test, keep the retained-task notice visible while scrolling, and return to the same task for a deliberate retry.

The free translation backend uses third-party online translation endpoints and returns a clearly labeled translation-only result; it contains no inferred actions, materials, dates, reply guidance, evidence mapping, or official verification. Before submission and while processing, Slipstream states that the complete source goes to Google Translate first and, only if Google does not return a usable translation, is sent again to fallback MyMemory. Choosing `配置完整分析` keeps that source and result mounted while the user configures a provider. An incomplete upgrade returns to the preserved translation, blocks processing until validation, and exposes one `继续配置完整分析` action; once enabled, the same source can be rerun with full analysis.

If Google Translate and fallback MyMemory both fail, Slipstream keeps the source and previous valid result on the task surface. Retry remains the primary action. The secondary recovery opens the local-versus-online analysis choice with the retained task clearly named; it does not imply that the account-free translation endpoints have an API key or validation setting the user can repair.

Switching a configured online provider back to basic translation does not silently hide or erase its saved credential. Settings names the credential and requires the user to keep it or request deletion. Keeping does not send it to Google or MyMemory; deletion has a second irreversible-action confirmation, clears the provider connection locally, and keeps the current source and last result. If the settings transaction is interrupted, the app stays paused and exposes a targeted retry instead of claiming the mode switch finished.

## Verification

Official-source verification defaults to Ask first. Local-only performs no lookup. Official-auto discovers or retrieves only eligible HTTPS official sources using a minimized request. A successful fetch is shown as a neutral retrieval receipt; it does not make a model explanation “verified.”

Pending claims link directly to their available verification plan instead of leaving the user to find a separate section. Ask-first mode exposes the exact candidate page or minimized GOV.UK query before approval. While a lookup is running, the current source and result remain usable and the user can cancel. Slipstream claims success only after the underlying task settles; if stopping cannot be confirmed within the bounded wait, it says the lookup continues and restores the cancel action for another attempt. A confirmed cancellation restores the same plan for a safe retry and never promotes the pending claim.

Retrieved pages also keep their next actions truthful. “Open” stays pending until the main process confirms that the URL was handed to the default browser; a failure keeps the result unchanged and exposes a direct retry or copy-link fallback. “Copy link” reports whether the system clipboard changed, keeps a preserve/manual-overwrite consequence notice, and never presents a retrieved page as a verified conclusion.

## Saved term backups

The global term library can export and import a local JSON backup. Export requires an explicit privacy preview and includes only each term, explanation, strict classification, and the trust label at export time—never retained source evidence, local IDs, timestamps, settings, or API keys. Import validates files up to 1 MB and previews new, updated, unchanged, filtered, trust-downgraded, and capacity-skipped items before anything changes. Because evidence is absent, v2 `original`, `inference`, and `official` labels import as `unknown`; a lower-trust backup cannot overwrite a stronger local record. Legacy v1 records import as `other / unknown`; matching terms keep their local identity and evidence, and a full library never evicts existing terms to make room.

## Application status and support

Settings includes a read-only application status area for troubleshooting. It shows the app/build version, macOS and architecture, active analysis mode, Screen Recording permission, local clipboard monitoring state, and saved-term count. The diagnostic summary is previewed before the user chooses to copy it, is never sent automatically, and excludes API keys, service addresses, submitted source text, saved-term content, retained evidence, clipboard content, and arbitrary model-marker text.

## Startup protection

Slipstream does not treat a settings read failure as a fresh installation. It first copies the existing file to a private staged sibling, validates and migrates that copy, and activates normal persistent runtime only after success. Malformed JSON, schema rejection, migration failure, unavailable storage, or a startup timeout keeps the app in a blocked protection state instead of entering first-run setup or persisting defaults; the original remains untouched. The user can retry safely. Alternatively, after explicit confirmation, Slipstream archives the complete old settings file locally with mode `0600` and starts with fresh settings. Keyboard focus enters that destructive confirmation, idle Escape returns to its exact trigger, and a visible app-level quit decision keeps sole Escape ownership. Recovery in progress cannot be dismissed. Slipstream never re-imports the archive automatically, restores the original if fresh creation fails, and removes recognized archives during full data reset.

If saving an API key, endpoint, or model editor fails and the user explicitly discards that draft, Slipstream also revokes the matching failed write from the generic settings retry queue, including any paired pause of full-analysis mode. A later retry can still apply unrelated failed settings, but it cannot resurrect the abandoned secret or destination. When a custom endpoint origin change correctly revokes the old origin's saved key, any replacement key still visible in the editor remains an unsaved protected draft; the authoritative credential removal cannot silently release its leave, provider-switch, or shortcut-capture guard.

## Accidental-clear recovery

Clearing a draft or leaving a completed result keeps the previous in-memory session available for ten seconds. An active result says “Clear and return”; a result whose actions are all marked complete says “Complete and return.” Both use the same recovery notice with the real remaining time. The user can restore the full source, result, and completion marks without creating a history record or writing the cleared content to disk. A new input, paste, screenshot, or example dismisses the old recovery snapshot; official-verification approval is never restored after a clear.

If a new source fails while an older valid result exists, the older result remains visible and the failed source stays in a separate renderer-memory slot. The warning names that boundary and offers both direct retry of the failed source and a review-and-correct path; an untouched retry preserves its source, truncation, and OCR metadata instead of resubmitting the visible older source. If the user edits that failed source, returns to the older result, and retries later, Slipstream names and submits the corrected text as manual input without stale OCR metadata; an empty correction reopens review instead of silently falling back to the original. Review opens that same memory-only source in the correction flow, and returning to the older result can reopen the correction or retry the latest retained attempt. Interruption recovery stores only the older valid result—never the failed source, its correction, or a stale “still available” notice. Success, task clear, full data reset, or renderer interruption removes the special slot.

## Action progress

Each source-backed action can be marked or unmarked as a personal completion record. The result reports `x / y` as “you marked,” explicitly says Slipstream has not verified the real-world outcome, and keeps the original evidence readable after completion. Completed actions condense to a source-count control so the next unfinished action stays visible; each evidence set can be expanded independently, and unmarking restores it immediately. When every action is marked, the progress card becomes an explicit self-reported completion state, any required reply indicator changes to “marked complete,” repeat reply preparation becomes secondary, and `Complete and return` becomes the primary task exit. The separate model status says `Processing complete`, so it cannot be mistaken for real-world task completion. The record stays in renderer memory across Settings navigation, joins the ten-second clear-undo snapshot, and is sanitized into the same 30-minute same-window interruption snapshot as the result. A genuinely new analysis resets it. Copied action checklists label every generated action as pending or completed. Guided replies still require a separate confirmation of the user's real status, and a completed claim is checked against only mandatory user actions before the reply. If that record disagrees, the user must choose the in-progress draft or confirm that the checklist is stale; the reply action is excluded and Slipstream never marks actions complete automatically.

Action order is now part of the structured contract rather than a visual assumption. A step may name direct prerequisite steps, and the main process validates those references before applying a stable dependency order. The result and copied checklist say which earlier numbered steps a submission or confirmation depends on. If a user later unmarks a prerequisite while leaving its dependent step complete, Slipstream keeps the reversible self-report but highlights the inconsistency for review. Missing, self-referential, duplicate, or cyclic dependency data fails safely instead of manufacturing a confident sequence.

## Unexpected-interruption recovery

If the renderer reloads or crashes while the same Slipstream window remains open, the app can offer to restore the latest draft, correction draft, or completed result from temporary current-window session storage. The snapshot expires after 30 minutes of inactivity and is removed when the user restores, discards, or explicitly clears it, or when the window session ends. It is not app history, does not sync, and does not survive an app restart. Settings drafts, API keys, service addresses, custom prompts, and official-verification approval IDs are excluded. Interrupted analysis and verification never restart automatically; restoring a result that previously had lookup approval requires a fresh analysis and approval before another official lookup.

## Background task feedback

Analysis and official-source verification continue when the user hides the window. The macOS menu bar shows an in-progress mark and keeps a success or failure mark until the app is reopened. When system notifications are available, a hidden task also produces a generic completion reminder that never includes submitted source text or analysis content. Cancelling a task clears its menu-bar progress without sending a completion notification.

## Official-source actions

Retrieved official pages keep open and copy as explicit, keyboard-visible actions rather than metadata-sized links. Their target area remains at least 32px high, action groups wrap on narrow source cards, and pending, success, or retry labels never promote a browser handoff into semantic verification.

## Processing-screen privacy

After submission, the waiting surface does not repeat the source text. It shows the source type and exact retained character count, keeps the local, loopback-compatible, or online destination visible, and explains that the content is hidden to reduce shoulder-surfing exposure. The expanded completion details retain the location that actually produced that result even after Settings changes. Cancelling a first analysis returns the complete source to the focused editor; cancelling a reanalysis returns to the previous valid result. A stop failure keeps the task's original location and quit risk visible until the main process confirms settlement.

## Clipboard privacy recovery

Copying a complete result, action checklist, prepared reply, official-source link, saved-term scope, support summary, or recovery command shows that the content is in the system clipboard and may remain there. Every app-provided copy shares one App-owned pending operation and preserve-only notice: a second write cannot overtake an unsettled operation, the notice follows the user between the task, Settings, and Saved Terms library, and a failed replacement restores any still-live prior consequence. Notice state never contains the copied plaintext. When a source also requires a reply, the guided reply and action-checklist copy remain available together instead of replacing one another. Generated reply placeholders are counted and block copying until replaced with real content. A completed reply claim also remains blocked when mandatory pre-reply actions are unchecked, unless the user explicitly confirms that the checklist has not caught up with reality. The sticky copy footer names every remaining blocker. If the user edits or switches the status of a copied reply, Slipstream identifies the clipboard as the previous version instead of implying it updated automatically. Undo never writes again. Post-copy cleanup never reads or clears the clipboard; the user may inspect or manually overwrite it, and an exact acknowledgement resolves the opaque consequence without verifying erasure. The same consequence survives task exit. Quitting while it is live opens a keyboard-safe decision with continue or explicit preserve-and-exit; an expired or unconfirmed settlement never falls through to automatic exit.

## Contrast preferences

Slipstream keeps ordinary light and dark themes separate from system-enhanced contrast. Filled accent, warning, and error controls use dedicated surfaces with at least 4.5:1 text contrast; success, focus, and modal scrim states have explicit tokens. `prefers-contrast: more` strengthens text, borders, focus, dialogs, and disabled states while removing blur, gradients, transparency-dependent surfaces, and shadow-only hierarchy. `forced-colors: active` uses operating-system Canvas, Highlight, LinkText, and GrayText semantics for surfaces, selection, evidence, focus, and disabled controls rather than preserving brand colors. Automated native evidence covers Result, Settings, and reset; manual macOS and Windows system-setting acceptance across every product surface remains release work.

## Screen-reader language boundaries

The application shell is Chinese (`zh-CN`), while capture text, source evidence, official excerpts, deadlines, guided-reply grounding/drafts, and Saved Terms expose content-level `en`, `zh-CN`, `mul`, or `und` boundaries. Controls keep Chinese actions and source-language content as separate DOM segments instead of flattening both into one accessible string. Completing first use hands focus directly to the source textarea; submitting capture hands focus to the processing heading unless a higher-priority decision owns it. Processing uses one polite atomic live region that mounts empty, announces only bounded state changes, and leaves elapsed seconds visual-only. A completed Result exposes its conclusion, evidence workspace, and footer actions through one heading-labelled `main`, without a nested landmark or duplicate summary region. `check:screen-reader-semantics` verifies these contracts in source and in a hidden isolated Electron Chromium Accessibility Tree journey, including the processing handoff. Its default no-write runtime and reviewed evidence-output mode both pass; the manually inspected current-run captures are in `docs/ux-evidence/2026-07-30-result-processing-accessibility/`. A clean temporary final-tree copy with preserved workspace-root structure and fresh `npm ci` passes complete `npm test`, full lint, and `npm run build:renderer`. The current production entry is 487,185 raw bytes / 143.86 kB gzip, 2,815 bytes below the enforced 490,000-byte working budget and 12,815 bytes below the 500,000-byte release ceiling. Result-private CSS is now a finite stable on-demand asset, while the shared live-region rule stays eager for Result and Saved Terms. Real VoiceOver pronunciation, speech order, interruption, Rotor, and announcement-queue acceptance remains a manual release task and requires explicit approval before changing the global macOS VoiceOver setting.

This accessibility pass did not use, enter, persist, log, or add the supplied API credential to fixture state or evidence. Any future live provider-quality run requires a newly rotated credential supplied only to that process.

## Checks

```bash
npm run check:runtime-dependencies
npm test
npm run check:electron-ui-fixture
npm run check:electron-ui-fixture-runtime
npm run check:settings-transition-dialog
npm run check:settings-accessibility
npm run check:screen-reader-semantics
npm run check:reduced-motion
npm run check:contrast-preferences
npm run check:term-transfer
npm run check:support-diagnostics
npm run check:settings-load-recovery
npm run check:storage-startup
npm run check:credential-visibility
npm run check:full-data-reset
npm run check:clear-undo
npm run check:session-recovery
npm run check:action-progress
npm run check:background-task-status
npm run check:clipboard-monitor-consent
npm run check:clipboard-monitor-visibility
npm run check:clipboard-monitor-collisions
npm run check:active-capture-collisions
npm run check:settings-capture-guard
npm run check:shortcut-readiness
npm run check:clipboard-privacy
npm run check:clipboard-residue-risk
npm run check:clipboard-exit-privacy
npm run check:clipboard-quit-safety
npm run check:provider-connection
npm run check:prompts
npm run check:model-quality-benchmark
npm run check:startup-benchmark-mode
npm run lint
npm run build:renderer
npm run check:package-config
npm run check:dev-dependency-security
```

`npm run check:deepseek-live` is an optional network compatibility gate and is not part of `npm test`. With a process-only credential, it sends the fixed fictional probe through the production main-process analysis/parser/validator chain plus extra probe assertions. It does not exercise renderer UI, IPC, `safeStorage`, or the packaged application.

`npm run check:model-quality-benchmark` is an offline default gate for ten wholly fictional university, tenancy, medical, HR, government, and billing cases. It validates schema-safe golden briefs and proves the scorer rejects omitted, invented, inverted, misdated, conditional, prohibited, reply-channel, and ungrounded outputs. It does not call a model. The optional `npm run check:deepseek-quality-live` command runs the full corpus through production `processText` by default and requires substantially Chinese translation output; explicit subsets are labeled partial. Reports contain only metadata, scores, and bounded failure codes—never the source, raw response, or credential.

`npm run check:dev-dependency-security` verifies range-compatible patched `brace-expansion` versions across legacy and modern `minimatch` consumers, exact lock integrity, strict `npm ls` validity, ordinary matching behavior, bounded expansion, `fast-uri@3.1.5`, and root development `undici@7.29.0`. Both the full audit and the separate packaged-production audit must report 0 vulnerabilities.

The former packaged launch timer and its seven-sample Apple-silicon numbers are withdrawn. A security review found that its hidden measurement path shared production lifecycle capabilities and did not prove compositor-visible readiness. No startup or Settings latency claim is release evidence until a replacement can run only in a separately identified private build, deny production capabilities, and pass representative signed-app acceptance.

To inspect the current macOS Screen Recording permission without requesting or changing access, run `npm run diagnose:screen-permission`.

## Release

`npm run release:unsigned` produces ad-hoc artifacts for local smoke testing only. Those builds identify themselves in Settings and the macOS About panel as `本地测试包 · 临时签名 · 未公证`. Public distribution requires a Developer ID Application identity and Apple notarization credentials, then `npm run release:signed`. The signed gate verifies both arm64 and x64 ZIP/DMG artifacts, packaged identity/signature agreement, hardened runtime, stapling, and Gatekeeper acceptance; a Developer ID label alone never claims those distribution checks passed.

Slipstream collects no telemetry. See the repository's `docs/PRIVACY.md`, `SECURITY.md`, and MIT `LICENSE` for details.
