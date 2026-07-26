import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EVIDENCE_COLORS,
  buildReplyDraft,
  composeActionChecklistText,
  composeCompleteResultText,
  getEvidenceNavigationAnnouncement,
  isTranslationOnlyBrief,
  shouldOfferReply,
} from '../src/renderer/utils/evidenceMapping.mjs';
import {
  getProcessingConfigSignature,
  isProcessingConfigGenerationCurrent,
  PRESERVED_RESULT_CONFIG_CHANGED_WARNING,
  resolveSnapshotWarning,
  shouldRestoreLastGoodAfterConfigChange,
  withVerificationApproval,
} from '../src/renderer/utils/processingConfig.mjs';
import {
  completeTaskForGeneration,
  createRequestCoordinator,
} from '../src/renderer/hooks/requestCoordinator.mjs';

function provenance(quote = null) {
  return {
    kind: quote ? 'original' : 'pending',
    confidence: quote ? 0.99 : null,
    note: null,
    evidence: quote ? [{ quote, start: 0, end: quote.length, match: 'exact', ambiguous: false }] : [],
    citations: [],
  };
}

function briefWith(overrides = {}) {
  return {
    status: 'complete',
    translation: { text: '请提交材料并回复邮件。', provenance: provenance() },
    explanation: null,
    terms: [],
    contexts: [],
    deadlines: [],
    materials: [],
    nextSteps: [],
    verifications: [],
    warnings: [],
    ...overrides,
  };
}

{
  const basicSettings = {
    activeBackend: 'free_translate',
    activeModel: 'google',
    hasAnthropicApiKey: false,
    hasOpenaiApiKey: false,
    hasDeepseekApiKey: false,
    ollamaBaseUrl: 'http://localhost:11434',
    customEndpointUrl: '',
    hasCustomEndpointApiKey: false,
    customPrompt: '',
    verificationPolicy: 'ask',
  };
  const ollamaSettings = {
    ...basicSettings,
    activeBackend: 'ollama',
    activeModel: 'gpt-oss:20b',
  };
  const basicSignature = getProcessingConfigSignature(basicSettings);
  const ollamaSignature = getProcessingConfigSignature(ollamaSettings);
  const snapshot = { processingConfigSignature: basicSignature, warning: '' };

  assert.equal(resolveSnapshotWarning(snapshot, basicSignature), '');
  assert.equal(
    resolveSnapshotWarning(snapshot, ollamaSignature),
    PRESERVED_RESULT_CONFIG_CHANGED_WARNING,
  );
  assert.equal(
    resolveSnapshotWarning(snapshot, ollamaSignature, 'Ollama failed.'),
    `${PRESERVED_RESULT_CONFIG_CHANGED_WARNING} Ollama failed.`,
  );
  // A basic result remains current after A → B → A. A monotonic settings
  // revision may trigger reconciliation, but must not make this result stale.
  assert.equal(resolveSnapshotWarning(snapshot, getProcessingConfigSignature({ ...basicSettings })), '');
  assert.notEqual(
    basicSignature,
    getProcessingConfigSignature({ ...basicSettings, customPrompt: 'Different prompt' }),
  );
  assert.notEqual(
    basicSignature,
    getProcessingConfigSignature({ ...basicSettings, verificationPolicy: 'local-only' }),
  );
  assert.equal(shouldRestoreLastGoodAfterConfigChange({ retryOfLastGood: true }, snapshot), true);
  assert.equal(shouldRestoreLastGoodAfterConfigChange({ retryOfLastGood: false }, snapshot), false);
  assert.equal(shouldRestoreLastGoodAfterConfigChange({ retryOfLastGood: true }, null), false);
  assert.equal(
    withVerificationApproval({ ...snapshot, verificationApprovalId: 'dead-token' }, null).verificationApprovalId,
    null,
  );
}

{
  assert.equal(isProcessingConfigGenerationCurrent(7, 7), true);
  assert.equal(isProcessingConfigGenerationCurrent(7, 8), false);

  // Interleaving regression: a settings update can advance the synchronous
  // generation while an IPC response is resolving, before React runs effects.
  // Invalidating before complete makes that old response ineligible to apply.
  const coordinator = createRequestCoordinator();
  const task = coordinator.schedule({ source: 'generation-race' });
  const requestGeneration = 7;
  const currentGeneration = 8;
  if (!isProcessingConfigGenerationCurrent(requestGeneration, currentGeneration)) {
    coordinator.invalidate();
  }
  assert.deepEqual(coordinator.complete(task), { apply: false, next: null });
}

