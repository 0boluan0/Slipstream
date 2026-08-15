'use strict';

const REQUIRED_DOMAINS = Object.freeze([
  'university',
  'tenancy',
  'medical_appointment',
  'hr',
  'government',
  'billing',
]);

const REQUIRED_TAGS = Object.freeze([
  'no-action',
  'negative-command',
  'conditional-action',
  'multiple-deadlines',
  'quoted-forwarding',
  'ambiguous-date',
]);

const REPLY_ACTION_PATTERN = /(?:\brepl(?:y|ies|ied|ying)\b|\brespond\b|\bwrite\s+back\b|\bconfirm\s+(?:receipt|receiving|that\s+you\s+received)\b|回复|回覆|回信|答复|答覆|回函|確認收(?:到|悉)|确认收(?:到|悉))/iu;
const NEGATED_ACTION_PATTERN = /(?:\bdo\s+not\b|\bdon't\b|\bmust\s+not\b|\bno\s+need\s+to\b|\bnot\s+required\s+to\b|不要|无需|無需|毋须|毋須|禁止|不得)/iu;

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[–—]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

function includesPhrase(value, phrase) {
  const haystack = normalizeText(value);
  const needle = normalizeText(phrase);
  return Boolean(haystack && needle && haystack.includes(needle));
}

function includesAny(value, phrases) {
  return Array.isArray(phrases) && phrases.some((phrase) => includesPhrase(value, phrase));
}

function arrays(value) {
  return Array.isArray(value) ? value : [];
}

function getEvidenceQuotes(item) {
  return arrays(item?.provenance?.evidence)
    .map((evidence) => evidence?.quote)
    .filter((quote) => typeof quote === 'string' && quote.trim());
}

function evidenceMatches(item, expectedQuotes) {
  const expected = arrays(expectedQuotes).map(normalizeText).filter(Boolean);
  if (expected.length === 0) return true;
  return getEvidenceQuotes(item).some((actualQuote) => {
    const actual = normalizeText(actualQuote);
    return expected.some((candidate) => actual.includes(candidate) || candidate.includes(actual));
  });
}

function itemIsSourceGrounded(item, source) {
  const quotes = getEvidenceQuotes(item);
  if (quotes.length === 0) return false;
  const normalizedSource = normalizeText(source);
  return quotes.every((quote) => normalizedSource.includes(normalizeText(quote)));
}

function contentText(brief) {
  const values = [
    brief?.translation?.text,
    brief?.explanation?.text,
  ];
  for (const term of arrays(brief?.terms)) {
    values.push(term?.surface, term?.explanation);
  }
  for (const context of arrays(brief?.contexts)) {
    values.push(
      context?.label,
      context?.explanation,
      context?.whatItIs,
      context?.whyItMatters,
      context?.whatToDo,
    );
  }
  for (const deadline of arrays(brief?.deadlines)) {
    values.push(deadline?.whenText, deadline?.calendarDate, deadline?.normalizedAt, deadline?.condition);
  }
  for (const material of arrays(brief?.materials)) {
    values.push(material?.name, material?.details);
  }
  for (const step of arrays(brief?.nextSteps)) {
    values.push(step?.action);
  }
  return values.filter((value) => typeof value === 'string' && value.trim()).join('\n');
}

function isReplyStep(step) {
  return step?.actor === 'user' && REPLY_ACTION_PATTERN.test(String(step?.action || ''));
}

function actionSemanticsMatch(step, expectedAction) {
  const action = String(step?.action || '');
  if (!action.trim() || NEGATED_ACTION_PATTERN.test(action)) return false;
  if (!includesAny(action, expectedAction.verbAny)) return false;
  if (!includesAny(action, expectedAction.objectAny)) return false;
  if (expectedAction.reply && !isReplyStep(step)) return false;
  return true;
}

function actionMatches(step, expectedAction) {
  if (step?.actor !== (expectedAction.actor || 'user')) return false;
  if (!evidenceMatches(step, expectedAction.evidenceAny)) return false;
  return actionSemanticsMatch(step, expectedAction);
}

function deadlineMatches(deadline, expectedDeadline) {
  return evidenceMatches(deadline, expectedDeadline.evidenceAny);
}

function materialMatches(material, expectedMaterial) {
  if (!evidenceMatches(material, expectedMaterial.evidenceAny)) return false;
  return includesAny(material?.name, expectedMaterial.nameAny);
}

function sameInstant(actual, expected) {
  if (actual === null || expected === null) return actual === expected;
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualMs = Date.parse(actual);
  const expectedMs = Date.parse(expected);
  return Number.isFinite(actualMs) && Number.isFinite(expectedMs) && actualMs === expectedMs;
}

function deadlineCandidateQuality(deadline, expectedDeadline) {
  let quality = 0;
  if (includesAny(deadline?.whenText, expectedDeadline.whenAny)) quality += 4;
  if ((deadline?.calendarDate ?? null) === expectedDeadline.calendarDate) quality += 4;
  if (sameInstant(deadline?.normalizedAt ?? null, expectedDeadline.normalizedAt)) quality += 3;
  if (!expectedDeadline.conditionRequired || (
    typeof deadline?.condition === 'string' && deadline.condition.trim()
  )) quality += 2;
  return quality;
}

function addCheck(checks, {
  code,
  passed,
  message,
  weight = 1,
  critical = true,
}) {
  checks.push({ code, passed: Boolean(passed), message, weight, critical });
}

function hasChineseTranslation(brief) {
  const translation = String(brief?.translation?.text || '');
  const hanCount = (translation.match(/\p{Script=Han}/gu) || []).length;
  const contentCount = (translation.match(/[\p{Letter}\p{Number}]/gu) || []).length;
  return hanCount >= 8 && hanCount / Math.max(contentCount, 1) >= 0.08;
}

function scoreBenchmarkCase({
  testCase,
  brief,
  passThreshold = 0.9,
  requireChineseTranslation = false,
} = {}) {
  if (!testCase || typeof testCase !== 'object') throw new TypeError('testCase must be an object');
  if (!brief || typeof brief !== 'object') throw new TypeError('brief must be an object');
  if (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 1) {
    throw new RangeError('passThreshold must be between 0 and 1');
  }

  const expected = testCase.expected || {};
  const checks = [];
  const userSteps = arrays(brief.nextSteps).filter((step) => step?.actor === 'user');
  const deadlines = arrays(brief.deadlines);
  const materials = arrays(brief.materials);
  const expectedActions = arrays(expected.actions);
  const expectedDeadlines = arrays(expected.deadlines);
  const expectedMaterials = arrays(expected.materials);
  const body = contentText(brief);

  const actionable = expectedActions.length > 0 || expectedDeadlines.length > 0 || expectedMaterials.length > 0;
  const usableStatus = actionable
    ? ['complete', 'partial'].includes(brief.status)
    : !['invalid', 'translation_only'].includes(brief.status);
  addCheck(checks, {
    code: 'brief.usable',
    passed: usableStatus && typeof brief?.translation?.text === 'string' && brief.translation.text.trim(),
    message: 'Brief must contain a usable structured analysis and translation.',
    weight: 3,
  });
  if (requireChineseTranslation) {
    addCheck(checks, {
      code: 'translation.chinese-boundary',
      passed: hasChineseTranslation(brief),
      message: 'Translation output is not substantially Chinese.',
      weight: 6,
    });
  }

  for (const anchor of arrays(expected.anchors)) {
    addCheck(checks, {
      code: `anchor.${anchor.id}`,
      passed: includesAny(body, anchor.anyOf),
      message: `Required semantic anchor was not retained: ${anchor.id}.`,
      weight: 1,
    });
  }

  const matchedDeadlinesByExpectedId = new Map();
  for (const expectedDeadline of expectedDeadlines) {
    const matches = deadlines.filter((deadline) => deadlineMatches(deadline, expectedDeadline));
    matchedDeadlinesByExpectedId.set(expectedDeadline.id, matches);
    const deadline = [...matches].sort((left, right) => (
      deadlineCandidateQuality(right, expectedDeadline)
      - deadlineCandidateQuality(left, expectedDeadline)
    ))[0];
    addCheck(checks, {
      code: `deadline.${expectedDeadline.id}.present`,
      passed: Boolean(deadline),
      message: `Required deadline was not extracted: ${expectedDeadline.id}.`,
      weight: 3,
    });
    if (!deadline) continue;

    addCheck(checks, {
      code: `deadline.${expectedDeadline.id}.wording`,
      passed: includesAny(deadline.whenText, expectedDeadline.whenAny),
      message: `Deadline wording is incorrect: ${expectedDeadline.id}.`,
      weight: 2,
    });
    addCheck(checks, {
      code: `deadline.${expectedDeadline.id}.calendar-date`,
      passed: (deadline.calendarDate ?? null) === expectedDeadline.calendarDate,
      message: `Calendar date is wrong or was invented: ${expectedDeadline.id}.`,
      weight: 4,
    });
    addCheck(checks, {
      code: `deadline.${expectedDeadline.id}.normalized-time`,
      passed: sameInstant(deadline.normalizedAt ?? null, expectedDeadline.normalizedAt),
      message: `Normalized deadline time is wrong or was invented: ${expectedDeadline.id}.`,
      weight: 3,
    });
    if (expectedDeadline.conditionRequired) {
      addCheck(checks, {
        code: `deadline.${expectedDeadline.id}.condition`,
        passed: typeof deadline.condition === 'string' && deadline.condition.trim().length > 0,
        message: `Conditional deadline lost its condition: ${expectedDeadline.id}.`,
        weight: 2,
      });
    }
    if (expectedDeadline.mustRemainUnnormalized) {
      addCheck(checks, {
        code: `deadline.${expectedDeadline.id}.ambiguous`,
        passed: deadline.calendarDate === null && deadline.normalizedAt === null,
        message: `Ambiguous date was converted into an unsupported calendar value: ${expectedDeadline.id}.`,
        weight: 5,
      });
    }
  }

  for (const expectedMaterial of expectedMaterials) {
    const material = materials.find((candidate) => materialMatches(candidate, expectedMaterial));
    addCheck(checks, {
      code: `material.${expectedMaterial.id}.present`,
      passed: Boolean(material),
      message: `Required material was not extracted: ${expectedMaterial.id}.`,
      weight: 3,
    });
    if (!material) continue;
    addCheck(checks, {
      code: `material.${expectedMaterial.id}.requirement`,
      passed: material.requirement === expectedMaterial.requirement,
      message: `Material requirement level is wrong: ${expectedMaterial.id}.`,
      weight: 2,
    });
  }

  for (const expectedAction of expectedActions) {
    const step = userSteps.find((candidate) => actionMatches(candidate, expectedAction));
    addCheck(checks, {
      code: `action.${expectedAction.id}.present`,
      passed: Boolean(step),
      message: `Required user action was not extracted correctly: ${expectedAction.id}.`,
      weight: 4,
    });
    if (!step) continue;

    const mandatoryCorrect = expectedAction.mandatory === true
      ? step.mandatory === true
      : step.mandatory !== true;
    addCheck(checks, {
      code: `action.${expectedAction.id}.mandatory`,
      passed: mandatoryCorrect,
      message: `Action obligation level is wrong: ${expectedAction.id}.`,
      weight: 3,
    });
    addCheck(checks, {
      code: `action.${expectedAction.id}.urgency`,
      passed: step.urgency === expectedAction.urgency,
      message: `Action urgency or conditionality is wrong: ${expectedAction.id}.`,
      weight: 2,
    });

    if (expectedAction.deadlineRef) {
      const linkedDeadlines = matchedDeadlinesByExpectedId.get(expectedAction.deadlineRef) || [];
      addCheck(checks, {
        code: `action.${expectedAction.id}.deadline-link`,
        passed: linkedDeadlines.some((deadline) => deadline?.id === step.deadlineId),
        message: `Action is not linked to its correct deadline: ${expectedAction.id}.`,
        weight: 3,
      });
    } else {
      addCheck(checks, {
        code: `action.${expectedAction.id}.no-deadline`,
        passed: step.deadlineId === null || step.deadlineId === undefined,
        message: `Action received an unsupported deadline: ${expectedAction.id}.`,
        weight: 2,
      });
    }
  }

  const unexpectedSteps = userSteps.filter((step) => (
    !expectedActions.some((expectedAction) => actionMatches(step, expectedAction))
  ));
  const unexpectedDeadlines = deadlines.filter((deadline) => (
    !expectedDeadlines.some((expectedDeadline) => deadlineMatches(deadline, expectedDeadline))
  ));
  const unexpectedMaterials = materials.filter((material) => (
    !expectedMaterials.some((expectedMaterial) => materialMatches(material, expectedMaterial))
  ));
  addCheck(checks, {
    code: 'hallucination.unexpected-actions',
    passed: unexpectedSteps.length === 0,
    message: `${unexpectedSteps.length} unsupported user action(s) were added.`,
    weight: 5,
  });
  addCheck(checks, {
    code: 'hallucination.unexpected-deadlines',
    passed: unexpectedDeadlines.length === 0,
    message: `${unexpectedDeadlines.length} unsupported deadline(s) were added.`,
    weight: 5,
  });
  addCheck(checks, {
    code: 'hallucination.unexpected-materials',
    passed: unexpectedMaterials.length === 0,
    message: `${unexpectedMaterials.length} unsupported material(s) were added.`,
    weight: 4,
  });

  const groundedItems = [...userSteps, ...deadlines, ...materials];
  const unsupportedEvidenceCount = groundedItems.filter((item) => (
    !itemIsSourceGrounded(item, testCase.source)
  )).length;
  addCheck(checks, {
    code: 'hallucination.source-grounding',
    passed: unsupportedEvidenceCount === 0,
    message: `${unsupportedEvidenceCount} structured item(s) lack exact source grounding.`,
    weight: 6,
  });

  const replySteps = userSteps.filter(isReplyStep);
  const replyMode = expected?.reply?.mode || 'not_requested';
  if (replyMode === 'required' || replyMode === 'conditional') {
    const matchingReply = replySteps.find((step) => evidenceMatches(step, expected.reply.evidenceAny));
    const conditionalShapeCorrect = replyMode !== 'conditional' || (
      matchingReply?.mandatory !== true && matchingReply?.urgency === 'when_triggered'
    );
    addCheck(checks, {
      code: `reply.${replyMode}`,
      passed: Boolean(matchingReply) && conditionalShapeCorrect,
      message: replyMode === 'conditional'
        ? 'Conditional reply was omitted or presented as unconditional.'
        : 'Required reply was omitted or changed into another contact method.',
      weight: 6,
    });
  } else {
    addCheck(checks, {
      code: `reply.${replyMode}`,
      passed: replySteps.length === 0,
      message: replyMode === 'prohibited'
        ? 'A reply action was added even though replying is prohibited.'
        : 'A reply action was invented even though none was requested.',
      weight: 6,
    });
  }

  for (const prohibition of arrays(expected.prohibitions)) {
    const violations = userSteps.filter((step) => {
      const action = step?.action || '';
      return includesAny(action, prohibition.verbAny)
        && includesAny(action, prohibition.objectAny)
        && evidenceMatches(step, prohibition.evidenceAny);
    });
    addCheck(checks, {
      code: `prohibition.${prohibition.id}`,
      passed: violations.length === 0,
      message: `A prohibited action was presented as a task: ${prohibition.id}.`,
      weight: 6,
    });
  }

  if (expected.noAction) {
    addCheck(checks, {
      code: 'no-action.preserved',
      passed: userSteps.length === 0 && deadlines.length === 0 && materials.length === 0,
      message: 'An informational notice or forwarded quote was incorrectly turned into work.',
      weight: 8,
    });
  }

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earnedWeight = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = totalWeight === 0 ? 0 : earnedWeight / totalWeight;
  const failures = checks
    .filter((check) => !check.passed)
    .map(({ code, message, critical }) => ({ code, message, critical }));
  const criticalFailure = checks.some((check) => check.critical && !check.passed);

  return {
    caseId: testCase.id,
    domain: testCase.domain,
    pass: score >= passThreshold && !criticalFailure,
    score: Number(score.toFixed(4)),
    earnedWeight,
    totalWeight,
    failures,
    counts: {
      expectedActions: expectedActions.length,
      actualUserActions: userSteps.length,
      expectedDeadlines: expectedDeadlines.length,
      actualDeadlines: deadlines.length,
      expectedMaterials: expectedMaterials.length,
      actualMaterials: materials.length,
    },
  };
}

function summarizeBenchmark(results) {
  const safeResults = arrays(results);
  const passed = safeResults.filter((result) => result?.pass).length;
  const total = safeResults.length;
  const averageScore = total === 0
    ? 0
    : safeResults.reduce((sum, result) => sum + Number(result?.score || 0), 0) / total;
  const failureCodes = {};
  for (const result of safeResults) {
    for (const failure of arrays(result?.failures)) {
      failureCodes[failure.code] = (failureCodes[failure.code] || 0) + 1;
    }
  }
  return {
    pass: total > 0 && passed === total,
    total,
    passed,
    failed: total - passed,
    averageScore: Number(averageScore.toFixed(4)),
    failureCodes,
  };
}

function validateBenchmarkCorpus(corpus) {
  const errors = [];
  if (corpus?.schemaVersion !== 'slipstream.model-quality-benchmark.v1') {
    errors.push('schemaVersion must be slipstream.model-quality-benchmark.v1');
  }
  if (corpus?.metadata?.syntheticOnly !== true) errors.push('metadata.syntheticOnly must be true');
  if (corpus?.metadata?.containsPersonalData !== false) {
    errors.push('metadata.containsPersonalData must be false');
  }
  const cases = arrays(corpus?.cases);
  if (cases.length < 8 || cases.length > 12) errors.push('corpus must contain 8-12 cases');

  const ids = new Set();
  const domains = new Set();
  const tags = new Set();
  for (const testCase of cases) {
    if (typeof testCase?.id !== 'string' || !testCase.id.trim()) {
      errors.push('every case must have an id');
      continue;
    }
    if (ids.has(testCase.id)) errors.push(`duplicate case id: ${testCase.id}`);
    ids.add(testCase.id);
    domains.add(testCase.domain);
    for (const tag of arrays(testCase.tags)) tags.add(tag);

    if (typeof testCase.source !== 'string' || !testCase.source.trim()) {
      errors.push(`${testCase.id}: source must be a non-empty string`);
      continue;
    }
    const expected = testCase.expected;
    if (!expected || typeof expected !== 'object') {
      errors.push(`${testCase.id}: expected must be an object`);
      continue;
    }
    for (const key of ['anchors', 'actions', 'deadlines', 'materials', 'prohibitions']) {
      if (!Array.isArray(expected[key])) errors.push(`${testCase.id}: expected.${key} must be an array`);
    }
    if (!['required', 'conditional', 'prohibited', 'not_requested'].includes(expected?.reply?.mode)) {
      errors.push(`${testCase.id}: expected.reply.mode is invalid`);
    }
    if (typeof expected.noAction !== 'boolean') errors.push(`${testCase.id}: expected.noAction must be boolean`);
    if (expected.noAction && arrays(expected.actions).length > 0) {
      errors.push(`${testCase.id}: no-action case cannot contain expected actions`);
    }

    for (const anchor of arrays(expected.anchors)) {
      if (!anchor?.id || !Array.isArray(anchor?.anyOf) || anchor.anyOf.length === 0) {
        errors.push(`${testCase.id}: malformed anchor`);
      } else if (!anchor.anyOf.some((phrase) => testCase.source.includes(phrase))) {
        errors.push(`${testCase.id}: anchor ${anchor.id} is absent from source`);
      }
    }
    for (const [kind, items] of [
      ['action', arrays(expected.actions)],
      ['deadline', arrays(expected.deadlines)],
      ['material', arrays(expected.materials)],
      ['prohibition', arrays(expected.prohibitions)],
    ]) {
      for (const item of items) {
        if (!item?.id) errors.push(`${testCase.id}: ${kind} is missing id`);
        if (!Array.isArray(item?.evidenceAny)) {
          errors.push(`${testCase.id}: ${kind} ${item?.id || 'unknown'} evidenceAny must be an array`);
          continue;
        }
        for (const quote of item.evidenceAny) {
          if (typeof quote !== 'string' || !testCase.source.includes(quote)) {
            errors.push(`${testCase.id}: ${kind} ${item?.id || 'unknown'} evidence is not exact source text`);
          }
        }
      }
    }
    for (const action of arrays(expected.actions)) {
      if (!Array.isArray(action.verbAny) || action.verbAny.length === 0) {
        errors.push(`${testCase.id}: action ${action.id} verbAny must be a non-empty array`);
      }
      if (!Array.isArray(action.objectAny) || action.objectAny.length === 0) {
        errors.push(`${testCase.id}: action ${action.id} objectAny must be a non-empty array`);
      }
      if (!includesAny(action.goldenAction, action.verbAny)
        || !includesAny(action.goldenAction, action.objectAny)) {
        errors.push(`${testCase.id}: action ${action.id} goldenAction does not satisfy semantic terms`);
      }
    }
    for (const deadline of arrays(expected.deadlines)) {
      if (!Array.isArray(deadline.whenAny) || deadline.whenAny.length === 0) {
        errors.push(`${testCase.id}: deadline ${deadline.id} must have whenAny`);
      }
      if (deadline.calendarDate !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(deadline.calendarDate)) {
        errors.push(`${testCase.id}: deadline ${deadline.id} has invalid calendarDate`);
      }
    }
  }

  for (const domain of REQUIRED_DOMAINS) {
    if (!domains.has(domain)) errors.push(`missing required domain: ${domain}`);
  }
  for (const tag of REQUIRED_TAGS) {
    if (!tags.has(tag)) errors.push(`missing required tag: ${tag}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      cases: cases.length,
      domains: [...domains].sort(),
      tags: [...tags].sort(),
    },
  };
}

module.exports = {
  actionSemanticsMatch,
  contentText,
  evidenceMatches,
  getEvidenceQuotes,
  isReplyStep,
  itemIsSourceGrounded,
  hasChineseTranslation,
  normalizeText,
  scoreBenchmarkCase,
  summarizeBenchmark,
  validateBenchmarkCorpus,
};
