import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(scriptDirectory, '..');
const readProjectFile = (relativePath) => fs.readFileSync(
  path.join(projectRoot, relativePath),
  'utf8',
);

const panel = readProjectFile('src/renderer/components/FloatingPanel.jsx');
const overlay = readProjectFile('src/renderer/components/LoadingOverlay.jsx');

assert.match(panel, /useLayoutEffect/u,
  'processing focus handoff must run before paint');
assert.match(panel, /const processingContextRef = useRef\(null\);/u,
  'processing focus handoff needs a stable target ref');
assert.match(
  panel,
  /useLayoutEffect\(\(\) => \{[\s\S]*?!visible[\s\S]*?status !== STATUS\.PROCESSING[\s\S]*?hasForegroundFocusOwner[\s\S]*?focusAvailableElement\(processingContextRef\.current\);[\s\S]*?\}, \[hasForegroundFocusOwner, status, visible\]\);/u,
  'processing must focus its context only while visible and without a higher-priority focus owner',
);
assert.match(panel, /contextRef=\{processingContextRef\}/u,
  'FloatingPanel must pass the stable processing focus target to the overlay');
assert.match(panel, /const ordinaryErrorFocusHandledRef = useRef\(false\);/u,
  'ordinary processing failure focus must be owned by a one-shot ref');
assert.match(
  panel,
  /useLayoutEffect\(\(\) => \{[\s\S]*?status !== STATUS\.ERROR[\s\S]*?ordinaryErrorFocusHandledRef\.current = false[\s\S]*?captureErrorCode === 'screenshot-permission-denied'[\s\S]*?document\.querySelector\('\[aria-modal="true"\]'\)[\s\S]*?focusAvailableElement\(document\.getElementById\('processing-error-card'\)\)[\s\S]*?\}, \[captureErrorCode, error, hasForegroundFocusOwner, status, visible\]\);/u,
  'ordinary failures must focus their explanation once, without stealing focus from permission recovery or an active modal',
);

assert.match(
  overlay,
  /<h2 ref=\{contextRef\} id="processing-context-title" tabIndex=\{-1\}>/u,
  'the processing heading must be programmatically focusable without entering the Tab order',
);
assert.match(overlay, /const \[announcedStatus, setAnnouncedStatus\] = useState\(''\);/u,
  'the live region must mount empty so its first message is a reliable update');
assert.match(
  overlay,
  /window\.requestAnimationFrame\(\(\) => setAnnouncedStatus\(statusMessage\)\)/u,
  'processing announcements must publish after the empty live region mounts',
);
assert.match(overlay, /<span aria-hidden="true">\{statusMessage\}<\/span>/u,
  'the visible progress copy must not form a second accessible announcement path');
assert.match(
  overlay,
  /<span role="status" aria-live="polite" aria-atomic="true">\s*\{announcedStatus\}\s*<\/span>/u,
  'a single atomic polite live region must own processing announcements',
);
assert.equal(
  (overlay.match(/role="status"/gu) || []).length,
  1,
  'LoadingOverlay must expose exactly one status owner',
);
assert.equal(
  (overlay.match(/aria-live=/gu) || []).length,
  1,
  'LoadingOverlay must expose exactly one live announcement path',
);
assert.doesNotMatch(
  overlay,
  /<section className="processing-card"[^>]*(?:aria-live|role="status")/u,
  'the whole processing card must not duplicate its dedicated live region',
);

for (const expectedCopy of [
  '正在准备原文…',
  '正在等待所选服务返回…',
  '仍在等待；你可以取消并检查模型设置。',
  '正在等待应用确认任务已经停止…',
]) {
  assert.ok(overlay.includes(expectedCopy), `missing processing state copy: ${expectedCopy}`);
}

assert.match(panel, /setStatus\(STATUS\.IDLE\)[\s\S]{0,300}textareaRef\.current\?\.focus/u,
  'acknowledged cancellation must still return focus to the retained source');
assert.match(
  readProjectFile('src/renderer/components/ResultDisplay.jsx'),
  /headlineRef\.current\?\.focus\(\{ preventScroll: true \}\)/u,
  'completion must still transfer focus to the result heading',
);

console.log('Processing focus and single-announcement accessibility checks passed.');