{
  const configSignatures = new Map([
    [10, 'config-a'],
    [11, 'config-b'],
    [12, 'config-c'],
  ]);

  const createConfigRace = ({ retryOfLastGood, hasLastGood }) => {
    const coordinator = createRequestCoordinator();
    const task = coordinator.schedule({ options: { retryOfLastGood } });
    const lastGood = hasLastGood
      ? { processingConfigSignature: configSignatures.get(10), warning: '' }
      : null;
    let liveGeneration = 11;
    let status = 'processing';
    let warning = null;
    let warningWrittenByGeneration = null;
    let invocationRejected = false;
    let activeProcessing = {
      taskId: task.id,
      retryOfLastGood,
      configGeneration: 10,
    };
    let resolveInvocation;
    let rejectInvocation;
    const invocation = new Promise((resolve, reject) => {
      resolveInvocation = resolve;
      rejectInvocation = reject;
    });

    const restoreForGeneration = (generation) => {
      if (!lastGood) return false;
      status = 'done';
      warning = resolveSnapshotWarning(lastGood, configSignatures.get(generation));
      warningWrittenByGeneration = generation;
      return true;
    };

    const completion = (async () => {
      try {
        await invocation;
      } catch {
        invocationRejected = true;
      }
      const completionOwnsActiveProcessing = activeProcessing?.taskId === task.id;
      const completionResult = completeTaskForGeneration(coordinator, task, {
        generationIsCurrent: isProcessingConfigGenerationCurrent(10, liveGeneration),
        restoreLastGoodIfStale: completionOwnsActiveProcessing
          && shouldRestoreLastGoodAfterConfigChange(task.payload.options, lastGood),
      });
      if (!completionResult.next
        && completionOwnsActiveProcessing
        && !completionResult.restoreLastGood) {
        activeProcessing = null;
      }
      if (completionResult.restoreLastGood) restoreForGeneration(10);
      return completionResult;
    })();

    const runConfigEffect = ({
      generation,
      closureStatus,
    }) => {
      if (!isProcessingConfigGenerationCurrent(generation, liveGeneration)) return 'obsolete';
      if (closureStatus === 'processing') {
        const activeAtEffect = activeProcessing;
        if (activeAtEffect?.configGeneration === generation) return 'current-generation-task';
        const restoreRetry = shouldRestoreLastGoodAfterConfigChange(
          activeAtEffect,
          lastGood,
        );
        coordinator.invalidate();
        activeProcessing = null;
        if (restoreRetry && restoreForGeneration(generation)) return 'restored';
        status = 'idle';
        return 'idle';
      }
      if (closureStatus === 'done' && lastGood) {
        if (activeProcessing && activeProcessing.configGeneration !== generation) {
          activeProcessing = null;
        }
        warning = resolveSnapshotWarning(lastGood, configSignatures.get(generation));
        warningWrittenByGeneration = generation;
        return 'updated-warning';
      }
      return 'unchanged';
    };

    return {
      task,
      complete(outcome) {
        if (outcome === 'rejected') rejectInvocation(new Error('provider rejected'));
        else resolveInvocation({ success: false });
        return completion;
      },
      runConfigEffect,
      setLiveGeneration(generation) {
        liveGeneration = generation;
      },
      startNewTask(taskId, configGeneration = liveGeneration) {
        activeProcessing = { taskId, retryOfLastGood: true, configGeneration };
        status = 'processing';
      },
      state() {
        return {
          activeTaskId: activeProcessing?.taskId ?? null,
          invocationRejected,
          status,
          warning,
          warningWrittenByGeneration,
        };
      },
    };
  };

  for (const outcome of ['resolved', 'rejected']) {
    const completionFirst = createConfigRace({ retryOfLastGood: true, hasLastGood: true });
    await completionFirst.complete(outcome);
    assert.deepEqual(completionFirst.state(), {
      activeTaskId: completionFirst.task.id,
      invocationRejected: outcome === 'rejected',
      status: 'done',
      warning: '',
      warningWrittenByGeneration: 10,
    });
    completionFirst.runConfigEffect({
      generation: 11,
      closureStatus: 'processing',
      taskId: completionFirst.task.id,
    });
    assert.deepEqual(completionFirst.state(), {
      activeTaskId: null,
      invocationRejected: outcome === 'rejected',
      status: 'done',
      warning: PRESERVED_RESULT_CONFIG_CHANGED_WARNING,
      warningWrittenByGeneration: 11,
    }, `completion-first (${outcome}) must finish with the latest effect restoration`);

    const effectFirst = createConfigRace({ retryOfLastGood: true, hasLastGood: true });
    effectFirst.runConfigEffect({
      generation: 11,
      closureStatus: 'processing',
      taskId: effectFirst.task.id,
    });
    const effectFirstBeforeCompletion = effectFirst.state();
    await effectFirst.complete(outcome);
    assert.deepEqual(effectFirst.state(), {
      ...effectFirstBeforeCompletion,
      invocationRejected: outcome === 'rejected',
    }, `effect-first (${outcome}) must not be overwritten by the old completion closure`);
  }

  for (const options of [
    { retryOfLastGood: false, hasLastGood: true },
    { retryOfLastGood: true, hasLastGood: false },
  ]) {
    for (const order of ['completion-first', 'effect-first']) {
      const race = createConfigRace(options);
      if (order === 'completion-first') await race.complete('resolved');
      race.runConfigEffect({
        generation: 11,
        closureStatus: 'processing',
        taskId: race.task.id,
      });
      if (order === 'effect-first') await race.complete('resolved');
      assert.equal(race.state().status, 'idle',
        `${order} must fall back to IDLE when restoration is ineligible`);
      assert.equal(race.state().warningWrittenByGeneration, null,
        `${order} must not invent a last-good restoration`);
    }
  }

  const completionThenNewerGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  await completionThenNewerGeneration.complete('resolved');
  completionThenNewerGeneration.setLiveGeneration(12);
  assert.equal(completionThenNewerGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: completionThenNewerGeneration.task.id,
  }), 'obsolete');
  assert.equal(completionThenNewerGeneration.state().warningWrittenByGeneration, 10,
    'an obsolete effect must not consume or rewrite newer reconciliation state');
  completionThenNewerGeneration.runConfigEffect({
    generation: 12,
    closureStatus: 'done',
    taskId: completionThenNewerGeneration.task.id,
  });
  assert.equal(completionThenNewerGeneration.state().warningWrittenByGeneration, 12);
  assert.equal(completionThenNewerGeneration.state().activeTaskId, null);

  const effectThenNewerGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  effectThenNewerGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: effectThenNewerGeneration.task.id,
  });
  effectThenNewerGeneration.setLiveGeneration(12);
  await effectThenNewerGeneration.complete('rejected');
  assert.equal(effectThenNewerGeneration.state().warningWrittenByGeneration, 11,
    'a later stale completion must not replay its old closure after effect-first restoration');
  effectThenNewerGeneration.runConfigEffect({
    generation: 12,
    closureStatus: 'done',
    taskId: null,
  });
  assert.equal(effectThenNewerGeneration.state().warningWrittenByGeneration, 12);

  const newerTaskSameGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  await newerTaskSameGeneration.complete('resolved');
  newerTaskSameGeneration.startNewTask(999);
  assert.equal(newerTaskSameGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: newerTaskSameGeneration.task.id,
  }), 'current-generation-task');
  assert.equal(newerTaskSameGeneration.state().status, 'processing');
  assert.equal(newerTaskSameGeneration.state().activeTaskId, 999,
    'an old same-generation effect must not cancel or restore over a newer task');

  const lateCompletionAfterNewTask = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  lateCompletionAfterNewTask.startNewTask(1001, 11);
  await lateCompletionAfterNewTask.complete('rejected');
  assert.equal(lateCompletionAfterNewTask.state().status, 'processing');
  assert.equal(lateCompletionAfterNewTask.state().activeTaskId, 1001);
  assert.equal(lateCompletionAfterNewTask.state().warningWrittenByGeneration, null,
    'task 1 completion must not restore after task 2 owns the processing intent');

  const pendingIntentSameGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  pendingIntentSameGeneration.startNewTask(null, 11);
  assert.equal(pendingIntentSameGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
    taskId: pendingIntentSameGeneration.task.id,
  }), 'current-generation-task',
  'a queued current-generation intent must be protected before it has a task id');
  assert.equal(pendingIntentSameGeneration.state().status, 'processing');

  const pendingIntentOldGeneration = createConfigRace({
    retryOfLastGood: true,
    hasLastGood: true,
  });
  pendingIntentOldGeneration.startNewTask(null, 10);
  assert.equal(pendingIntentOldGeneration.runConfigEffect({
    generation: 11,
    closureStatus: 'processing',
  }), 'restored',
  'the latest effect must cancel and reconcile an intent still bound to the old generation');
  assert.equal(pendingIntentOldGeneration.state().status, 'done');
  assert.equal(pendingIntentOldGeneration.state().activeTaskId, null);

  const pendingCoordinator = createRequestCoordinator();
  const oldTask = pendingCoordinator.schedule({
    options: { retryOfLastGood: true },
    configGeneration: 10,
  });
  assert.equal(pendingCoordinator.schedule({
    options: { retryOfLastGood: true },
    configGeneration: 11,
  }), null);
  const currentGenerationIntent = { taskId: null, configGeneration: 11 };
  assert.equal(currentGenerationIntent.configGeneration, 11,
    'the queued intent must identify itself as already using the effect generation');
  const staleOldCompletion = completeTaskForGeneration(pendingCoordinator, oldTask, {
    generationIsCurrent: false,
    restoreLastGoodIfStale: false,
  });
  assert.equal(staleOldCompletion.apply, false);
  assert.equal(staleOldCompletion.next.payload.configGeneration, 11,
    'suppressing a stale active task must preserve its newer queued task');
  assert.deepEqual(
    completeTaskForGeneration(pendingCoordinator, staleOldCompletion.next, {
      generationIsCurrent: true,
      restoreLastGoodIfStale: false,
    }),
    {
      apply: true,
      next: null,
      stale: false,
      restoreLastGood: false,
    },
    'the preserved current-generation task must still be eligible to apply',
  );
}

