'use strict';

// Model output enters as text. Only KaTeX may create mathematical markup;
// external resources and HTML extensions stay disabled.
window.renderReadingMath = (element, value = '') => {
  if (element.dataset.mathSource === value) return;
  element.dataset.mathSource = value;
  element.replaceChildren();
  let offset = 0;
  for (const range of window.readingMath.mathRanges(value)) {
    element.append(document.createTextNode(value.slice(offset, range.start)));
    const node = document.createElement('span');
    node.className = range.display ? 'math-block' : 'math-inline';
    node.dataset.sourceStart = range.start;
    node.dataset.sourceEnd = range.end;
    node.title = value.slice(range.start, range.end);
    try {
      window.katex.render(range.tex, node, { displayMode: range.display, throwOnError: true,
        trust: false, strict: 'ignore', maxExpand: 500, maxSize: 10, output: 'htmlAndMathml' });
    } catch {
      node.className += ' math-fallback';
      node.textContent = value.slice(range.start, range.end);
      node.title = '此公式暂时无法排版，已保留 LaTeX 原文。';
    }
    element.append(node);
    offset = range.end;
  }
  element.append(document.createTextNode(value.slice(offset)));
};

// KaTeX contains both visual markup and MathML. DOM text lengths therefore do
// not match the source. Resolve a selection against direct rendered fragments,
// snapping any partial formula selection to its complete original expression.
window.readingMathSelection = (element, range) => {
  const source = element.dataset.mathSource;
  if (range.collapsed || typeof source !== 'string' || !element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  function sourceOffset(container, offset, end) {
    let position = 0;
    const children = [...element.childNodes];
    for (const [index, node] of children.entries()) {
      if (container === element && offset === index) return position;
      const math = node.nodeType === Node.ELEMENT_NODE && node.dataset.sourceEnd;
      const length = math ? Number(node.dataset.sourceEnd) - Number(node.dataset.sourceStart) : node.textContent.length;
      if (container === node && node.nodeType === Node.TEXT_NODE) return position + offset;
      if (node.contains(container)) {
        if (container === node && offset === 0) return position;
        if (container === node && offset === node.childNodes.length) return position + length;
        return position + (end ? length : 0);
      }
      position += length;
    }
    return container === element && offset === children.length ? position : null;
  }
  const start = sourceOffset(range.startContainer, range.startOffset, false);
  const end = sourceOffset(range.endContainer, range.endOffset, true);
  return start === null || end === null || start >= end ? null : { start, end, text: source.slice(start, end) };
};
