# Slipstream V1 Product Specification

## Positioning

**看懂英文，办对事情。**

Slipstream is a privacy-first macOS assistant for Chinese-speaking people who need to act on consequential English in study, work, and daily life. A user copies text or captures a screen region; Slipstream returns a Chinese action brief whose important claims point back to the exact source wording.

V1 is English-to-Chinese and macOS-only. The architecture may later support other non-native English speakers who live in, work with, or handle processes in English-speaking countries.

## Product promise

Slipstream must answer four questions in one pass:

1. What does the original text say?
2. What do I need to do, in what order, and by when?
3. Which ordinary words or professional terms are blocking my understanding, and what do they mean here?
4. Which cultural, social, or institutional process is being assumed, why does it exist, and what should I do next?

The first result must be useful enough that a user does not need to repeat the same screenshot in a general chat product.

## Trust model

Every displayed claim belongs to exactly one layer:

- **Original evidence**: an action, material, deadline, condition, or reply requirement explicitly stated in the captured text. It must have one or more evidence anchors pointing to an exact quote and character offsets; OCR results may also point to source bounding boxes.
- **Ordinary-word explanation**: a plain-Chinese explanation of an unfamiliar word or phrase that actually appears in the original, including what it means in this sentence.
- **Professional-term explanation**: a plain-Chinese explanation of a domain term, abbreviation, institution, form, policy, course, or portal that actually appears in the original. It is explanatory, not an instruction from the source.
- **Process context**: the minimum background needed to navigate an unfamiliar professional, cultural, administrative, or social process. It answers what the process is, why this step exists, and what the user does next, while remaining visually separate from original evidence.
- **Official retrieval**: an official page that Slipstream actually retrieved from a public HTTPS source. It includes publisher, URL, retrieval time, and a short excerpt, but retrieval alone does not prove that the page supports a claim.
- **Official verification**: a claim-level conclusion produced only by an explicit support assessor from retrieved official material. V1 does not promote a claim to this state through keyword matching.
- **Inference or pending verification**: potentially useful model output without source confirmation. It must never be styled or worded as verified fact.

If evidence cannot be resolved against the source text, the corresponding action claim is rejected rather than shown as trusted.

## Primary flows

### Screenshot

```text
press Option+Shift+S
→ select a screen region
→ Apple Vision performs local OCR
→ if overall or meaningful-block confidence is missing or below 0.5, stop in an editable review before any processing handoff
→ confirm unchanged text, or edit it into a separately submitted manual draft
→ transient progress shows capture, recognition, structured analysis, and evidence-mapping stages
→ a wide action brief opens
```

### Clipboard

```text
copy English text
→ press Option+C
→ transient progress appears
→ a wide action brief opens
```

The 400 ms handoff is conditional on the captured source remaining unchanged and continuing to own the visible task surface. If the user edits—even if they later undo back to the same characters—automatic submission stops, the edited draft remains visible as manual input, and Slipstream requires an explicit Analyze action or Command+Enter. A stale pre-edit capture must never be submitted later or queued behind the edited draft.

Passive clipboard monitoring is off by default and remains optional.

### Manual input

```text
paste or type English
→ choose Analyze
→ action brief opens
```

## Result experience

The default `action-first` result order is:

1. One-line outcome and deadline/reply indicators.
2. Side-by-side evidence map:
   - full original on the left;
   - ordered action path on the right;
   - matching numbered and colored anchors;
   - hover or click highlights both ends of the mapping.
3. Official-source retrievals and claim status.
4. Full faithful translation.
5. Key terms and process background.

Users may choose `translation-first` in settings. That preference changes section order without weakening evidence requirements.

## Structured output contract

The main process owns and validates a versioned `ActionBriefV1` object. It includes:

- summary and reply requirement;
- ordered steps with validated direct prerequisite references, so a step that creates or prepares something is placed before a step that submits, confirms, or uses it;
- deadlines and required materials;
- faithful full translation;
- ordinary words and professional terminology, each with its source occurrence;
- process context with optional “what it is / why it matters / what to do” sections;
- original evidence anchors;
- pending claims, official retrieval receipts, and any explicit verification records;
- warnings and provenance.