{
  const translationOnly = briefWith({
    status: 'translation_only',
    translation: { text: '这是一封只完成了翻译的邮件。', provenance: provenance() },
    // A defensive renderer must ignore contradictory structured arrays whenever
    // the canonical result status says no structured analysis was produced.
    deadlines: [{ id: 'stale-date', whenText: 'Friday', condition: 'stale', provenance: provenance() }],
    materials: [{ id: 'stale-material', name: 'stale passport', requirement: 'required', details: null, provenance: provenance() }],
    nextSteps: [{ id: 'stale-step', action: 'stale action', deadlineId: 'stale-date', provenance: provenance() }],
    warnings: [{ code: 'SOURCE_TRUNCATED', message: '原文过长，后半部分未进入本次翻译。' }],
  });

  assert.equal(isTranslationOnlyBrief(translationOnly), true);
  const copied = composeCompleteResultText(translationOnly, { additionalWarnings: ['截图文字可能不完整。'] });
  assert.match(copied, /完整翻译\n这是一封只完成了翻译的邮件。/);
  assert.match(copied, /本次仅完成翻译/);
  assert.match(copied, /原文过长，后半部分未进入本次翻译/);
  assert.match(copied, /截图文字可能不完整/);
  assert.doesNotMatch(copied, /stale action|stale passport|Friday|\n行动路径\n|\n材料清单\n|\n截止日期\n/);
}

