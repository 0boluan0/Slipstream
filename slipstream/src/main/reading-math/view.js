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
