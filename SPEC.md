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
press F2
→ select a screen region
→ Apple Vision performs local OCR
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
- ordered steps;
- deadlines and required materials;
- faithful full translation;
- ordinary words and professional terminology, each with its source occurrence;
- process context with optional “what it is / why it matters / what to do” sections;
- original evidence anchors;
- pending claims, official retrieval receipts, and any explicit verification records;
- warnings and provenance.

Renderer code never treats arbitrary model prose as trusted action data. Invalid structured output is rejected visibly; only a narrow legacy translation path may fail closed to a translation-only result with a limitation warning.

## Internet and privacy policy

Official-source lookup has three user-selectable policies:

- `local-only`: no verification network request; relevant context remains pending.
- `ask` (default): prepare a minimal query or candidate official URL, but make no request until the user approves.
- `official-auto`: automatically discover or retrieve only eligible public HTTPS official sources.

Verification requests must not contain the full email, screenshot text, names, account numbers, or other unnecessary context. Network code blocks loopback/private destinations, revalidates redirects, limits response type and size, and times out. A successful fetch is shown neutrally as “official page retrieved”; it does not turn the model's explanation into verified fact. V1 can discover GOV.UK pages through GOV.UK's public Search API; unsupported publishers remain pending unless the brief already contains an eligible candidate URL.

OCR is always local. Model analysis is local when Ollama is selected; cloud backends send the user-submitted text to that configured provider. API keys use macOS secure storage. Original case text is not retained by default, and saved terms contain only the term, explanation, and the shortest necessary evidence excerpt.

## Loading and recovery

While processing, show concise live stage feedback so the user is not left waiting. On completion, collapse it into a small duration/details summary. Cancellation, retry, recapture, and editing the recognized text remain available, but follow-up chat is intentionally secondary.

## V1 non-goals

- No general-purpose chat interface.
- No autonomous sending, submission, booking, or form completion.
- No claim that an inference or model memory is an official source.
- No general English writing assistant, Chinese-to-English generation, or multi-language support in the supported V1 contract. A bounded reply draft is allowed only when the captured source requires a reply, and Slipstream never sends it.
- No automatic collection of clipboard contents, analytics, or telemetry.

## Release success criteria

V1 is release-ready when a new user can:

1. Capture or paste a realistic English administrative message.
2. See ordered actions, materials, deadlines, and reply requirements, each traceable to the original wording.
3. Open explanations for unfamiliar terms and distinguish them from source instructions.
4. Understand an unfamiliar process through clearly separated verified or pending context.
5. Choose action-first or translation-first ordering.
6. Understand before submission whether text stays local, goes to a model provider, or is used in a minimal official-source request.
7. Complete the primary flow without hidden waits, silent failure, or fabricated verification.

Public macOS distribution additionally requires reproducible checks, Developer ID signing, Apple notarization, stapling, and Gatekeeper acceptance for both arm64 and x64 artifacts.
