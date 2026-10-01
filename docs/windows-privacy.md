# Windows preview privacy notice

This notice covers the Windows `1.3.0-preview.1` reading preview. Slipstream is an MIT-licensed desktop reading application. It has no Slipstream user account, advertising or product-analytics telemetry. The [full data-flow documentation](./PRIVACY.md) also describes macOS and older compatibility features.

## Reading requests and recipients

- The reader chooses a processing mode before using it. Professional reading uses the image-capable API service, model and endpoint configured by the reader. The first-use trial sends a bundled fictional image and text to that service; it does not read the current screen or clipboard.
- After the reader explicitly enables screenshot reading, a desktop snapshot is used locally for region selection. Only the selected region is sent to the configured service. Cancelling region selection sends no reading request. The Windows preview does not run Apple Vision or the local macOS formula OCR helper.
- Pasted or explicitly copied text is sent to the chosen service when reading is requested. Translation, optional term selection checks and user-requested explanations can send the selected text and its local reading context to the same service. Provider usage and retention policies apply, and API calls may incur charges.
- Basic translation sends submitted text to Google Translate and, if that response is unusable, to MyMemory. It is an online mode. See [Google's privacy policy](https://policies.google.com/privacy) and [MyMemory's terms, including privacy](https://mymemory.translated.net/doc/en/tos.php).
- For a reader-selected API provider, consult that provider's policy: [OpenAI](https://openai.com/policies/privacy-policy/), [Anthropic](https://www.anthropic.com/legal/privacy), [DeepSeek](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html), or the operator of the custom endpoint. A locally configured Ollama or compatible endpoint may itself forward or retain data; configuring a local endpoint does not prove that service is offline.

## Local information

API credentials are handled in the main process and stored using Electron `safeStorage` and the operating system's encryption facility. They are not included in prompts, application logs, public issue reports or release artifacts.

Temporary screenshots, translations and explanations remain in the reading session and are not automatically saved as reading history. Closing a card cancels its pending requests. The reader can explicitly save Markdown concept cards or document-specific reference notes in the system Documents folder. Those files contain the selected source and explanations and remain until the reader removes them. System services such as OneDrive may synchronize that folder if the reader has enabled them.

Clipboard monitoring is off by default. It requires an explicit choice that discloses the receiving service; while enabled, copied text may be processed automatically. Text copied out of the app stays on the system clipboard until it is replaced or cleared by the user or another application.

The Windows preview uses a separate settings profile. It does not register a startup task or check the macOS automatic-update channel. Uninstalling the preview preserves user documents and does not promise to remove all local settings. The user can manage app data through settings and remove saved documents separately.

## Contact

The project maintainer is [0boluan0](https://github.com/0boluan0). Follow [SECURITY.md](../SECURITY.md) for security and privacy reports, and omit private content from public reports.
