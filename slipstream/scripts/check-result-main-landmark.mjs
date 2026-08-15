import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parse } from 'espree';

const resultDisplayPath = new URL('../src/renderer/components/ResultDisplay.jsx', import.meta.url);
const resultDisplaySource = readFileSync(resultDisplayPath, 'utf8');
const resultDisplayAst = parse(resultDisplaySource, {
  ecmaVersion: 'latest',
  sourceType: 'module',
  ecmaFeatures: { jsx: true },
});

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  Object.values(node).forEach((value) => {
    if (Array.isArray(value)) {
      value.forEach((child) => walk(child, visit));
    } else {
      walk(value, visit);
    }
  });
}

function getElementName(element) {
  return element?.openingElement?.name?.type === 'JSXIdentifier'
    ? element.openingElement.name.name
    : null;
}

function getAttribute(element, name) {
  return element?.openingElement?.attributes?.find((attribute) => (
    attribute.type === 'JSXAttribute'
      && attribute.name.type === 'JSXIdentifier'
      && attribute.name.name === name
  ));
}

function getStaticAttributeValue(element, name) {
  const attribute = getAttribute(element, name);
  if (!attribute) return undefined;
  if (attribute.value === null) return true;
  if (attribute.value.type === 'Literal') return attribute.value.value;
  if (attribute.value.type === 'JSXExpressionContainer'
    && attribute.value.expression.type === 'Literal') {
    return attribute.value.expression.value;
  }
  return undefined;
}

function getExpressionIdentifier(element, name) {
  const attribute = getAttribute(element, name);
  const expression = attribute?.value?.type === 'JSXExpressionContainer'
    ? attribute.value.expression
    : null;
  return expression?.type === 'Identifier' ? expression.name : null;
}

function hasClass(element, className) {
  const classValue = getStaticAttributeValue(element, 'className');
  return typeof classValue === 'string' && classValue.split(/\s+/u).includes(className);
}

function collectElements(root) {
  const elements = [];
  walk(root, (node) => {
    if (node.type === 'JSXElement') elements.push(node);
  });
  return elements;
}

function directElementChildren(element) {
  return element.children.filter((child) => child.type === 'JSXElement');
}

const allElements = collectElements(resultDisplayAst);
const resultMains = allElements.filter((element) => (
  getElementName(element) === 'main' && hasClass(element, 'result-view')
));

assert.equal(resultMains.length, 1, 'ResultDisplay must expose exactly one result-view main landmark');

const resultMain = resultMains[0];
assert.equal(
  getStaticAttributeValue(resultMain, 'aria-labelledby'),
  'result-headline',
  'The result main landmark must be named by its visible conclusion heading',
);

const directChildren = directElementChildren(resultMain);
const resultSummary = directChildren.find((element) => (
  getElementName(element) === 'section' && hasClass(element, 'result-summary')
));
const evidenceWorkspace = directChildren.find((element) => (
  getElementName(element) === 'div' && hasClass(element, 'evidence-workspace')
));
const resultFooter = directChildren.find((element) => (
  getElementName(element) === 'footer' && hasClass(element, 'result-footer')
));

assert.ok(resultSummary, 'The visible result conclusion must be a direct child of the result main');
assert.ok(evidenceWorkspace, 'The evidence workspace must be a direct child of the result main');
assert.ok(resultFooter, 'The result action footer must be a direct child of the result main');
assert.equal(
  getAttribute(resultSummary, 'aria-labelledby'),
  undefined,
  'The conclusion section must not duplicate the main landmark name as a nested region',
);

const summaryElements = collectElements(resultSummary);
assert.ok(
  summaryElements.some((element) => (
    getElementName(element) === 'h1'
      && getStaticAttributeValue(element, 'id') === 'result-headline'
  )),
  'The main landmark label must resolve to the visible result conclusion heading',
);

const nestedResultMains = collectElements(resultMain).filter((element) => (
  element !== resultMain && getElementName(element) === 'main'
));
assert.equal(
  nestedResultMains.length,
  0,
  'The evidence workspace must not create a competing nested main landmark',
);

const footerButtons = collectElements(resultFooter).filter((element) => (
  getElementName(element) === 'button'
));

const requiredFooterActions = [
  {
    label: 'prepare English reply',
    matches: (button) => getExpressionIdentifier(button, 'onClick') === 'openReplyDraft',
  },
  {
    label: 'copy action checklist',
    matches: (button) => Boolean(getAttribute(button, 'data-actions-copy-action')),
  },
  {
    label: 'copy result',
    matches: (button) => Boolean(getAttribute(button, 'data-result-copy-action')),
  },
  {
    label: 'edit source',
    matches: (button) => getExpressionIdentifier(button, 'onClick') === 'onEditSource',
  },
  {
    label: 'finish or clear result',
    matches: (button) => getExpressionIdentifier(button, 'onClick') === 'onNewCapture',
  },
];

requiredFooterActions.forEach(({ label, matches }) => {
  assert.ok(
    footerButtons.some(matches),
    `The ${label} action must remain inside the named result main landmark`,
  );
});

console.log('Result conclusion, evidence workspace, and core actions share one named main landmark.');