{
  const brief = briefWith({
    deadlines: [
      {
        id: 'deadline-1',
        whenText: 'Monday, 28 July 2026',
        normalizedAt: '2026-07-28T17:00:00+01:00',
        timezone: 'Europe/London',
        condition: 'All items must be received by this date.',
        provenance: provenance(),
      },
      {
        id: 'deadline-2',
        whenText: 'within 10 working days',
        normalizedAt: null,
        timezone: null,
        condition: 'Appeals use this separate deadline.',
        provenance: provenance(),
      },
    ],
    materials: [
      {
        id: 'material-passport',
        name: '护照信息页扫描件',
        requirement: 'required',
        details: '必须清晰可读',
        provenance: provenance('A clear scan of your passport information page.'),
      },
    ],
    nextSteps: [
      {
        id: 'step-submit',
        action: '提交身份证明材料',
        actor: 'user',
        urgency: 'before_deadline',
        mandatory: true,
        deadlineId: 'deadline-1',
        provenance: provenance('Please submit the required identity documents.'),
      },
      {
        id: 'step-reply',
        action: '回复邮件，确认材料已经提交',
        actor: 'user',
        urgency: 'when_triggered',
        mandatory: true,
        deadlineId: null,
        provenance: provenance('Please reply to confirm that you have submitted the documents.'),
      },
    ],
    warnings: [{ code: 'ARRAY_TRUNCATED', message: '部分行动项超过上限，结果已截断。' }],
  });

  const actions = composeActionChecklistText(brief, { additionalWarnings: ['OCR 置信度较低，请核对原文。'] });
  assert.match(actions, /1\. 提交身份证明材料/);
  assert.match(actions, /关联截止：Monday, 28 July 2026/);
  assert.match(actions, /2026-07-28T17:00:00\+01:00/);
  assert.match(actions, /Europe\/London/);
  assert.match(actions, /护照信息页扫描件（必需；必须清晰可读）/);
  assert.match(actions, /within 10 working days/);
  assert.match(actions, /部分行动项超过上限，结果已截断/);
  assert.match(actions, /OCR 置信度较低，请核对原文/);

  const complete = composeCompleteResultText(brief, { additionalWarnings: ['OCR 置信度较低，请核对原文。'] });
  for (const criticalText of [
    'Monday, 28 July 2026',
    'within 10 working days',
    '护照信息页扫描件',
    '部分行动项超过上限，结果已截断',
    'OCR 置信度较低，请核对原文',
  ]) {
    assert.ok(complete.includes(criticalText), `complete copy omitted: ${criticalText}`);
  }

  assert.equal(shouldOfferReply(brief), true);
  const draft = buildReplyDraft(brief);
  assert.equal(draft.mode, 'template');
  assert.match(draft.title, /模板/);
  assert.match(draft.text, /A clear scan of your passport information page\./);
  assert.match(draft.text, /Monday, 28 July 2026/);
  assert.match(draft.text, /Please reply to confirm that you have submitted the documents\./);
  assert.match(draft.text, /\[Write only what is true/);
  assert.doesNotMatch(draft.text, /I have (?:submitted|attached|completed)/i);
  assert.ok(draft.facts.length >= 3, 'the editable template must expose its source-backed inputs');
}

{
  const negativeReply = briefWith({
    nextSteps: [{
      id: 'step-no-reply',
      action: '无需回复这封邮件',
      actor: 'user',
      mandatory: true,
      deadlineId: null,
      provenance: provenance('You do not need to reply to this email.'),
    }],
  });
  assert.equal(shouldOfferReply(negativeReply), false);
  assert.equal(buildReplyDraft(negativeReply).mode, 'unavailable');
}

for (const action of ['回复不是必须的', 'A reply is not required']) {
  const explicitlyOptional = briefWith({
    nextSteps: [{
      id: `step-optional-${action}`,
      action,
      actor: 'user',
      mandatory: true,
      deadlineId: null,
      provenance: provenance(action),
    }],
  });
  assert.equal(shouldOfferReply(explicitlyOptional), false, `optional reply was misclassified: ${action}`);
}

{
  const institutionReply = briefWith({
    nextSteps: [{
      id: 'step-institution-reply',
      action: '学校将在五个工作日内回复',
      actor: 'institution',
      mandatory: true,
      deadlineId: null,
      provenance: provenance('The university will reply within five working days.'),
    }],
  });
  assert.equal(shouldOfferReply(institutionReply), false);
}

{
  const verifiedSource = briefWith({
    verifications: [{
      id: 'verification-verified',
      claim: '官方流程说明',
      reason: '需要官方来源',
      status: 'verified',
      lookup: null,
      retrievals: [{
        id: 'receipt-1',
        publisher: 'GOV.UK',
        url: 'https://www.gov.uk/example',
        retrievedAt: '2026-07-23T09:00:00.000Z',
        excerpt: 'Official guidance.',
        official: true,
      }],
      provenance: provenance(),
    }],
  });
  const copied = composeCompleteResultText(verifiedSource);
  assert.match(copied, /官方流程说明：已核验/);
  assert.match(copied, /用于已核验结论的官方页面/);
  assert.match(copied, /2026-07-23T09:00:00\.000Z/);
  assert.doesNotMatch(copied, /已找到页面，结论仍需确认：GOV\.UK/);
}

function contrastAgainstWhite(hex) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4));
  const luminance = (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
  return 1.05 / (luminance + 0.05);
}

