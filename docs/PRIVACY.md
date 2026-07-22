# Privacy and data flow

Slipstream has no accounts, advertising, analytics, or telemetry.

## Data that stays on the Mac

- Screenshots and Apple Vision OCR processing.
- App settings and bounded saved-term records.
- API keys, encrypted through macOS `safeStorage`.
- Text processed by Ollama when a local model is selected.

Temporary screenshot files are deleted after OCR. Full source text is not saved to history by the supported V1 flow.

## Data that can leave the Mac

- A cloud model receives the text the user explicitly submits when that provider is selected.
- The free translation backend sends submitted text to Google Translate and may fall back to MyMemory. It is therefore not a local mode.
- Official verification sends only a bounded query and/or candidate official URL. The verification API rejects fields that resemble full email or source text.

Default official verification policy is **Ask first**. `Local only` performs no verification request. `Official auto` retrieves eligible candidate sources automatically.

Slipstream cannot control a third-party provider's retention policy. Review the chosen provider's policy before submitting sensitive school, immigration, employment, financial, legal, or medical content.

## Local deletion

Settings provide controls to remove saved terms, retained history, credentials, or all local user data. Deleting the app alone may not delete its Electron settings directory.

## Reporting a privacy problem

Please follow [SECURITY.md](../SECURITY.md) and avoid placing personal source text, screenshots, or credentials in a public issue.
