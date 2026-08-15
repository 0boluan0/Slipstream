import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { IPC_CHANNELS } = require('../src/shared/constants.cjs');
const {
  createCaptureIngressRegistry,
} = require('../src/main/capture-ingress-registry');

function captureEvent(channel, payload) {
  return { channel, payload };
}

function recordDeliveries(target) {
  return (senderId, event) => {
    target.push({ senderId, event });
    return true;
  };
}

const registry = createCaptureIngressRegistry();
const delivered = [];
const deliver = recordDeliveries(delivered);
const firstSenderId = 41;

registry.begin(firstSenderId);
registry.dispatch(firstSenderId, captureEvent(
  IPC_CHANNELS.SCREENSHOT_REQUESTED,
  { source: 'shortcut' },
), deliver);
assert.deepEqual(delivered, [],
  'a capture shortcut before listener readiness must not reach the renderer');

registry.dispatch(firstSenderId, captureEvent(
  IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
  { text: 'older pending text', source: 'shortcut' },
), deliver);
const latestBeforeReady = captureEvent(
  IPC_CHANNELS.SCREENSHOT_REQUESTED,
  { source: 'shortcut' },
);
registry.dispatch(firstSenderId, latestBeforeReady, deliver);
assert.deepEqual(delivered, [],
  'staging multiple pre-ready captures must not deliver any of them early');

registry.markReady(firstSenderId, deliver);
assert.deepEqual(delivered, [
  { senderId: firstSenderId, event: latestBeforeReady },
], 'listener readiness must replay exactly the newest bounded capture once');

registry.markReady(firstSenderId, deliver);
assert.equal(delivered.length, 1,
  'a duplicate listener-ready handshake must not replay an acknowledged capture');

const immediateClipboard = captureEvent(
  IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
  { text: 'ready text', source: 'shortcut', truncated: false, originalLength: 10 },
);
registry.dispatch(firstSenderId, immediateClipboard, deliver);
assert.deepEqual(delivered.at(-1), {
  senderId: firstSenderId,
  event: immediateClipboard,
}, 'capture ingress must deliver immediately once the listener is ready');

registry.markNotReady(firstSenderId);
const queuedAfterReload = captureEvent(
  IPC_CHANNELS.SCREENSHOT_REQUESTED,
  { source: 'shortcut' },
);
registry.dispatch(firstSenderId, queuedAfterReload, deliver);
assert.equal(delivered.length, 2,
  'a renderer reload must return capture ingress to a non-delivering state');
registry.markReady(firstSenderId, deliver);
assert.deepEqual(delivered.at(-1), {
  senderId: firstSenderId,
  event: queuedAfterReload,
}, 'the first listener-ready handshake after reload must replay the new pending capture');

const replacementSenderId = 42;
registry.begin(replacementSenderId);
const emptyClipboardError = captureEvent(
  IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
  {
    text: '',
    source: 'shortcut',
    truncated: false,
    originalLength: 0,
    error: '剪贴板里没有可解释的文本',
  },
);
registry.dispatch(replacementSenderId, captureEvent(
  IPC_CHANNELS.SCREENSHOT_REQUESTED,
  { source: 'shortcut' },
), deliver);
registry.dispatch(replacementSenderId, emptyClipboardError, deliver);
assert.equal(delivered.length, 3,
  'a replacement renderer must queue captures again until its listener is ready');
registry.markReady(replacementSenderId, deliver);
assert.deepEqual(delivered.at(-1), {
  senderId: replacementSenderId,
  event: emptyClipboardError,
}, 'the latest empty-clipboard error must survive the readiness gap');
assert.equal(delivered.filter(({ senderId }) => senderId === replacementSenderId).length, 1,
  'the bounded queue must not replay the superseded capture alongside the latest event');

const retrySenderId = 43;
registry.begin(retrySenderId);
const retryableEvent = captureEvent(
  IPC_CHANNELS.SCREENSHOT_REQUESTED,
  { source: 'shortcut' },
);
registry.dispatch(retrySenderId, retryableEvent, deliver);
let rejectedDeliveries = 0;
registry.markReady(retrySenderId, () => {
  rejectedDeliveries += 1;
  throw new Error('simulated renderer delivery failure');
});
assert.equal(rejectedDeliveries, 1,
  'listener readiness must attempt delivery when a capture is pending');
registry.markReady(retrySenderId, deliver);
assert.deepEqual(delivered.at(-1), {
  senderId: retrySenderId,
  event: retryableEvent,
}, 'a thrown delivery failure must stay pending for the next valid listener-ready handshake');

const senderBoundaryRegistry = createCaptureIngressRegistry();
const senderBoundaryDeliveries = [];
senderBoundaryRegistry.begin(51);
senderBoundaryRegistry.dispatch(51, captureEvent(
  IPC_CHANNELS.CLIPBOARD_TEXT_CHANGED,
  { text: 'must not cross renderer boundary', source: 'shortcut' },
), recordDeliveries(senderBoundaryDeliveries));
senderBoundaryRegistry.begin(52);
senderBoundaryRegistry.markReady(52, recordDeliveries(senderBoundaryDeliveries));
assert.deepEqual(senderBoundaryDeliveries, [],
  'beginning a replacement renderer must discard capture text owned by the old renderer');

const replacementCapture = captureEvent(
  IPC_CHANNELS.SCREENSHOT_REQUESTED,
  { source: 'shortcut' },
);
senderBoundaryRegistry.markNotReady(52);
senderBoundaryRegistry.dispatch(52, replacementCapture, recordDeliveries(senderBoundaryDeliveries));
senderBoundaryRegistry.markReady(52, recordDeliveries(senderBoundaryDeliveries));
assert.deepEqual(senderBoundaryDeliveries, [
  { senderId: 52, event: replacementCapture },
], 'the replacement renderer must still replay capture intent queued under its own ownership');

console.log('Capture ingress readiness checks passed.');
