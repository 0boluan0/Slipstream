import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeDeadlineUrgency,
  getDeadlineDateOrdinal,
  millisecondsUntilNextLocalDay,
} from '../src/renderer/utils/deadlineUrgency.mjs';
import {
  getHeadline,
  selectPrimaryDeadline,
} from '../src/renderer/utils/evidenceMapping.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const resultSource = fs.readFileSync(path.join(root, 'src/renderer/components/ResultDisplay.jsx'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'src/renderer/App.css'), 'utf8');

const localNoon = (year, monthIndex, day) => new Date(year, monthIndex, day, 12, 0, 0, 0);
const deadline = (calendarDate) => ({ calendarDate, normalizedAt: null });
const today = localNoon(2026, 6, 27);

assert.deepEqual(describeDeadlineUrgency(deadline('2026-07-27'), today), {
  tone: 'today',
  label: '今天截止',
  daysRemaining: 0,
});
assert.equal(describeDeadlineUrgency(deadline('2026-07-28'), today)?.label, '明天截止');
assert.equal(describeDeadlineUrgency(deadline('2026-08-01'), today)?.label, '还剩 5 天');
assert.equal(describeDeadlineUrgency(deadline('2026-08-10'), today)?.label, '还有 14 天');
assert.equal(describeDeadlineUrgency(deadline('2026-07-25'), today)?.label, '已逾期 2 天');

assert.equal(describeDeadlineUrgency(deadline('2026-02-30'), today), null);
assert.equal(describeDeadlineUrgency({ calendarDate: null, normalizedAt: null }, today), null);
assert.equal(describeDeadlineUrgency({ calendarDate: 'July 28', normalizedAt: null }, today), null);

const localTomorrowInstant = localNoon(2026, 6, 28).toISOString();
assert.equal(
  describeDeadlineUrgency({ normalizedAt: localTomorrowInstant }, today)?.label,
  '明天截止',
  'a trustworthy full instant should provide a local-calendar fallback',
);

const almostMidnight = new Date(2026, 6, 27, 23, 59, 59, 500);
assert.equal(millisecondsUntilNextLocalDay(almostMidnight), 1_500);

const multiDeadlineSource = [
  'Submit all materials by 28 July 2026.',
  'Generate the share code by 27 July 2026.',
  'The university will review the file by 26 July 2026.',
].join('\n');
const grounded = (quote) => {
  const start = multiDeadlineSource.indexOf(quote);
  return {
    kind: 'original',
    evidence: [{ quote, start, end: start + quote.length }],
    citations: [],
  };
};
const lateQuote = 'Submit all materials by 28 July 2026.';
const earlyQuote = 'Generate the share code by 27 July 2026.';
const institutionQuote = 'The university will review the file by 26 July 2026.';
const multiDeadlineBrief = {
  deadlines: [
    { id: 'late', whenText: '2026 年 7 月 28 日', calendarDate: '2026-07-28', provenance: grounded(lateQuote) },
    { id: 'early', whenText: '2026 年 7 月 27 日', calendarDate: '2026-07-27', provenance: grounded(earlyQuote) },
    { id: 'institution', whenText: '2026 年 7 月 26 日', calendarDate: '2026-07-26', provenance: grounded(institutionQuote) },
  ],
  nextSteps: [
    { id: 'submit', action: '在 2026 年 7 月 28 日前提交材料', actor: 'user', mandatory: true, deadlineId: 'late', urgency: 'before_deadline', provenance: grounded(lateQuote) },
    { id: 'generate', action: '在 2026 年 7 月 27 日前生成 share code', actor: 'user', mandatory: true, deadlineId: 'early', urgency: 'before_deadline', provenance: grounded(earlyQuote) },
    { id: 'review', action: '学校审核材料', actor: 'institution', mandatory: true, deadlineId: 'institution', urgency: 'before_deadline', provenance: grounded(institutionQuote) },
  ],
};

