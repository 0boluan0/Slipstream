# Slipstream Brainstorm

## Project Name

Slipstream

## Current Intent

Build a global English-assistance system for macOS that helps with daily English-heavy work before the user's English reaches fully native-level fluency.

The system should support tasks such as:

- Communicating with LSE and other institutions.
- Reading English websites.
- Writing English emails.
- Reading English books, papers, slides, and course materials.
- Understanding screenshots or selected regions from arbitrary apps.
- Turning Chinese intent into natural, accurate English output.

## Initial Product Metaphor

Slipstream should combine two familiar interaction patterns:

- Bob-like global language assistance: select text anywhere, trigger a shortcut, and get translation, explanation, rewriting, or email help.
- Snipaste-like screen capture: trigger a shortcut, select a screen region, then run OCR and AI processing on the captured content.

The important point is that Slipstream should work globally across the user's actual workflow, not only inside a browser tab or chat page.

## Proposed First-Principles Goal

In any app, when the user encounters an English reading, writing, or communication task, Slipstream should let them quickly capture the relevant context and receive directly usable help.

The core loop:

1. Capture context from the current task.
2. Identify or choose the task mode.
3. Send structured input to an LLM.
4. Return an output that is immediately useful.
5. Optionally save the result, revise it, or continue the conversation.

## Early Scope

The first version should probably be a small native macOS app rather than a web app.

Reasons:

- The user's pain points happen across Browser, Mail, PDF readers, Obsidian, Word, slides, and websites.
- A global shortcut and floating window are more important than a full-screen chat UI.
- Screenshot plus OCR is a central interaction, so native macOS integration matters.

## Candidate MVP Features

- Menu bar app.
- Global shortcut to open a small command window.
- Text input by paste or manual typing.
- DeepSeek API integration as the first LLM backend.
- Fixed task modes:
  - Reading explanation.
  - Email drafting.
  - English polishing.
  - Website or course-material summary.
- Result window with copy action.

## Candidate Second-Stage Features

- Region screenshot selection.
- OCR using Apple Vision.
- Global selected-text processing.
- History.
- LSE / university communication templates.
- Export selected outputs into Obsidian notes.
- Multi-model backend options.

## Input-First Plan

The project should start from the input side before building the full assistant.

The first milestone is not "answer everything with AI." It is:

1. Let the user capture useful context quickly.
2. Convert that context into clean text.
3. Let the user confirm or edit the captured text.
4. Only then send it to later processing.

### Input Principles

- Capture should be faster than opening a browser-based AI chat page.
- The user should not need to think about prompt writing during capture.
- The app should work across Browser, Mail, PDF readers, Obsidian, Word, and slide decks.
- OCR text should be visible and editable before model processing.
- Input capture should remain useful even before the full AI pipeline is mature.

### Input Sources

#### Manual Text Input

The simplest starting point.

- Open Slipstream command window.
- Paste or type text.
- Choose a task mode later.

This is technically easy and useful for early prompt/output testing.

#### Clipboard Input

Use the current clipboard as the input.

- User copies text from any app.
- Opens Slipstream.
- App pre-fills the copied text.

This avoids hard global-selection integration in the first version.

#### Screenshot Region Input

The most important long-term input.

- User presses a shortcut.
- App enters region selection mode.
- User draws a rectangle around website text, email text, PDF text, course slides, or book content.
- App runs local OCR.
- OCR result appears in an editable text box.

This matches the Snipaste-like interaction the user wants.

#### Selected Text Input

Useful, but can be treated as a later input source.

- User selects text in another app.
- Presses a shortcut.
- Slipstream captures selected text if possible.

This may require Accessibility permissions and app-specific handling, so it should not block the first prototype.

### Input MVP

The first implementation target should probably be:

1. Menu bar app.
2. Global shortcut opens a compact input window.
3. Input window supports manual paste/type.
4. A "use clipboard" action fills the input box.
5. A screenshot-region action captures part of the screen.
6. Local OCR extracts text from the screenshot.
7. OCR result is shown in an editable text box.

At this stage, output can be minimal. The important deliverable is reliable capture.

### Input Pipeline Draft

```text
trigger
-> choose input source
-> capture raw input
-> normalize input
-> show editable input preview
-> confirm
-> pass structured input to the next stage
```