for (const color of EVIDENCE_COLORS) {
  assert.ok(contrastAgainstWhite(color.solid) >= 4.5, `${color.solid} is too light for white badge text`);
}

{
  assert.equal(
    getEvidenceNavigationAnnouncement({ id: 3, quote: 'eVisa share code' }, 'result', 'term'),
    '已定位到结果中的词语解释：证据 3，eVisa share code',
  );
  assert.equal(
    getEvidenceNavigationAnnouncement({ id: 3, quote: 'eVisa share code' }, 'source', null),
    '已定位到原文证据 3：eVisa share code',
  );
}

{
  const componentPath = new URL('../src/renderer/components/ResultDisplay.jsx', import.meta.url);
  const componentSource = await readFile(componentPath, 'utf8');
  assert.match(componentSource, /onConfigureAnalysis/);
  assert.match(componentSource, /配置智能分析/);
  assert.match(componentSource, /aria-live="polite"/);
  assert.match(componentSource, /aria-controls=/);
  assert.match(componentSource, /target\?\.focus\(/);
  assert.match(componentSource, /if \(!active\) return undefined;[\s\S]*headlineRef\.current\?\.focus/,
    'returning from settings must restore focus to the preserved result headline');
  assert.match(componentSource, /isTranslationOnly \? \(/);
  assert.match(componentSource, /completionStages\.map/);
  assert.match(componentSource, /\['pending', 'retrieved', 'failed'\]\.includes/);
  assert.match(componentSource, /receipt\.verificationStatus === 'verified'/);
  assert.match(componentSource, /检索时间/);
  assert.match(componentSource, /useState\('action'\)/,
    'the mobile result should open on the pane selected by the action/translation preference');
  assert.match(componentSource, /className="translation-detail" style=\{\{ order: preference === 'translation' \? 1 : 2 \}\}/,
    'translation-first must move only the translation section before the action path');
  assert.match(componentSource, /className="detail-stack" style=\{\{ order: 3 \}\}/,
    'secondary explanations must stay after both the selected primary section and the action path');
  assert.doesNotMatch(componentSource, /不会发送完整原文、姓名、邮箱或账户信息/);
  assert.doesNotMatch(componentSource, /PROCESSING_STAGES\.map/);
}

{
  const panelPath = new URL('../src/renderer/components/FloatingPanel.jsx', import.meta.url);
  const panelSource = await readFile(panelPath, 'utf8');
  const effectGenerationGuard = panelSource.indexOf('if (!isProcessingConfigGenerationCurrent(\n      processingConfigEffectGeneration,');
  const previousConfigMutation = panelSource.indexOf('previousProcessingConfigRef.current = processingConfigChangeKey;', effectGenerationGuard);
  const currentGenerationIntentGuard = panelSource.indexOf('activeProcessing?.configGeneration === processingConfigEffectGeneration', previousConfigMutation);
  const doneGenerationCleanup = panelSource.indexOf('activeProcessingRef.current.configGeneration !== processingConfigEffectGeneration', currentGenerationIntentGuard);
  const completionGenerationGuard = panelSource.indexOf('const generationIsCurrent = isProcessingConfigGenerationCurrent(');
  const completionOwnership = panelSource.indexOf('const completionOwnsActiveProcessing = activeProcessingRef.current?.taskId === task.id;', completionGenerationGuard);
  const restoreDecision = panelSource.indexOf('const restoreLastGoodIfStale = completionOwnsActiveProcessing', completionOwnership);
  const complete = panelSource.indexOf('completeTaskForGeneration(requestCoordinatorRef.current, task, {', restoreDecision);
  const clearActive = panelSource.indexOf('activeProcessingRef.current = null;', complete);
  const restore = panelSource.indexOf('if (restoreStaleLastGood) restoreLastGood();', complete);
  const intendedGeneration = panelSource.indexOf('const intendedConfigGeneration = processingConfigGenerationRef?.current');
  assert.ok(effectGenerationGuard >= 0 && effectGenerationGuard < previousConfigMutation,
    'an obsolete config effect must exit before mutating reconciliation state');
  assert.ok(currentGenerationIntentGuard > previousConfigMutation,
    'a task already intended for the effect generation must not be cancelled');
  assert.ok(doneGenerationCleanup > currentGenerationIntentGuard,
    'DONE reconciliation may clear only processing identity from an older generation');
  assert.ok(completionGenerationGuard >= 0,
    'processing completion must compare the synchronous config generation');
  assert.ok(completionOwnership > completionGenerationGuard && restoreDecision > completionOwnership,
    'stale completion restoration must require ownership of the exact active task');
  assert.ok(complete > restoreDecision,
    'generation suppression and task completion must be settled atomically');
  assert.ok(clearActive > complete
    && panelSource.slice(complete, clearActive).includes('!restoreStaleLastGood'),
  'completion-first restoration must keep its task identity for the latest effect');
  assert.ok(restore > clearActive,
    'eligible stale retry restoration must occur only after the active-marker decision');
  assert.ok(intendedGeneration >= 0
    && panelSource.indexOf('configGeneration: intendedConfigGeneration', intendedGeneration) > intendedGeneration,
  'every newly queued processing intent must carry its synchronous config generation');
  assert.doesNotMatch(panelSource, /processingConfigReconciliationRef/);
  assert.doesNotMatch(panelSource, /processingConfigEffectTaskId/,
    'effect reconciliation must use config generation rather than a stale render-time task id');

  const coordinatorPath = new URL('../src/renderer/hooks/requestCoordinator.mjs', import.meta.url);
  const coordinatorSource = await readFile(coordinatorPath, 'utf8');
  assert.match(coordinatorSource, /suppress\(task\)[\s\S]*?suppressed\.add\(task\.id\)/,
    'stale active work must have a non-destructive suppression path');
  assert.match(coordinatorSource, /if \(stale\) coordinator\.suppress\(task\);/);
  assert.doesNotMatch(coordinatorSource, /if \(stale\) coordinator\.invalidate\(\);/,
    'stale completion must not discard a newer queued task');
}

{
  const settingsHookPath = new URL('../src/renderer/hooks/useSettings.js', import.meta.url);
  const settingsHookSource = await readFile(settingsHookPath, 'utf8');
  const singleUpdate = settingsHookSource.indexOf('const updateSettings = useCallback');
  const multipleUpdate = settingsHookSource.indexOf('const updateMultipleSettings = useCallback');
  const singleGuard = settingsHookSource.indexOf(
    'if (processingConfigChanged) advanceProcessingConfigGeneration();',
    singleUpdate,
  );
  const singlePersist = settingsHookSource.indexOf('await persistSetting(', singleUpdate);
  const multipleGuard = settingsHookSource.indexOf(
    'if (processingConfigChanged) advanceProcessingConfigGeneration();',
    multipleUpdate,
  );
  const multiplePersist = settingsHookSource.indexOf('await persistSetting(', multipleUpdate);
  assert.ok(singleGuard > singleUpdate && singleGuard < singlePersist,
    'single config updates must synchronously advance generation before persistence');
  assert.ok(multipleGuard > multipleUpdate && multipleGuard < multiplePersist,
    'batched config updates must synchronously advance generation before persistence');
  assert.match(settingsHookSource, /if \(!PROCESSING_CONFIG_KEYS\.has\(key\)\) return false;/,
    'non-processing or no-op writes must not advance the processing generation');
  assert.match(settingsHookSource, /return value \? true : Boolean\(settings\[secretFlag\]\);/,
    'redacted credential deletion must still count as a processing config change');
}

console.log('result integrity checks passed');
