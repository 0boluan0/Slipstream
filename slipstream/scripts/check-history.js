const { app } = require('electron');

const phase = process.argv[2];
const userData = process.argv[3];

app.setPath('userData', userData);

app.whenReady().then(() => {
  const store = require('../src/main/store');
  const status = store.initializeStore();
  if (status.state !== 'ready') {
    console.error(JSON.stringify(status));
    app.exit(1);
    return;
  }

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

  if (store.getExplanationHistory().length !== 0) {
    console.error(JSON.stringify(store.getExplanationHistory()));
    app.exit(1);
    return;
  }

  console.log('history non-retention check passed');
  app.exit(0);
});
