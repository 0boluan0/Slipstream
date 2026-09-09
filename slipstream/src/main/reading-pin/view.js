'use strict';

const byId = (id) => document.getElementById(id);
let state = null;
let previousPhase = '';
let mode = 'translation';
let fontSize = 16;
let selected = null;
let fitRequested = false;
let copyTimer;
const scrollPositions = { translation: 0, parallel: 0, image: 0 };
const sourceOpen = new Set();
const segmentNodes = new Map();

async function act(action, payload) {
  try {
    const result = await window.readingPin.act(action, payload);
    if (result?.state) render(result.state);
    return result;
  } catch {
    byId('notice').hidden = false;
    byId('notice').textContent = '操作暂时没有完成，请重试或关闭这张卡片。';
    return false;
  }
}

function setMode(next, focus = false) {
  scrollPositions[mode] = byId('scroll-area').scrollTop;
  mode = next;
  byId('selection-bar').hidden = true;
  document.querySelectorAll('[role="tab"]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  if (state) render(state);
  byId('scroll-area').scrollTop = scrollPositions[mode];
}

function createSegment(segment) {
  const section = document.createElement('section');
  section.className = 'segment';
  section.dataset.id = segment.id;
  const tools = document.createElement('div');
  tools.className = 'segment-tools';
  const number = document.createElement('span');
  number.textContent = String(segment.id + 1).padStart(2, '0');
  const toggle = document.createElement('button');
  toggle.textContent = '原文';
  toggle.setAttribute('aria-label', `查看第 ${segment.id + 1} 段英文原文`);
  toggle.onclick = () => {
    if (sourceOpen.has(segment.id)) sourceOpen.delete(segment.id);
    else sourceOpen.add(segment.id);
    render(state);
  };
  tools.append(number, toggle);
  const source = document.createElement('p');
  source.className = 'source-paragraph';
  source.lang = 'en';
  source.dataset.segmentId = segment.id;
  source.textContent = segment.source;
  const translation = document.createElement('p');
  translation.className = 'translation-paragraph';
  const terms = document.createElement('div');
  terms.className = 'term-list';
  section.append(tools, source, translation, terms);
  byId('translation').append(section);
  const node = { section, source, translation, toggle, terms, termsKey: '', sourceValue: segment.source };
  segmentNodes.set(segment.id, node);
  return node;
}

function requestLookup(selection) {
  selected = selection;
  byId('selection-bar').hidden = true;
  return act('lookup', { ...selection, revision: state?.revision });
}

function renderSegments(segments) {
  for (const [id, node] of segmentNodes) {
    if (!segments.some((segment) => segment.id === id && segment.source === node.sourceValue)) {
      node.section.remove();
      segmentNodes.delete(id);
      sourceOpen.delete(id);
    }
  }
  for (const segment of segments) {
    const node = segmentNodes.get(segment.id) || createSegment(segment);
    node.section.dataset.status = segment.status;
    node.source.hidden = mode !== 'parallel' && !sourceOpen.has(segment.id);
    node.toggle.hidden = mode === 'parallel';
    node.toggle.textContent = node.source.hidden ? '原文' : '收起原文';
    node.toggle.setAttribute('aria-expanded', String(!node.source.hidden));
    const value = segment.status === 'done' ? segment.translation
      : segment.status === 'error' ? segment.error
        : segment.status === 'translating' ? '正在翻译这一段…' : '等待翻译…';
    window.renderReadingMath(node.translation, value);
    const termsKey = JSON.stringify(segment.terms || []);
    if (node.termsKey !== termsKey) {
      node.termsKey = termsKey;
      node.terms.replaceChildren();
      if (segment.terms?.length) {
        const label = document.createElement('span');
        label.textContent = '术语';
        node.terms.append(label);
        for (const term of segment.terms) {
          const button = document.createElement('button');
          button.className = 'term-chip';
          button.dataset.quote = term.quote;
          button.setAttribute('aria-label', `解释 ${term.label} · ${term.quote}`);
          button.title = term.quote;
          const labelText = document.createElement('span');
          labelText.textContent = term.label;
          const english = document.createElement('span');
          english.className = 'term-english';
          english.lang = 'en';
          english.textContent = term.quote;
          button.append(labelText, english);
          button.onclick = () => requestLookup({ segmentId: segment.id, start: term.start, end: term.end });
          node.terms.append(button);
        }
      }
    }
    node.terms.hidden = !segment.terms?.length;
    node.terms.querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(state.lookup?.quote === button.dataset.quote));
    });
  }
}