Renderer code never treats arbitrary model prose as trusted action data. Invalid structured output is rejected visibly; only a narrow legacy translation path may fail closed to a translation-only result with a limitation warning.

The built-in full-analysis prompt is versioned independently as `action-brief.prompt.v2`; the candidate contract and validated object remain `ActionBriefV1`, and stored prompt v1 remains accepted for compatibility. Provider readiness uses a fixed fictional message through the production `processText` call, normal parser, and validator, followed by probe-specific assertions for grounded translation, deadline, material, actions, terms, and process context. Passing metadata or returning valid JSON is not sufficient. The probe establishes representative compatibility only and does not guarantee arbitrary-input quality.

Broader model-quality evidence uses a separate synthetic administrative benchmark. Its ten fictional cases cover university, tenancy, medical appointments, HR, government, and billing, including no-action notices, prohibited instructions, conditional work, multiple deadlines, forwarded quotations, and ambiguous dates. The offline release gate validates the corpus, golden `ActionBriefV1` objects, scoring rules, and deliberate failure mutations; it does not claim that any live model passed. A provider-specific live run must send the full corpus through production `processText`, require substantially Chinese translation output, report partial runs as partial, and emit only scores and bounded failure codes—never credentials, source text, or raw model output. A broad provider-quality claim requires a full live run; neither benchmark replaces visible packaged-app acceptance or a guarantee for arbitrary input.

## Internet and privacy policy

Official-source lookup has three user-selectable policies:

- `local-only`: no verification network request; relevant context remains pending.
- `ask` (default): prepare a minimal query or candidate official URL, but make no request until the user approves.
- `official-auto`: automatically discover or retrieve only eligible public HTTPS official sources.

Verification requests must not contain the full email, screenshot text, names, account numbers, or other unnecessary context. Network code blocks loopback/private destinations, revalidates redirects, limits response type and size, and times out. A successful fetch is shown neutrally as “official page retrieved”; it does not turn the model's explanation into verified fact. V1 can discover GOV.UK pages through GOV.UK's public Search API; unsupported publishers remain pending unless the brief already contains an eligible candidate URL.

OCR is always local. Before any processing service receives OCR text, missing or low overall confidence, missing block evidence, or any meaningful block with missing or low confidence requires explicit review. Confirmation is bound to the exact UTF-8 source plus the current provider, processing location, and exact configurable endpoint. Retained confirmation also owns a monotonic processing-config revision, so backend/endpoint round trips and same-provider credential replacement invalidate prior consent even when value-based settings return to the earlier signature. The main process independently reevaluates bounded metadata, consults a sender-scoped hash-only pending screenshot record, and rejects absent or stale confirmation before background handoff or provider work. An authoritative rejection must return to editable review rather than enter generic retry. Editing revokes OCR provenance and automatic dispatch, leaving a manual draft that still needs Generate or Command+Enter. These controls defend ordinary, stale, malformed, and accidentally relabelled application sequences; they do not claim to prove a user gesture against a compromised renderer able to change text and mint public hashes. Model analysis is local when Ollama is selected; Ollama's saved endpoint must validate again as an HTTP loopback target immediately before submission. Unsafe legacy or runtime-injected Ollama endpoints fail closed before DNS or a request and must never be labelled as this Mac in Settings, processing, tray, recovery, or diagnostics. A custom OpenAI-compatible endpoint is described as a service on this Mac only when its accepted URL is HTTP loopback (`localhost`, `127/8`, or `::1`); a public HTTPS endpoint is online, and an invalid or ambiguous endpoint blocks submission instead of receiving a local/online claim. A loopback-compatible service may itself network, forward, retain, or charge according to its own configuration, so the interface must say that separately. Cloud backends send the user-submitted text to that configured provider. Custom and Ollama transports reject every redirect before a second hop, and public custom HTTPS requests pin a safety-checked DNS result for the request. Custom failure bodies are discarded before parsing and must not enter errors or logs; successful custom responses require identity encoding and are bounded to 4 MiB by declared and streamed bytes. API keys use macOS secure storage. Original case text is not retained by default. Saved terms contain only the term, bounded explanation, strict type and provenance enums, and the shortest necessary evidence excerpt. Copy preserves the type/trust boundary; v2 export records the current labels but omits the evidence and local metadata, so `original`, `inference`, and `official` import as unknown and cannot overwrite stronger local trust. Legacy v1 imports also fail closed to unknown provenance.

