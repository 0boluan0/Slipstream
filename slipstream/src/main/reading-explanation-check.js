'use strict';

// Explicit local-preview evaluation. Only these public/authored excerpts are
// sent. A successful run means responses were collected, not judged correct.
const samples = [
  { id: 'root-n', selection: 'root-N consistent estimation',
    source: String.raw`We develop a series of simple results for obtaining root-N consistent estimation, where N
is the sample size, and valid inferential statements about a low-dimensional parameter of
interest, $\theta _ { 0 }$, in the presence of a high-dimensional or "highly complex" nuisance parame-
ter, $\eta _ { 0 }$. The parameter of interest will typically be a causal parameter or treatment effect
parameter, and we consider settings in which the nuisance parameter will be estimated
using machine learning (ML) methods such as random forests, lasso or post-lasso, neu-
ral nets, boosted regression trees, and various hybrids and ensembles of these methods.
These ML methods are able to handle many covariates and provide natural estimators
of nuisance parameters when these parameters are highly complex. Here, highly complex
formally means that the entropy of the parameter space for the nuisance parameter is
increasing with the sample size in a way that moves us outside of the traditional frame-
work considered in the classical semi-parametric literature where the complexity of the
nuisance parameter space is taken to be sufficiently small. Offering a general and simple
procedure for estimating and doing inference on $\theta _ { 0 }$ that is formally valid in these highly
complex settings is the main contribution of this paper.`,
    attribution: { title: 'Double/Debiased Machine Learning', url: 'https://arxiv.org/abs/1608.00060', location: 'Introduction; previously captured OCR' },
    criteria: 'Define a rate in probability; do not equate it with a nondegenerate limit, normality, variance decay, or universal optimality. Preserve the distinction between target and nuisance parameters.' },
  { id: 'evidence-density', selection: 'evidence',
    source: String.raw`2.1 The problem of approximate inference

Let $\mathbf { x } = \boldsymbol { x } _ { 1: n }$ be a set of observed variables and $\mathbf { z } = \boldsymbol { z } _ { 1: m }$ be a set of latent variables, with joint
density $p ( \mathbf { z }, \mathbf { x } )$. We omit constants, such as hyperparameters, from the notation.
The inference problem is to compute the conditional density of the latent variables given the
observations, $p ( \mathbf { z } | \, \mathbf { x } )$. This conditional can be used to produce point or interval estimates of
the latent variables, form predictive densities of new data, and more.
We can write the conditional density as

$$p ( \mathbf z \left| \right. \mathbf x ) = \frac { p ( \mathbf z, \mathbf x ) } { p ( \mathbf x ) } \tag{2}$$.

The denominator contains the marginal density of the observations, also called the evidence.
We calculate it by marginalizing out the latent variables from the joint density,

$$p ( \mathbf { x } ) = \int p ( \mathbf { z }, \mathbf { x } ) \, \mathrm { d } \mathbf { z } \tag{3}$$.

For many models, this evidence integral is unavailable in closed form or requires exponential
time to compute. The evidence is what we need to compute the conditional from the joint;
this is why inference in such models is hard.`,
    attribution: { title: 'Variational Inference: A Review for Statisticians', url: 'https://arxiv.org/abs/1601.00670v9', location: 'Page 5 section 2.1; installed native capture' },
    criteria: 'Evidence is a marginal density, not the probability of the exact continuous observation. At fixed data it is a numerical normalizer constant with respect to latent variables. Do not claim all inference algorithms must explicitly compute it.' },
  { id: 'conditional-expectation', selection: 'conditional expectation',
    source: 'Let Y denote future demand and X the information available today. The conditional expectation E[Y | X] is a random variable determined by X. It differs from the unconditional expectation E[Y], which is a single average over all possible values of X.',
    criteria: 'E[Y|X] is a function of the random variable X and may be constant. Distinguish evaluating it at a fixed X=x, without assuming discrete variables, independence or nonconstant dependence.' },
  { id: 'density-above-one', selection: 'probability density',
    source: String.raw`Let X be uniform on (0, 1/2). Its probability density is f(x)=2 on this interval and zero elsewhere. Probabilities are obtained by integrating f over a set.`,
    criteria: 'Density 2 is valid and does not mean probability 2. Event probabilities are integrals; no positive point mass is introduced.' },
  { id: 'consistency', selection: 'consistent estimator',
    source: String.raw`We require a consistent estimator of the unknown parameter. This statement specifies convergence in probability, without assumptions on convergence of moments.`,
    criteria: 'Consistency is convergence in probability, not unbiasedness, shrinking variance or an automatic central limit theorem.' },
  { id: 'sufficient-condition', selection: 'sufficient condition',
    source: 'Strict convexity is a sufficient condition for uniqueness of a minimizer, provided a minimizer exists. A function may have a unique minimizer without being strictly convex.',
    criteria: 'Sufficiency alone does not imply necessity or non-necessity. In this excerpt strict convexity is explicitly not necessary. Strict convexity alone does not imply existence of a minimizer.' },
  { id: 'confidence-interval', selection: 'confidence interval',
    source: 'A 95% confidence interval is produced by a procedure that covers a fixed unknown parameter in 95% of repeated samples under the assumed model. Once the data are observed, the interval endpoints are fixed.',
    criteria: 'Explain repeated-sample coverage; do not assign a 95% posterior probability to the fixed parameter in the observed interval.' },
];

exports.run = async function run({ processReadingText, settings, report, saveReport }) {
  report.capture = 'Recorded public OCR excerpts and authored comparison cases; no new screenshots or private content.';
  report.repetitions = 3;
  report.cases = [];
  for (let repetition = 1; repetition <= report.repetitions; repetition += 1) {
    for (const sample of samples) {
      const started = Date.now();
      try {
        const result = await processReadingText({ text: sample.source, kind: 'lookup', selection: sample.selection,
          settingsSnapshot: settings, signal: AbortSignal.timeout(60000) });
        report.cases.push({ ...sample, repetition, ...result, elapsedMs: Date.now() - started, semanticStatus: 'needs-review' });
      } catch (error) {
        report.cases.push({ ...sample, repetition, elapsedMs: Date.now() - started,
          failure: { type: error.name, status: Number.isInteger(error.status) ? error.status : null }, semanticStatus: 'unavailable' });
      }
      saveReport();
      console.log(`${report.cases.at(-1).failure ? 'Failed to collect' : 'Collected'} explanation ${sample.id} ${repetition}/${report.repetitions}.`);
    }
  }
  report.completed = true;
  report.failures = report.cases.filter((item) => item.failure).length;
  report.semanticStatus = 'needs-review';
  saveReport();
  console.log('Explanation collection finished. Semantic accuracy still requires comparison with each stated criterion.');
  return report.failures === 0;
};