For screenshot input:

```text
global shortcut
-> region selection overlay
-> screenshot image
-> Apple Vision OCR
-> OCR text cleanup
-> editable preview
-> confirm
```

For clipboard input:

```text
global shortcut
-> read clipboard
-> editable preview
-> confirm
```

### Input Data Shape Draft

```json
{
  "sourceType": "manual | clipboard | screenshot | selectedText",
  "rawText": "...",
  "cleanedText": "...",
  "sourceApp": "optional app name",
  "capturedAt": "timestamp",
  "languageHint": "en | zh | mixed | unknown",
  "metadata": {
    "ocrConfidence": "optional",
    "screenshotPath": "optional"
  }
}
```

### Input Questions To Settle

- Should screenshot-region mode have its own shortcut, or live inside the main command window?
- Should OCR automatically run after screenshot selection, or should the user click "Recognize"?
- Should Slipstream save screenshot images, or only keep extracted text?
- Should OCR results be auto-cleaned aggressively, or should raw OCR text be preserved?
- Should the first app support selected-text capture, or postpone it until after clipboard and screenshot work?

## Candidate Modes

### Reading Explanation

Input:

- English paragraph, screenshot OCR text, or selected text.

Output:

- Chinese explanation.
- Key English phrases.
- Important assumptions or hidden requirements.
- Optional short summary.

### Email Assistant

Input:

- Chinese intent.
- Optional recipient/context.
- Optional tone choice.

Output:

- Ready-to-send English email.
- Subject line.
- Optional shorter or more formal version.
- Explanation of sensitive wording when needed.

### English Polishing

Input:

- User-written English.

Output:

- More natural revised version.
- Optional line-by-line explanation of corrections.
- Optional tone variants.

### Website / Admin Page Understanding

Input:

- Screenshot OCR text, copied web text, or page snippet.

Output:

- What the page says.
- What the user needs to do.
- Deadlines, required materials, risks, and next actions.
- Draft email if clarification is needed.

### Course / Book / Slide Understanding

Input:

- Paragraphs, screenshots, lecture slides, or book excerpts.

Output:

- Chinese explanation.
- English terminology.
- Concept map or outline.
- Review questions.
- Optional Obsidian-ready note.

## Open Design Questions

### Input

- Should the first shortcut open a command panel, or should it immediately process selected text?
- Should screenshot mode be a separate shortcut from text mode?
- Should Slipstream auto-detect the task type, or should the user choose a mode manually?
- How much surrounding context should be stored or reused?

### Output

- Should output be compact by default, with expandable details?
- Should every result have one-click copy?
- Should email mode output only the final email first, or include explanation by default?
- Should course-material mode support export to Obsidian from day one?

### Pipeline

- What is the exact input schema sent to the model?
- Should OCR text be cleaned before sending to the model?
- Should every task mode have a fixed prompt template?
- Should the app keep task history locally?
- Should API keys be stored in Keychain?

### Product Boundary

- Is Slipstream primarily an English assistant, or a broader study/work copilot?
- Should it avoid becoming another general chat app?
- Which workflows must be instant, and which can tolerate a larger window?

## Tentative Technical Direction

- macOS native app.
- SwiftUI for UI.
- Menu bar resident app.
- Global shortcuts.
- Floating command/result windows.
- Apple Vision for OCR.
- DeepSeek API as initial LLM backend.
- Local prompt templates.
- Local history, possibly optional.
- Keychain for API key storage.

## Discussion Log

### 2026-05-31

- User described the need for a global English-assistance system because their current English is not yet fully native-level, while many daily tasks require English reading and writing.
- Key tasks mentioned:
  - LSE communication.
  - Reading websites.
  - Writing English emails.
  - Reading English books and course materials.
- User suggested a software system similar to Bob for global assistance and Snipaste for shortcut-based screenshot capture.
- The project name was set to Slipstream.
- User requested no immediate development yet. Current phase is brainstorming and deciding input forms, output forms, and the full pipeline before implementation.

### 2026-06-07

- User said not to build too much at once and suggested starting from the input side.
- Direction updated: first focus on input capture rather than the full AI assistant.
- Input-side priority is manual/clipboard input first, screenshot-region plus local OCR next, and selected-text capture later if needed.
- First milestone should be reliable context capture and editable input preview.
