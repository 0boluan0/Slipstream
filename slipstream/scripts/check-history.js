const { app } = require('electron');

const phase = process.argv[2];
const userData = process.argv[3];

app.setPath('userData', userData);

app.whenReady().then(() => {
  const store = require('../src/main/store');

  if (phase === 'write') {
    store.addExplanationHistory({
      sourceText: 'Financial aid deadline is Friday.',
      explanation: '1. 中文意思：助学金截止日期是周五。\n2. 专有名词 / 缩写 / 机构 / 课程名：Financial aid，助学金。',
      backend: 'ollama',
      model: 'deepseek-r1:14b',
      source: 'manual',
      openaiApiKey: 'sk-should-not-persist',
    });
    app.exit(0);
    return;
  }

  const entry = store.getExplanationHistory().find((item) => item.sourceText === 'Financial aid deadline is Friday.');
  if (
    !entry ||
    entry.explanation.includes('助学金') === false ||
    entry.backend !== 'ollama' ||
    entry.model !== 'deepseek-r1:14b' ||
    entry.source !== 'manual' ||
    Object.hasOwn(entry, 'openaiApiKey')
  ) {
    console.error(JSON.stringify(store.getExplanationHistory()));
    app.exit(1);
    return;
  }

  console.log('history persistence check passed');
  app.exit(0);
});
