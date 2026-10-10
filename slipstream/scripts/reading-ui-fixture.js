'use strict';

const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const { createReadingPins } = require('../src/main/reading-pins');
const { createReadingProcessor } = require('../src/main/reading-service');
const { createTermCardStore } = require('../src/main/term-card-store');
const { createTermLibrary } = require('../src/main/term-library');
const { createReadingReferenceStore } = require('../src/main/reading-reference-store');
const { READING_SETUP_SOURCE } = require('../src/shared/reading-setup.mjs');

function attachReadingUiFixture({ ipcMain, fixtureWindow, rendererUrl, directory }) {
  const paragraphs = READING_SETUP_SOURCE.split('\n\n');
  const translations = [
    String.raw`矩阵 $A$ 的特征向量是一个非零向量 $v$，它对某个标量 $\lambda$ 满足 $Av = \lambda v$。`,
    String.raw`标量 $\lambda$ 称为与 $v$ 对应的特征值。例如，若 $Av = 2v$，则 $v$ 是特征值为 $2$ 的特征向量。`,
  ];
  const settings = { setupMode: 'full', activeBackend: 'ollama', activeModel: '固定数学示例',
    ollamaBaseUrl: 'http://localhost:11434', languageHint: 'en', resultOrder: 'translation-first' };
  const processor = createReadingProcessor(async (_s, _b, _m, _prompt, message) => {
    const input = JSON.parse(message);
    if (input.candidates) return JSON.stringify({ keep: input.candidates.map((_term, index) => index) });
    if (input.selection === 'eigenvector' || input.selection === 'eigenvalue') {
      return JSON.stringify({ quote: input.selection,
        meaning: input.selection === 'eigenvector'
          ? String.raw`特征向量是满足 $Av = \lambda v$ 的非零向量 $v$；矩阵作用后，结果是原向量的标量倍数。`
          : String.raw`特征值是满足 $Av = \lambda v$ 的标量 $\lambda$，表示矩阵对这个特征向量的缩放倍数。`,
        note: String.raw`在示例 $Av = 2v$ 中，$v$ 是特征向量，$2$ 是对应的特征值。` });
    }
    const index = paragraphs.indexOf(input.excerpt);
    if (index < 0) throw new Error('reading-fixture-sample-only');
    return JSON.stringify({ translation: translations[index],
      terms: [{ quote: index === 0 ? 'eigenvector' : 'eigenvalue', label: index === 0 ? '特征向量' : '特征值', role: 'core' }], references: [] });
  });
  const store = createTermCardStore(path.join(directory, 'reading-cards'));
  const library = createTermLibrary({ BrowserWindow, ipcMain, store,
    shell: { openPath: async () => 'fixture-no-external-files', showItemInFolder() {} },
    dialog: { showMessageBoxSync: () => 0 } });
  const pins = createReadingPins({ BrowserWindow, ipcMain, screen, getSettings: () => settings,
    getMainWindow: () => fixtureWindow, captureSupported: false,
    processReadingText: async options => ({ ...await processor(options), scopeNotice: '固定回复演示 · 不连接模型' }),
    saveTermCard: input => store.save(input), findTermCard: input => store.findMatching(input),
    referenceStore: createReadingReferenceStore(path.join(directory, 'reading-references')),
    onOpenLibrary: id => library.open(id), onOpenSettings: () => fixtureWindow.show(),
    classifyError: () => '此演示只提供内置数学试读及“eigenvector / eigenvalue”的固定回复。',
  });
  const channels = ['reading:open-text', 'reading:library-open', 'reading:references-open', 'screenshot:capture'];
  for (const channel of channels) ipcMain.handle(channel, (event, text) => {
    if (event.sender !== fixtureWindow.webContents || event.senderFrame !== fixtureWindow.webContents.mainFrame
      || event.senderFrame.url !== rendererUrl) throw new Error('Untrusted reading fixture');
    if (channel === 'reading:open-text') return pins.openText(text);
    if (channel === 'reading:library-open') { library.open(); return true; }
    if (channel === 'reading:references-open') return pins.openReferences();
    return pins.openText(READING_SETUP_SOURCE);
  });
  return { dispose() {
    pins.dispose(); library.dispose();
    for (const channel of channels) ipcMain.removeHandler(channel);
  } };
}

module.exports = { attachReadingUiFixture };