Startup recovery data also stays local. A confirmed start-fresh recovery archives the complete prior settings file with mode `0600`, does not re-import it automatically, and removes recognized recovery archives during full data reset.

## Loading and recovery

While processing, show concise live stage feedback so the user is not left waiting. The active request owns a bounded `{provider, processingLocation, configGeneration}` snapshot from the moment it actually starts; a queued request, later Settings change, cancellation race, or restored result must not relabel that request. Same-window interruption recovery retains only the allowlisted provider/location pair, tells the user where an interrupted task had sent its source (or that the location is unknown), and excludes endpoint, credential, model-draft, and source-marker fields. On completion, collapse the stages into a small duration/details summary that still exposes the result's historical processing location, including legacy/text-only results whose safe location lives only on the last-good task snapshot. Cancellation, retry, recapture, and editing the recognized text remain available, but follow-up chat is intentionally secondary. A configuration change suppresses an obsolete result immediately but keeps the live task/location and quit risk visible until main confirms settlement; an unconfirmed stop remains retryable.

Persistent settings startup is fail closed. Slipstream validates and migrates a private staged copy before replacing or activating the store. Malformed JSON, schema rejection, migration failure, or unavailable storage leaves the original untouched, blocks normal persistent runtime and first-use/default writes, and offers a safe retry. Only explicit confirmation may archive the old settings locally with mode `0600` and start from fresh settings; there is no automatic import from that archive. Opening that destructive step must move keyboard focus to its labelled confirmation, idle Escape must close only that step and return focus to the exact initiating control, and the step must yield Escape while an app-level top layer is present. Recovery in progress must not be dismissible. If fresh-store creation fails, the original is restored. Full data reset deletes recognized recovery archives.

An edited guided reply is part of recoverable task state. Ten-second clear Undo restores its text, real-world status, progress exception, and selection. Bounded same-window interruption recovery may restore its text, status, and selection, but must clear any progress exception and require confirmation again. A reply from a different result identity must never be attached to the new result.

Every app-provided system-clipboard write is one App-owned transaction. It enters a visible pending state before native IPC, and only one write may settle at a time across results, action lists, guided replies, official-source links, saved-term copy scopes, support diagnostics, and recovery commands. Feature screens request the transaction from the App owner instead of writing independently; operation and notice state never retain the copied plaintext. Production renderer and preload paths expose no clipboard read or clear operation for post-copy cleanup.

A guided-reply transaction is additionally bound to the originating request, task generation, and non-plaintext reply identity: an unchanged draft in the same task becomes `copied`; an edited or status-switched draft becomes `outdated`; and a reply whose task was cleared becomes `retained` so the user is told that the system clipboard may still contain the completed write. Clearing and then undoing the task restores the reply but never starts another clipboard write: an exact restored version may reconcile to `copied`, while an edited restoration remains `outdated`. A late success or failure must not claim that a different draft was copied.

While any clipboard transaction is pending, Slipstream blocks every competing copy as well as application quit and full-data reset. A failed replacement restores a still-live prior consequence, while stale settlement cannot replace current ownership. A quit request snapshots pending operation and consequence state before its presentation frames and rechecks both before automatic confirmation; an expired, failed, malformed, or mismatched write settlement cannot bypass the user's explicit preserve decision. Resolving a clipboard consequence never removes unrelated draft, result, task, or Settings risks. A newer macOS quit request supersedes an older asynchronous renderer decision by identity, so stale responses, finalizers, or presentation frames cannot discard or overwrite the new request. Dismissing the notice hides only its presentation; it does not discard a pending settlement or live consequence. The opaque consequence follows the user across task, Settings, Saved Terms, and first-use surfaces until expiry, exact acknowledgement/manual overwrite, a confirmed later app-owned write, owning-window destruction, or final application exit. Request receipts, consequence IDs, task/version identities, and copied-state claims remain renderer-memory-only and are excluded from same-window interruption recovery; a recovered reply is always restored as not copied and must be checked and copied again.

