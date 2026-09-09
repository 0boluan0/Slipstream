'use strict';

const byId = (id) => document.getElementById(id);
let cards = [];
let current = null;
let dirty = false;
let links = [];
let saving = false;

function message(text = '') {
  byId('message').textContent = text;
  byId('message').hidden = !text;
  byId('discard').hidden = !text || !dirty;
}
async function act(action, payload) {
  try {
    const result = await window.termLibrary.act(action, payload);
    if (result?.error) { message(result.error); return null; }
    return result;
  } catch { message('暂时无法读取本地卡片，请重试。'); return null; }
}
function markDirty() {
  dirty = true;
  byId('save').disabled = saving;
  byId('edit-status').textContent = '有未保存的修改';
}
function setEditing(editing) {
  byId('card').classList.toggle('read-mode', !editing);
  byId('edit').textContent = editing ? '结束编辑' : '编辑卡片';
  for (const field of ['label', 'meaning', 'context', 'notes']) {
    window.renderReadingMath(byId(`${field}-reading`), current?.[field] || (field === 'notes' ? '写下自己的理解，让这个概念成为你的知识。' : ''));
  }
}
function renderList() {
  const query = byId('search').value.trim().toLowerCase();
  const filtered = cards.filter((card) => [card.term, card.label, card.meaning, card.context, card.notes]
    .some((value) => value.toLowerCase().includes(query)));
  byId('count').textContent = String(cards.length);
  byId('card-list').replaceChildren();
  for (const card of filtered) {
    const button = document.createElement('button');
    button.className = 'card-item';
    button.setAttribute('aria-current', String(current?.id === card.id));
    const term = document.createElement('strong');
    term.lang = 'en';
    term.textContent = card.term;
    const label = document.createElement('span');
    label.textContent = card.label || card.meaning.slice(0, 35);
    button.append(term, label);
    button.onclick = () => selectCard(card.id);
    byId('card-list').append(button);
  }
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = cards.length ? '没有匹配的卡片。' : '还没有保存的卡片。';
    byId('card-list').append(empty);
  }
}
function renderConnections() {
  const related = cards.filter((card) => links.includes(card.id) || card.links.includes(current.id));
  byId('connections').replaceChildren();
  for (const card of related) {
    const button = document.createElement('button');
    button.textContent = card.label ? `${card.label} · ${card.term}` : card.term;
    button.onclick = () => selectCard(card.id);
    byId('connections').append(button);
  }
  byId('connect').replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '选择另一个概念…';
  byId('connect').append(placeholder);
  for (const card of cards.filter((entry) => entry.id !== current.id && !related.includes(entry))) {
    const option = document.createElement('option');
    option.value = card.id;
    option.textContent = card.label ? `${card.label} · ${card.term}` : card.term;
    byId('connect').append(option);
  }
  byId('add-link').disabled = byId('connect').options.length <= 1;
}
function selectCard(id) {
  if (dirty) { message('先保存当前修改，再切换卡片。'); return; }
  current = cards.find((card) => card.id === id) || cards[0] || null;
  byId('empty').hidden = Boolean(current);
  byId('card').hidden = !current;
  renderList();
  if (!current) return;
  byId('term').textContent = current.term;
  byId('card-kind').textContent = current.kind === 'concept' ? '概念卡片' : '词句翻译卡片';
  byId('date').textContent = `保存于 ${new Date(current.created).toLocaleDateString('zh-CN')} · Markdown`;
  for (const field of ['label', 'meaning', 'context', 'notes']) byId(field).value = current[field];
  window.renderReadingMath(byId('source'), current.source);
  links = [...current.links];
  renderConnections();
  byId('save').disabled = true;
  byId('edit-status').textContent = '已保存在本地';
  setEditing(false);
  document.querySelector('main').scrollTop = 0;
}
async function load(id) {
  if (dirty) { message('有未保存的修改。先保存，再重新载入卡片。'); return; }
  const result = await act('list');
  if (!result) return;
  cards = result.cards;
  message(result.unreadable ? `${result.unreadable} 个 Markdown 文件无法读取。原文件已保留，可在本地文件夹检查。` : '');
  selectCard(id || current?.id || result.selectedId);
}
for (const field of ['label', 'meaning', 'context', 'notes']) byId(field).oninput = markDirty;
byId('search').oninput = renderList;
byId('refresh').onclick = () => load();
byId('discard').onclick = () => { dirty = false; load(); };
byId('folder').onclick = () => act('open-folder');
byId('reveal').onclick = () => current && act('reveal-file', { id: current.id });
byId('edit').onclick = () => {
  if (dirty) { message('先保存修改，再结束编辑。'); return; }
  setEditing(byId('card').classList.contains('read-mode'));
};
byId('add-link').onclick = () => {
  if (!byId('connect').value) return;
  links.push(byId('connect').value);
  setEditing(true);
  markDirty();
  renderConnections();
};
byId('save').onclick = async () => {
  if (!current || saving) return;
  saving = true;
  byId('save').disabled = true;
  byId('discard').disabled = true;
  const changes = Object.fromEntries(['label', 'meaning', 'context', 'notes'].map((field) => [field, byId(field).value]));
  changes.links = [...links];
  const result = await act('edit', { id: current.id, changes, revision: current.revision });
  saving = false;
  byId('discard').disabled = false;
  if (!result) { byId('save').disabled = false; return; }
  // Preserve edits typed while the disk write was in progress.
  current = result.card;
  cards = cards.map((card) => card.id === current.id ? current : card);
  dirty = ['label', 'meaning', 'context', 'notes'].some((field) => byId(field).value !== changes[field])
    || JSON.stringify(links) !== JSON.stringify(changes.links);
  byId('save').disabled = !dirty;
  byId('edit-status').textContent = dirty ? '有未保存的修改' : '已保存在本地';
  message();
  renderList();
  if (!dirty) setEditing(false);
};
window.onbeforeunload = () => dirty ? false : undefined;
window.termLibrary.onRefresh((id) => load(id));
load();
