export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

const SAFE_OLLAMA_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function copyAction(label, value) {
  return { kind: 'copy', label, value };
}

function focusAction(label, value) {
  return { kind: 'focus', label, value };
}

function retryAction(label = '重新测试连接') {
  return { kind: 'retry', label };
}

function safePullCommand(model) {
  return SAFE_OLLAMA_MODEL_ID.test(model || '') ? `ollama pull ${model}` : null;
}

export function buildConnectionRecoveryPlan({ code, backend, model } = {}) {
  const isOllama = backend === 'ollama';
  const isCustom = backend === 'custom';
  const pullCommand = isOllama ? safePullCommand(model) : null;

  if (isOllama && (code === 'unreachable' || code === 'timeout')) {
    return {
      title: '先让 Ollama 在这台 Mac 上就绪',
      description: '这次测试没有连接到本机 Ollama。按顺序完成下面三项，再回来重试。',
      steps: [
        {
          title: '确认已经安装 Ollama',
          detail: '如果还没有安装，请使用 Ollama 官方下载页面。',
          action: { kind: 'open', label: '打开官方下载', value: OLLAMA_DOWNLOAD_URL },
        },
        {
          title: '启动本地服务',
          detail: '打开 Ollama 应用，或在终端运行启动命令。',
          command: 'ollama serve',
          action: copyAction('复制启动命令', 'ollama serve'),
        },
        {
          title: '准备当前模型',
          detail: pullCommand
            ? `确认 ${model} 已经下载到这台 Mac。`
            : '当前模型 ID 不适合直接生成终端命令，请先在上方检查模型名称。',
          command: pullCommand,
          action: pullCommand
            ? copyAction('复制下载命令', pullCommand)
            : focusAction('检查模型名称', 'provider-model-input'),
        },
      ],
      actions: [
        retryAction('完成后重新测试'),
        { kind: 'switch-online', label: '改用在线分析服务' },
      ],
    };
  }

  if (!isOllama && (code === 'unreachable' || code === 'timeout')) {
    return {
      title: code === 'timeout' ? '检查网络后稍等再试' : '先确认网络与服务状态',
      description: code === 'timeout'
        ? '服务没有在限定时间内完成连接或内置虚构文本测试；没有发送你的任务原文。'
        : 'Slipstream 没有完成当前在线服务测试；没有发送你的截图、剪贴板或任务原文。',
      steps: [
        {
          title: '确认网络与服务可用',
          detail: '检查这台 Mac 的网络，并确认服务商当前没有中断或维护。',
        },
        ...(isCustom ? [{
          title: '核对自定义服务地址',
          detail: '确认使用公开 HTTPS 根地址，并保存修改。',
          action: focusAction('修改服务地址', 'provider-connection-input'),
        }] : []),
      ],
      actions: [retryAction(code === 'timeout' ? '稍后重新测试' : '重新测试连接')],
    };
  }

  if (code === 'model-not-found') {
    return {
      title: isOllama ? '当前模型还没有准备好' : '当前服务里没有找到这个模型',
      description: isOllama
        ? '服务已经连通；下载当前模型，或改成这台 Mac 上已有的模型。'
        : '服务已经连通；请核对模型 ID 是否与服务商控制台完全一致。',
      steps: isOllama
        ? [{
            title: `准备 ${model || '当前模型'}`,
            detail: pullCommand ? '复制命令到终端运行，等待下载完成。' : '先在上方检查模型名称。',
            command: pullCommand,
            action: pullCommand
              ? copyAction('复制下载命令', pullCommand)
              : focusAction('检查模型名称', 'provider-model-input'),
          }]
        : [{
            title: '核对模型 ID',
            detail: '回到上方修改并保存模型名称后，再重新测试。',
            action: focusAction('修改模型 ID', 'provider-model-input'),
          }],
      actions: [retryAction('准备好后重新测试')],
    };
  }

  if (code === 'unauthorized' || code === 'missing-credentials') {
    const credentialInputId = isCustom
      ? 'provider-custom-key-input'
      : 'provider-connection-input';
    return {
      title: '更新 API Key 后再测试',
      description: code === 'unauthorized'
        ? '服务拒绝了当前凭据。Slipstream 不会反复使用失败的 Key。'
        : '当前服务还没有可用的凭据。',
      steps: [
        {
          title: '确认 Key 仍然有效',
          detail: '检查服务商账户、权限与余额，然后在上方保存新 Key。',
        },
      ],
      actions: [focusAction('修改并保存 API Key', credentialInputId)],
    };
  }

  if (code === 'unsafe-endpoint' || code === 'invalid-config') {
    return {
      title: '先修正服务地址',
      description: code === 'unsafe-endpoint'
        ? '远程服务必须使用公开 HTTPS 地址；本地 HTTP 只允许回环地址。'
        : '当前连接信息无法安全使用，请检查服务地址与模型。',
      steps: [
        {
          title: '修改并保存连接信息',
          detail: '填写服务根地址，不要包含凭据、查询参数或具体接口路径。',
          action: focusAction('修改服务地址', 'provider-connection-input'),
        },
      ],
      actions: [retryAction('保存后重新测试')],
    };
  }

  if (code === 'rate-limited') {
    return {
      title: '服务暂时限制了请求',
      description: '无需反复点击。等待几分钟，并在服务商控制台确认额度后再试。',
      steps: [],
      actions: [retryAction('稍后重新测试')],
    };
  }

  if (code === 'structured-output-invalid') {
    return {
      title: '换一个更适合完整分析的模型',
      description: '服务和模型可以响应，但结果没有通过 Slipstream 的结构与证据校验，因此完整分析保持关闭。',
      steps: [
        {
          title: '选择遵循结构化指令更稳定的模型',
          detail: isOllama
            ? '优先使用已下载且能稳定生成 JSON 的模型，例如 qwen2.5。'
            : '在上方填写服务商支持结构化 JSON 输出的模型 ID，并保存。',
          action: focusAction('更换模型', 'provider-model-input'),
        },
      ],
      actions: [retryAction('更换后重新验证')],
    };
  }

  if (code === 'generation-failed') {
    return {
      title: '当前模型没有完成生成测试',
      description: '模型已找到，但内置虚构文本没有成功生成；没有使用你的任务内容。',
      steps: [
        {
          title: isOllama ? '检查本机资源或改用更小模型' : '检查模型、额度与服务状态',
          detail: isOllama
            ? '确认 Ollama 能启动当前模型；内存不足时可选择更小的已下载模型。'
            : '确认模型允许生成请求，并检查账户额度或服务商状态。',
          action: focusAction('检查或更换模型', 'provider-model-input'),
        },
      ],
      actions: [retryAction('检查后重新验证')],
    };
  }

  if (code === 'unsupported') {
    return {
      title: '这个服务无法完成必要检查',
      description: '服务可访问，但没有返回可识别的模型列表。为避免启用后失败，完整分析仍保持关闭。',
      steps: [
        {
          title: '换用兼容的服务或接口',
          detail: '检查自定义服务根地址与模型 ID，或选择其他在线服务。',
          action: focusAction('检查服务地址', 'provider-connection-input'),
        },
      ],
      actions: [retryAction()],
    };
  }

  if (code === 'settings-save-failed') {
    return {
      title: '先保存当前设置',
      description: '这次测试没有使用旧配置。请修正上方标记为保存失败的项目。',
      steps: [],
      actions: [retryAction('保存后重新测试')],
    };
  }

  if (code === 'busy' || code === 'cancelled' || code === 'cancelled-by-user') {
    return {
      title: '重新开始这次测试',
      description: code === 'busy'
        ? '已有连接测试正在结束，请稍等片刻。'
        : code === 'cancelled-by-user'
          ? '你已停止这次验证；当前配置没有改变。'
          : '设置或输入发生变化，旧测试已经安全取消。',
      steps: [],
      actions: [retryAction()],
    };
  }

  if (['invalid-response', 'response-too-large', 'redirect-rejected', 'http-error'].includes(code)) {
    return {
      title: '服务已响应，但结果无法确认',
      description: 'Slipstream 已停止这次检查；没有发送你的截图、剪贴板或任务原文。请核对服务状态与当前连接信息。',
      steps: isCustom
        ? [{
            title: '检查自定义接口兼容性',
            detail: '确认服务根地址能返回兼容的模型列表响应。',
            action: focusAction('检查服务地址', 'provider-connection-input'),
          }]
        : [],
      actions: [retryAction()],
    };
  }

  return {
    title: '检查连接信息后再试',
    description: isCustom
      ? '请核对自定义服务地址、模型 ID 和服务状态。'
      : '服务返回了无法确认的结果；原文没有被发送。',
    steps: [
      {
        title: '核对当前配置',
        detail: '检查上方已保存的连接信息与模型，然后重新测试。',
        action: focusAction(
          isOllama ? '检查本地服务地址' : '检查连接信息',
          'provider-connection-input'
        ),
      },
    ],
    actions: [retryAction()],
  };
}