function render(next) {
  state = next;
  const segments = state.segments || [];
  const completed = segments.filter((segment) => segment.status === 'done').length;
  const working = ['ocr', 'waiting', 'translating', 'explaining', 'recognizing'].includes(state.phase);
  const labels = { ocr: '正在本机识别…', waiting: '准备翻译…', translating: `已完成 ${completed} / ${segments.length} 段`, explaining: '正在解释…', review: '等待核对', done: `${segments.length} 段 · 已完成`, partial: '部分段落待重试', error: '需要处理' };
  if (!copyTimer) byId('status').textContent = state.phase === 'recognizing' ? '正在转写公式…' : labels[state.phase] || '';
  byId('card-label').textContent = state.collapsed ? '双击展开' : '阅读';
  document.body.classList.toggle('collapsed', Boolean(state.collapsed));
  byId('collapse').setAttribute('aria-expanded', String(!state.collapsed));
  byId('collapse').setAttribute('aria-label', state.collapsed ? '展开卡片' : '收起卡片');
  byId('collapse').title = state.collapsed ? '展开卡片 · 双击顶部' : '收起卡片 · 双击顶部';
  byId('collapse').querySelector('img').src = state.collapsed ? './icons/ArrowsOutSimple.svg' : './icons/Minus.svg';
  byId('notice').hidden = !state.notice;
  byId('notice').textContent = state.notice || '';
  byId('destination').textContent = state.imageSent
    ? `${(state.destination || '').replace('截图留在本机。', '')}本次已请求将截图发送到 DeepSeek 识别公式。`
    : state.destination || '截图文字识别在本机完成';
  byId('pin').setAttribute('aria-pressed', String(state.topmost));
  byId('pin').title = state.topmost ? '取消置顶' : '置顶';
  byId('loading').hidden = !working || segments.length > 0;
  byId('review').hidden = state.phase !== 'review' || mode === 'image';
  byId('tab-translation').textContent = state.phase === 'review' ? '核对' : '译文';
  byId('tab-image').hidden = !state.image;
  if (state.phase === 'review' && previousPhase !== 'review') {
    byId('source-editor').value = state.sourceText || '';
    window.renderReadingMath(byId('source-preview'), state.sourceText || '');
    byId('formula-preview').open = window.readingMath.mathRanges(state.sourceText || '').length > 0;
    byId('review-title').focus({ preventScroll: true });
  }
  byId('reading-content').hidden = state.phase === 'review' || mode === 'image';
  byId('reading-content').setAttribute('aria-labelledby', mode === 'parallel' ? 'tab-parallel' : 'tab-translation');
  byId('reading-hint').hidden = mode !== 'parallel' || !segments.length;
  byId('reading-hint').textContent = state.explainSupported ? '选中英文词句，查看概念与上下文解释。' : '选中英文词句可单独翻译；术语解释需配置模型。';
  byId('recovery').hidden = !['error', 'partial'].includes(state.phase);
  byId('retry').hidden = !state.sourceText;
  byId('original').hidden = mode !== 'image' || !state.image;
  if (byId('source-image').getAttribute('src') !== state.image) {
    if (state.image) byId('source-image').src = state.image;
    else byId('source-image').removeAttribute('src');
  }
  byId('source-text').textContent = state.sourceText || '';
  byId('edit-source').disabled = working || state.phase === 'review';
  byId('copy').disabled = state.phase !== 'done' || !state.translation;
  byId('formula-tools').hidden = !state.image || (!['review', 'recognizing', 'error'].includes(state.phase) && mode !== 'image');
  byId('recognize-formulas').hidden = !state.formulaSupported;
  byId('recognize-formulas').disabled = working;
  byId('formula-unavailable').hidden = state.formulaSupported;
  byId('formula-destination').hidden = !state.formulaSupported;
  byId('formula-notice').textContent = state.formulaNotice || '';
  if (state.formulaStatus) byId('formula-tools').open = true;
  renderSegments(segments);
  const lookup = state.lookup;
  byId('lookup-panel').hidden = !lookup && !state.lookupNotice;
  if (lookup || state.lookupNotice) {
    const contextual = lookup?.contextual ?? state.explainSupported;
    byId('lookup-title').textContent = contextual ? '术语与词句解释' : '词句翻译';
    byId('lookup-quote').textContent = lookup?.quote || '';
    window.renderReadingMath(byId('lookup-meaning'), state.lookupStatus === 'loading' ? '正在结合这段原文解释…' : lookup?.meaning || '');
    byId('meaning-label').hidden = !contextual || state.lookupStatus !== 'done';
    window.renderReadingMath(byId('lookup-note'), lookup?.note || '');
    byId('note-label').hidden = !lookup?.note;
    byId('lookup-notice').hidden = !state.lookupNotice;
    byId('lookup-notice').textContent = state.lookupNotice || '';
    byId('lookup-retry').hidden = state.lookupStatus !== 'error' || !selected;
    byId('lookup-settings').hidden = contextual || state.lookupStatus !== 'done';
    byId('save-term').disabled = state.lookupStatus !== 'done' || state.saveStatus === 'saving';
    byId('save-term').textContent = state.saveStatus === 'saving' ? '正在保存…' : state.saveStatus === 'saved' ? '打开卡片' : '存为卡片';
    byId('save-note').textContent = state.saveStatus === 'saved' ? '已保存在本地' : state.saveStatus === 'error' ? '保存失败，可重试' : '保留解释与这段原文';
  }
  if (state.phase === 'done' && !fitRequested && mode === 'translation' && !state.lookup && !state.collapsed) {
    fitRequested = true;
    requestAnimationFrame(() => act('fit', { height: byId('translation').scrollHeight + 180 }));
  }
  previousPhase = state.phase;
}