const selectedDeadline = selectPrimaryDeadline(multiDeadlineBrief, multiDeadlineSource);
assert.equal(selectedDeadline.deadline.id, 'early');
assert.equal(selectedDeadline.totalCount, 3);
assert.equal(selectedDeadline.selectionMode, 'earliest');
assert.equal(getHeadline(multiDeadlineBrief, multiDeadlineSource), '在 2026 年 7 月 27 日前生成 share code');
assert(getDeadlineDateOrdinal(multiDeadlineBrief.deadlines[1]) < getDeadlineDateOrdinal(multiDeadlineBrief.deadlines[0]));

const actionPrioritySelection = selectPrimaryDeadline({
  deadlines: [multiDeadlineBrief.deadlines[0], multiDeadlineBrief.deadlines[2]],
  nextSteps: [multiDeadlineBrief.nextSteps[0], multiDeadlineBrief.nextSteps[2]],
}, multiDeadlineSource);
assert.equal(actionPrioritySelection.deadline.id, 'late', 'a user-required deadline must outrank an earlier institution-only date');
assert.equal(actionPrioritySelection.selectionMode, 'action_priority');

const incomparableSource = 'Respond within ten working days.\nUpload by 30 July 2026.';
const incomparableProvenance = (quote) => {
  const start = incomparableSource.indexOf(quote);
  return { kind: 'original', evidence: [{ quote, start, end: start + quote.length }], citations: [] };
};
const incomparableBrief = {
  deadlines: [
    { id: 'relative', whenText: '十个工作日内', calendarDate: null, normalizedAt: null, provenance: incomparableProvenance('Respond within ten working days.') },
    { id: 'dated', whenText: '2026 年 7 月 30 日', calendarDate: '2026-07-30', normalizedAt: null, provenance: incomparableProvenance('Upload by 30 July 2026.') },
  ],
  nextSteps: [
    { id: 'respond', action: '十个工作日内回复', actor: 'user', mandatory: true, deadlineId: 'relative', provenance: incomparableProvenance('Respond within ten working days.') },
    { id: 'upload', action: '在 7 月 30 日前上传', actor: 'user', mandatory: true, deadlineId: 'dated', provenance: incomparableProvenance('Upload by 30 July 2026.') },
  ],
};
const incomparableSelection = selectPrimaryDeadline(incomparableBrief, incomparableSource);
assert.equal(incomparableSelection.deadline.id, 'relative', 'incomparable deadlines must preserve source order');
assert.equal(incomparableSelection.selectionMode, 'source_order');

assert.match(resultSource, /describeDeadlineUrgency\(deadline, deadlineReferenceNow\)/);
assert.match(resultSource, /deadlineUrgency && <strong>\{deadlineUrgency\.label\}<\/strong>/);
assert.match(
  resultSource,
  /<span lang=\{getContentLanguageTag\(deadline\.whenText, sourceLanguage\)\}>\{deadline\.whenText\}<\/span>/,
  'the exact source deadline must retain its language boundary inside the visible accessible name',
);
assert.match(
  resultSource,
  /deadlineSelection\.totalCount > 1 && <span>\{` · 共 \$\{deadlineSelection\.totalCount\} 项`}<\/span>/,
  'the deadline summary must continue naming the total deadline count',
);
assert.match(resultSource, /millisecondsUntilNextLocalDay/);
assert.match(resultSource, /selectPrimaryDeadline\(normalizedBrief, sourceText\)/);
assert.match(resultSource, /onClick=\{openDeadlineDetails\}/);
assert.match(
  resultSource,
  /const openDeadlineDetails = useCallback\(\(\) => \{\s*setMobilePane\('action'\);\s*setOpenSections/,
  'the always-visible deadline action must restore the action pane before focusing its disclosure',
);
assert.match(resultSource, /顶部优先提醒/);
assert.match(resultSource, /查看全部截止日期/);
assert.match(appCss, /deadline-summary--overdue/);
assert.match(appCss, /deadline-summary--soon/);
assert.doesNotMatch(appCss, /\.summary-meta \{ display: none; \}/);
assert.match(appCss, /\.summary-meta \{ display: flex; flex-wrap: wrap; width: 100%; \}/);

console.log('deadline urgency checks passed');
