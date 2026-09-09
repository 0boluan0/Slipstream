'use strict';

// Explicit preview-only evaluation. All excerpts are authored fixtures, never
// screen content. Responses stay in the selected local evidence directory.
const samples = [
  { id: 'academic-transition', source: 'The next section describes the results. We then discuss the main findings and suggest topics for future research.', empty: true },
  { id: 'ordinary-procedure', source: 'We asked each participant to read the instructions and answer three questions. The questionnaire took about ten minutes to complete.', empty: true },
  { id: 'everyday-senses', source: 'The room returned to its normal temperature once the power was restored. We opened the windows and continued the meeting.', empty: true },
  { id: 'plain-description', source: 'Sales increased last year. We expect future demand to rise, so the company plans to open two more shops.', empty: true },
  { id: 'conditional-expectation', source: 'Let Y denote future demand and X the information available today. The conditional expectation E[Y | X] is a random variable determined by X. It differs from the unconditional expectation E[Y], which is a single average over all possible values of X.',
    required: 'conditional expectation', excluded: ['future demand', 'information', 'average'] },
  { id: 'technical-power', source: 'Increasing the sample size can improve statistical power, the probability of rejecting the null hypothesis when it is false.', required: 'statistical power' },
  { id: 'estimation', source: 'The maximum likelihood estimator need not be unbiased in finite samples. Its consistency requires suitable regularity conditions and identifiability.', required: 'maximum likelihood estimator' },
  { id: 'technical-normal', source: 'A normal subgroup is invariant under conjugation; this condition allows the quotient group to be defined.', required: 'normal subgroup' },
  { id: 'confounding', source: 'A confounder is a variable that influences both a treatment and an outcome. An association between treatment and outcome may therefore persist even when the treatment has no causal effect.',
    required: 'confounder', excluded: ['treatment', 'outcome', 'variable'] },
  { id: 'collider', source: 'A collider is a variable that is influenced by both an exposure and an outcome. Conditioning on a collider can introduce selection bias even when the exposure has no causal effect.',
    required: 'collider', excluded: ['exposure', 'outcome', 'variable'] },
  { id: 'mediation', source: 'A mediator transmits part of the effect of a treatment on an outcome. The indirect effect operates through the mediator, while the direct effect follows other paths.',
    required: 'mediator', excluded: ['treatment', 'outcome'] },
];

exports.run = async function run({ processReadingText, settings, report, saveReport }) {
  report.capture = 'No screenshots. Only the authored term-selection excerpts below are submitted.';
  report.repetitions = 3;
  report.cases = [];
  for (let repetition = 1; repetition <= report.repetitions; repetition += 1) {
    for (const sample of samples) {
      const started = Date.now();
      const result = await processReadingText({ text: sample.source, withTerms: true, settingsSnapshot: settings, signal: AbortSignal.timeout(60000) });
      const quotes = result.terms.map((term) => term.quote.toLowerCase());
      const anchored = result.terms.every((term) => sample.source.slice(term.start, term.end) === term.quote
        && !/[\p{L}\p{N}_-]$/u.test(sample.source.slice(0, term.start))
        && !/^[\p{L}\p{N}_-]/u.test(sample.source.slice(term.end)));
      const passed = anchored && (sample.empty ? quotes.length === 0
        : quotes.includes(sample.required) && !(sample.excluded || []).some((term) => quotes.includes(term)));
      report.cases.push({ ...sample, repetition, ...result, elapsedMs: Date.now() - started, passed });
      saveReport();
      console.log(`Term selection ${sample.id} ${repetition}/${report.repetitions}: ${passed ? 'pass' : 'review'} (${quotes.length} suggestions).`);
    }
  }
  report.summary = {
    total: report.cases.length,
    passed: report.cases.filter((item) => item.passed).length,
    emptyCases: report.cases.filter((item) => item.empty).length,
    correctEmpty: report.cases.filter((item) => item.empty && item.passed).length,
  };
  report.completed = true;
  report.passed = report.summary.passed === report.summary.total;
  saveReport();
  return report.passed;
};