function captureSelection() {
  if (!state || !['done', 'partial', 'translating'].includes(state.phase)) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    byId('selection-bar').hidden = true;
    return;
  }
  const range = selection.getRangeAt(0);
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const paragraph = element?.closest('.source-paragraph');
  if (!paragraph || !paragraph.contains(range.endContainer)) { byId('selection-bar').hidden = true; return; }
  const prefix = range.cloneRange();
  prefix.selectNodeContents(paragraph);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const text = range.toString();
  if (!text.trim() || text.length > 1500) { byId('selection-bar').hidden = true; return; }
  selected = { segmentId: Number(paragraph.dataset.segmentId), start, end: start + text.length };
  byId('selection-preview').textContent = text;
  byId('lookup-selection').lastChild.textContent = state.explainSupported ? '解释所选' : '翻译所选';
  byId('selection-bar').hidden = false;
}

byId('close').onclick = () => act('close');
byId('pin').onclick = () => act('toggle-top');
byId('collapse').onclick = () => act('collapse');
byId('titlebar').ondblclick = (event) => { if (!event.target.closest('button')) act('collapse'); };
byId('confirm').onclick = () => { setMode('translation'); return act('translate', { revision: state?.revision, text: byId('source-editor').value }); };
byId('source-editor').oninput = () => window.renderReadingMath(byId('source-preview'), byId('source-editor').value);
byId('recognize-formulas').onclick = async () => {
  await act('recognize-formulas', { revision: state?.revision, sendImage: true,
    ...(state?.phase === 'review' ? { text: byId('source-editor').value } : {}) });
  if (state?.phase === 'review') setMode('translation');
};
byId('retry').onclick = () => act('translate', { revision: state?.revision, retryFailed: true });
byId('retake').onclick = () => act('retake');
for (const id of ['settings', 'footer-settings', 'lookup-settings']) byId(id).onclick = () => act('settings');
byId('edit-source').onclick = () => act('review');
byId('review-image').onclick = () => setMode('image');
byId('lookup-close').onclick = () => act('dismiss-lookup');
byId('save-term').onclick = () => act(state?.saveStatus === 'saved' ? 'library' : 'save-term');
byId('library').onclick = () => act('library');
byId('lookup-retry').onclick = () => selected && requestLookup(selected);
byId('lookup-selection').onmousedown = (event) => event.preventDefault();
byId('lookup-selection').onclick = () => selected && requestLookup(selected);
byId('copy').onclick = async () => {
  if (await act('copy')) {
    clearTimeout(copyTimer);
    byId('status').textContent = '已复制译文';
    copyTimer = setTimeout(() => { copyTimer = null; if (state) render(state); }, 1800);
  }
};
byId('image-zoom').onclick = () => {
  const zoomed = byId('original').classList.toggle('zoomed');
  byId('image-zoom').setAttribute('aria-pressed', String(zoomed));
  byId('image-zoom').textContent = zoomed ? '适应宽度' : '原始尺寸';
};
function changeFont(delta) {
  fontSize = Math.max(13, Math.min(24, fontSize + delta));
  document.documentElement.style.setProperty('--reading-size', `${fontSize}px`);
  byId('smaller').disabled = fontSize === 13;
  byId('larger').disabled = fontSize === 24;
}
byId('smaller').onclick = () => changeFont(-1);
byId('larger').onclick = () => changeFont(1);
document.querySelectorAll('[role="tab"]').forEach((button) => {
  button.onclick = () => setMode(button.dataset.mode);
  button.onkeydown = (event) => {
    const modes = state?.image ? ['translation', 'parallel', 'image'] : ['translation', 'parallel'];
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1
      : (modes.indexOf(mode) + (event.key === 'ArrowRight' ? 1 : modes.length - 1)) % modes.length;
    setMode(modes[index], true);
  };
});
document.addEventListener('selectionchange', captureSelection);
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') { event.preventDefault(); act('close'); }
  else if (event.key === 'Escape') {
    event.preventDefault();
    if (byId('processing-info').open) byId('processing-info').open = false;
    else if (!byId('selection-bar').hidden) { window.getSelection()?.removeAllRanges(); byId('selection-bar').hidden = true; }
    else act(state?.lookup || state?.lookupNotice ? 'dismiss-lookup' : 'close');
  }
});
window.readingPin.subscribe(render);
act('ready');
