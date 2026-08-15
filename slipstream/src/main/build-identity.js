const BUILD_IDENTITIES = Object.freeze({
  DEVELOPMENT: 'development',
  LOCAL_ADHOC: 'local-adhoc',
  DEVELOPER_ID: 'developer-id',
  PACKAGED_UNKNOWN: 'packaged-unknown',
});

const BUILD_IDENTITY_DESCRIPTIONS = Object.freeze({
  [BUILD_IDENTITIES.DEVELOPMENT]: Object.freeze({
    identity: BUILD_IDENTITIES.DEVELOPMENT,
    label: '源码预览',
    detail: '从源码运行的开发预览，不是安装包或公开发布版本。',
    isPublicDistribution: false,
  }),
  [BUILD_IDENTITIES.LOCAL_ADHOC]: Object.freeze({
    identity: BUILD_IDENTITIES.LOCAL_ADHOC,
    label: '本地测试包 · 临时签名 · 未公证',
    detail: '仅用于本地测试，不是公开发布版本。',
    isPublicDistribution: false,
  }),
  [BUILD_IDENTITIES.DEVELOPER_ID]: Object.freeze({
    identity: BUILD_IDENTITIES.DEVELOPER_ID,
    label: 'Developer ID 签名构建',
    detail: 'Developer ID 签名本身不能证明 Apple 公证状态或 Gatekeeper 信任；请以独立分发检查结果为准。',
    isPublicDistribution: false,
  }),
  [BUILD_IDENTITIES.PACKAGED_UNKNOWN]: Object.freeze({
    identity: BUILD_IDENTITIES.PACKAGED_UNKNOWN,
    label: '未知构建身份的安装包',
    detail: '未声明可验证的构建身份，不能视为可信或公开发布版本。',
    isPublicDistribution: false,
  }),
});

const DECLARED_PACKAGED_IDENTITIES = new Set([
  BUILD_IDENTITIES.LOCAL_ADHOC,
  BUILD_IDENTITIES.DEVELOPER_ID,
  BUILD_IDENTITIES.PACKAGED_UNKNOWN,
]);

function resolveBuildIdentity(options = {}) {
  const isPackaged = options && options.isPackaged;
  const declaredIdentity = options && options.declaredIdentity;

  if (isPackaged === false) return BUILD_IDENTITIES.DEVELOPMENT;
  if (DECLARED_PACKAGED_IDENTITIES.has(declaredIdentity)) return declaredIdentity;
  return BUILD_IDENTITIES.PACKAGED_UNKNOWN;
}

function describeBuildIdentity(identity) {
  return BUILD_IDENTITY_DESCRIPTIONS[identity]
    || BUILD_IDENTITY_DESCRIPTIONS[BUILD_IDENTITIES.PACKAGED_UNKNOWN];
}

function architectureLabel(arch) {
  if (arch === 'arm64') return 'Apple 芯片（arm64）';
  if (arch === 'x64') return 'Intel（x64）';

  const exactArchitecture = typeof arch === 'string' && arch.trim() ? arch.trim() : 'unknown';
  return `未知架构（${exactArchitecture}）`;
}

function createAboutPanelOptions({
  applicationName,
  appVersion,
  arch,
  buildIdentity,
} = {}) {
  const description = describeBuildIdentity(buildIdentity);
  return {
    applicationName,
    applicationVersion: appVersion,
    version: appVersion,
    credits: [
      description.label,
      description.detail,
      `架构：${architectureLabel(arch)}`,
    ].join('\n'),
  };
}

module.exports = {
  BUILD_IDENTITIES,
  architectureLabel,
  createAboutPanelOptions,
  describeBuildIdentity,
  resolveBuildIdentity,
};