Every confirmed app-owned write also replaces one main-process, sender-bound clipboard-consequence marker containing only an opaque ID. A renderer interruption keeps that marker without reading, clearing, or overwriting the system clipboard. The recovered renderer receives only the opaque consequence ID—never text, fingerprint, receipt, copy kind, or task identity—and shows that the prior copy may still remain. The marker survives repeated renderer reloads and is removed only by exact “checked or manually overwritten” acknowledgement, a later successful app-owned write, confirmed full reset after the preserve acknowledgement, owning-window destruction, or final application exit. While it is live, renderer and native quit/reset paths offer only truthful preserve-and-continue or preserve-and-exit choices.

Full-data reset uses a separate sender-bound two-phase transaction. Before renderer state changes, the user explicitly chooses to preserve the system clipboard and the main process issues a cryptographically random, one-time ticket with a 30-second expiry for the exact current consequence. A live ticket blocks conflicting app-owned writes and consequence acknowledgement. After the renderer purges session state, commit consumes the exact ticket, revalidates the consequence, and only then deletes persistent app data. Mismatch, tampering, cross-sender use, expiry, replay, renderer loss, or changed consequence fails closed. A persistent-stage failure records that session state is already gone so retry skips that purge and never promises preservation of cleared session data.

## V1 non-goals

- No general-purpose chat interface.
- No autonomous sending, submission, booking, or form completion.
- No claim that an inference or model memory is an official source.
- No general English writing assistant, Chinese-to-English generation, or multi-language support in the supported V1 contract. A bounded reply draft is allowed only when the captured source requires a reply, and Slipstream never sends it.
- No automatic collection of clipboard contents, analytics, or telemetry.

## Release success criteria

V1 is release-ready when a new user can:

1. Capture or paste a realistic English administrative message.
2. See executable actions, materials, deadlines, and reply requirements in a dependency-safe order, each traceable to the original wording.
3. Open explanations for unfamiliar terms and distinguish them from source instructions.
4. Understand an unfamiliar process through clearly separated verified or pending context.
5. Choose action-first or translation-first ordering.
6. Understand before submission whether text stays local, goes to a model provider, or is used in a minimal official-source request.
7. Prepare a bounded reply without copying unresolved placeholders or a completed claim that contradicts mandatory pre-reply progress unless the user explicitly confirms the progress record is stale.
8. Distinguish model processing completion from the user's self-reported task completion, and leave a fully marked task through an explicit reversible action.
9. Complete the primary flow without hidden waits, silent failure, or fabricated verification.
10. Keep normal persistent runtime blocked when startup settings cannot be validated or migrated, then recover through safe retry or an explicitly confirmed local archive-and-fresh path without modifying the original on failure.
11. Enable full analysis only after metadata and the fixed fictional prompt-v2 probe pass the production parser/validator and the additional source-grounding assertions.
12. Change a custom provider's origin without ever persisting or sending the credential that belonged to the previous origin; same-origin path changes may retain it.
13. Keep every destructive capture choice truthful after it is committed, and never replay a failed full-analysis activation after its validated processing configuration changes.
14. Classify custom and Ollama endpoints consistently across Settings, validation, formal transport, task/result provenance, recovery, cancellation, quit, tray, and support diagnostics without retaining an endpoint URL, credential, arbitrary model marker, or source text in those snapshots or logs; fail before DNS/request on unsafe Ollama values and bound custom responses before parsing.

Public macOS distribution additionally requires reproducible checks, Developer ID signing, Apple notarization, stapling, and Gatekeeper acceptance for both arm64 and x64 artifacts.
