'use strict';

window.readingReferences = (() => {
  const $ = (id) => document.getElementById(id);
  let act;
  let state;
  let editor = null;
  let paperId;
  let listKey = '';
  let candidatesKey = '';
  let lookupKey = '';
  let draftToken;
  let busy = false;
  const symbolText = (value) => window.readingMath.mathRanges(value).length ? value
    : /[\\_^α-ωΑ-Ω₀-₉]|^[A-Za-z]$/u.test(value) ? `$${value}$` : value;
  const math = (element, value) => window.renderReadingMath(element, value || '');
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const button = (label, callback) => {
    const element = node('button', 'text-button', label);
    element.type = 'button';
    element.onclick = callback;
    return element;
  };
  const action = (name, payload = {}) => act(name, { paperId: state.paperId, ...payload });

  function openEditor(entry = {}) {
    editor = { ...entry, paperId: state.paperId };
    $('paper-select').disabled = true;
    $('reference-editor').hidden = false;
    $('reference-editor-title').textContent = entry.id ? '修改本文定义' : '记入本文速查';
    $('reference-symbol').value = entry.symbol || '';
    $('reference-meaning').value = entry.meaning || '';
    $('reference-scope').value = entry.scope || '';
    $('reference-evidence').value = entry.evidence || '';
    $('reference-editor-details').open = Boolean(entry.evidence || entry.scope);
    previewEditor();
    $('reference-editor').scrollIntoView({ block: 'nearest' });
    (entry.symbol ? $('reference-meaning') : $('reference-symbol')).focus();
  }
  function previewEditor() {
    math($('reference-editor-preview'), `${symbolText($('reference-symbol').value)}\n${$('reference-meaning').value}`);
  }
  function closeEditor() { editor = null; $('reference-editor').hidden = true; $('paper-select').disabled = false; }

  function entryNode(entry, candidate = false, lookup = false) {
    const item = node('article', 'reference-entry');
    item.dataset.referenceId = entry.id || '';
    const heading = node('div', 'reference-entry-heading');
    const symbol = node('span', 'reference-symbol');
    math(symbol, symbolText(entry.symbol));
    if (!lookup) heading.append(symbol);
    if (entry.scope) heading.append(node('span', 'reference-badge', entry.scope));
    if (entry.sameSymbolCount > 1) heading.append(node('span', 'reference-badge reference-conflict', `${entry.sameSymbolCount} 处定义`));
    if (entry.origin === 'manual') heading.append(node('span', 'reference-badge', '手记'));
    if (entry.pending) heading.append(node('span', 'reference-badge', '本段提取 · 待核对'));
    const meaning = node('div', 'reference-entry-meaning');
    math(meaning, entry.meaning);
    if (heading.childNodes.length) item.append(heading);
    item.append(meaning);
    if (entry.evidence) {
      const evidence = node('details');
      evidence.append(node('summary', '', '原文依据'));
      const quote = node('blockquote');
      math(quote, entry.evidence);
      evidence.append(quote);
      item.append(evidence);
    }
    if (!lookup) {
      const actions = node('div', 'reference-actions');
      if (candidate) actions.append(button('留下', async () => {
        if (busy) return;
        busy = true;
        try { await action('reference-accept', { key: entry.key }); } finally { busy = false; }
      }));
      actions.append(button(candidate ? '修改后留下' : '修改', () => openEditor(entry)));
      if (!candidate) {
        actions.append(button('复制', () => action('reference-copy', { id: entry.id })));
        actions.append(button('移除', () => {
          const confirm = button('确认移除', () => action('reference-remove', { id: entry.id, revision: entry.revision }));
          const cancel = button('保留', () => { listKey = ''; render(state); });
          actions.replaceChildren(confirm, cancel);
        }));
      }
      item.append(actions);
    }
    if (lookup && entry.pending) item.append(button('留在本文', () => action('reference-accept', { key: entry.key })));
    return item;
  }

  function render(next) {
    state = next;
    const references = state.references;
    const enabled = Boolean(references?.enabled);
    $('paper-bar').hidden = !enabled;
    if (!enabled) return;
    const paper = references.paper;
    const only = state.referenceOnly;
    document.body.classList.toggle('reference-only', Boolean(only));
    const optionsKey = JSON.stringify(references.papers);
    if ($('paper-select').dataset.options !== optionsKey) {
      $('paper-select').dataset.options = optionsKey;
      $('paper-select').replaceChildren(new Option('临时阅读', ''));
      for (const item of references.papers) $('paper-select').add(new Option(item.title, item.id));
      $('paper-select').add(new Option('＋ 新建阅读', '__new__'));
    }
    $('paper-select').value = paper?.id || '';
    $('open-references').hidden = only;
    $('open-references').textContent = paper ? `本文速查 · ${paper.entries.length}` : '本文速查';
    $('reference-content').hidden = !only;
    $('reference-welcome').hidden = Boolean(paper);
    $('reference-paper-tools').hidden = !paper;
    if (paperId !== state.paperId) {
      paperId = state.paperId;
      if (!editor) $('reference-editor').hidden = true;
      $('paper-title').value = paper?.title || '';
      $('reference-search').value = '';
      $('paper-delete-confirm').hidden = true;
      listKey = '';
    }
    if (document.activeElement !== $('paper-title')) $('paper-title').value = paper?.title || '';
    $('reference-notice').textContent = references.notice || '';
    $('reference-notice').hidden = !references.notice;
    $('reference-refresh').hidden = !references.notice;
    $('paper-undo').hidden = !references.undoAvailable;
    $('reference-extract').hidden = only || !paper || !['done', 'partial'].includes(state.phase) || !state.explainSupported;
    $('reference-extract').disabled = references.status === 'loading';
    $('reference-extract').textContent = references.status === 'loading' ? '正在查找定义…' : '整理这段的符号定义';
    const candidates = references.candidates || [];
    const rawQuery = $('reference-search').value.trim();
    const matches = (entry) => window.readingNotation.matchesReferenceSearch(entry, rawQuery);
    const visibleCandidates = candidates.filter(matches);
    $('reference-offer').hidden = only || !candidates.length;
    $('reference-offer-text').textContent = `找到 ${candidates.length} 条本文定义`;
    $('reference-candidates').hidden = !only || !visibleCandidates.length;
    $('reference-accept-all').hidden = Boolean(rawQuery);
    const newCandidatesKey = JSON.stringify([state.paperId, visibleCandidates]);
    if (newCandidatesKey !== candidatesKey) {
      candidatesKey = newCandidatesKey;
      $('candidate-heading').textContent = `原文中的定义 · ${visibleCandidates.length}`;
      $('candidate-entries').replaceChildren(...visibleCandidates.map((entry) => entryNode(entry, true)));
    }
    const entries = (paper?.entries || []).filter(matches);
    const newListKey = JSON.stringify([state.paperId, entries, rawQuery]);
    if (newListKey !== listKey) {
      listKey = newListKey;
      $('reference-entries').replaceChildren(...entries.map((entry) => entryNode(entry)));
    }
    $('reference-empty').hidden = entries.length > 0 || visibleCandidates.length > 0;
    $('reference-empty').textContent = rawQuery ? '本文没有匹配的记录。' : '还没有留下定义。截图阅读时可保存发现的定义，也可以手动记一条。';
    if (references.draft && references.draft.token !== draftToken && only) {
      draftToken = references.draft.token;
      openEditor(references.draft);
    }
    const lookup = state.lookup;
    $('reference-from-lookup').hidden = only || !lookup || (lookup.reference && lookup.definitions?.length > 0);
    const newLookupKey = JSON.stringify(lookup?.reference ? lookup : null);
    if (newLookupKey !== lookupKey) {
      lookupKey = newLookupKey;
      $('lookup-references').replaceChildren();
      if (lookup?.reference) {
        const definitions = lookup.definitions || [];
        if (!definitions.length) $('lookup-references').append(node('p', 'muted', '本文尚未留下这个符号的定义。可以截取定义所在段落，或手动记下。'));
        if (definitions.length > 1) $('lookup-references').append(node('p', 'muted', '这个符号有多处定义，请结合适用位置和原文核对。'));
        $('lookup-references').append(...definitions.map((entry) => entryNode(entry, false, true)));
      }
    }
    if (only) {
      for (const id of ['review', 'reading-content', 'original', 'recovery', 'formula-tools', 'selection-bar', 'lookup-panel']) $(id).hidden = true;
      $('card-label').textContent = state.collapsed ? '双击展开' : '本文速查';
      $('status').textContent = paper ? `${paper.entries.length} 条 · 本机保存` : '按论文保留';
    }
  }

  function init(performAction) {
    act = performAction;
    $('reference-entries').after($('reference-candidates'));
    $('reading-content').after($('reference-offer'), $('reference-extract'));
    $('paper-select').onchange = async () => {
      const value = $('paper-select').value;
      if (value === '__new__') {
        if (await action('paper-create')) await action('reference-open');
      } else await action('paper-select', { paperId: value || null });
    };
    $('paper-create').onclick = () => action('paper-create');
    for (const id of ['open-references', 'reference-offer-open']) $(id).onclick = () => action('reference-open');
    $('reference-from-lookup').onclick = () => action('reference-draft');
    $('reference-extract').onclick = () => action('reference-extract');
    $('reference-refresh').onclick = () => action('reference-refresh');
    $('reference-new').onclick = () => openEditor();
    $('reference-search').oninput = () => render(state);
    $('paper-rename').onclick = () => action('paper-rename', { title: $('paper-title').value });
    $('paper-title').onkeydown = (event) => { if (event.key === 'Enter') $('paper-rename').click(); };
    $('paper-delete').onclick = () => { $('paper-delete-confirm').hidden = false; $('paper-delete-confirmed').focus(); };
    $('paper-delete-cancel').onclick = () => { $('paper-delete-confirm').hidden = true; };
    $('paper-delete-confirmed').onclick = () => action('paper-remove', { confirm: true });
    $('paper-undo').onclick = () => action('paper-undo');
    $('reference-accept-all').onclick = async () => {
      if (busy) return;
      busy = true;
      $('reference-accept-all').disabled = true;
      const capturedPaperId = state.paperId;
      const candidates = [...state.references.candidates];
      try {
        for (const entry of candidates) {
          if (state.paperId !== capturedPaperId || !await action('reference-accept', { key: entry.key })) break;
        }
      } finally { busy = false; $('reference-accept-all').disabled = false; }
    };
    $('reference-editor-cancel').onclick = closeEditor;
    $('reference-editor-details').querySelector('summary').onclick = (event) => event.stopPropagation();
    for (const id of ['reference-symbol', 'reference-meaning']) $(id).oninput = previewEditor;
    $('reference-editor').onsubmit = async (event) => {
      event.preventDefault();
      if (!editor || busy) return;
      busy = true;
      $('reference-editor-save').disabled = true;
      const draft = editor;
      const evidence = $('reference-evidence').value.trim();
      try {
        if (!draft.paperId) {
          const result = await action('paper-create');
          if (!result) return;
          draft.paperId = state.paperId;
        }
        const result = await action('reference-save', { paperId: draft.paperId, id: draft.id, revision: draft.revision,
          entry: { symbol: $('reference-symbol').value.trim(), meaning: $('reference-meaning').value.trim(),
            scope: $('reference-scope').value.trim(), evidence, source: draft.source || evidence, origin: 'manual' } });
        if (result) closeEditor();
      } finally { busy = false; $('reference-editor-save').disabled = false; }
    };
  }
  return { init, render, symbolText, closeEditor, isEditing: () => Boolean(editor) };
})();
