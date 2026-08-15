const assert = require('node:assert/strict');
const {
  BUILD_IDENTITIES,
  architectureLabel,
  createAboutPanelOptions,
  describeBuildIdentity,
  resolveBuildIdentity,
} = require('../src/main/build-identity');

function main() {
  assert.deepEqual(Object.values(BUILD_IDENTITIES), [
    'development',
    'local-adhoc',
    'developer-id',
    'packaged-unknown',
  ]);

  assert.equal(
    resolveBuildIdentity({ isPackaged: false }),
    BUILD_IDENTITIES.DEVELOPMENT
  );
  assert.equal(
    resolveBuildIdentity({
      isPackaged: false,
      declaredIdentity: BUILD_IDENTITIES.DEVELOPER_ID,
    }),
    BUILD_IDENTITIES.DEVELOPMENT
  );
  assert.equal(
    resolveBuildIdentity({
      isPackaged: true,
      declaredIdentity: BUILD_IDENTITIES.LOCAL_ADHOC,
    }),
    BUILD_IDENTITIES.LOCAL_ADHOC
  );
  assert.equal(
    resolveBuildIdentity({
      isPackaged: true,
      declaredIdentity: BUILD_IDENTITIES.DEVELOPER_ID,
    }),
    BUILD_IDENTITIES.DEVELOPER_ID
  );
  assert.equal(
    resolveBuildIdentity({
      isPackaged: true,
      declaredIdentity: BUILD_IDENTITIES.PACKAGED_UNKNOWN,
    }),
    BUILD_IDENTITIES.PACKAGED_UNKNOWN
  );

  for (const declaredIdentity of [
    undefined,
    '',
    BUILD_IDENTITIES.DEVELOPMENT,
    'official',
    'developer-id-notarized',
  ]) {
    assert.equal(
      resolveBuildIdentity({ isPackaged: true, declaredIdentity }),
      BUILD_IDENTITIES.PACKAGED_UNKNOWN,
      `unrecognized packaged identity must fail closed: ${declaredIdentity}`
    );
  }
  assert.equal(resolveBuildIdentity(), BUILD_IDENTITIES.PACKAGED_UNKNOWN);
  assert.equal(resolveBuildIdentity(null), BUILD_IDENTITIES.PACKAGED_UNKNOWN);

  const descriptions = Object.values(BUILD_IDENTITIES).map(describeBuildIdentity);
  for (const description of descriptions) {
    assert.deepEqual(Object.keys(description), [
      'identity',
      'label',
      'detail',
      'isPublicDistribution',
    ]);
    assert.equal(description.isPublicDistribution, false);
    assert.doesNotMatch(description.label, /正式安装包/u);
    assert.doesNotMatch(description.detail, /正式安装包/u);
    assert.doesNotMatch(
      `${description.label}\n${description.detail}`,
      /已公证|公证完成|Gatekeeper (?:验证)?通过|Gatekeeper 已(?:接受|信任)/u
    );
  }

  const development = describeBuildIdentity(BUILD_IDENTITIES.DEVELOPMENT);
  assert.match(`${development.label}\n${development.detail}`, /源码预览/u);

  const localAdHoc = describeBuildIdentity(BUILD_IDENTITIES.LOCAL_ADHOC);
  assert.equal(localAdHoc.label, '本地测试包 · 临时签名 · 未公证');
  assert.match(localAdHoc.detail, /仅用于本地测试/u);
  assert.match(localAdHoc.detail, /不是公开发布版本/u);

  const developerId = describeBuildIdentity(BUILD_IDENTITIES.DEVELOPER_ID);
  assert.equal(developerId.label, 'Developer ID 签名构建');
  assert.match(developerId.detail, /不能证明 Apple 公证状态/u);
  assert.match(developerId.detail, /Gatekeeper 信任/u);
  assert.match(developerId.detail, /独立分发检查/u);

  const packagedUnknown = describeBuildIdentity(BUILD_IDENTITIES.PACKAGED_UNKNOWN);
  assert.doesNotMatch(`${packagedUnknown.label}\n${packagedUnknown.detail}`, /正式|官方/u);
  assert.deepEqual(describeBuildIdentity('invented-identity'), packagedUnknown);
  assert.deepEqual(describeBuildIdentity(), packagedUnknown);

  assert.equal(architectureLabel('arm64'), 'Apple 芯片（arm64）');
  assert.equal(architectureLabel('x64'), 'Intel（x64）');
  assert.equal(architectureLabel('riscv64'), '未知架构（riscv64）');
  assert.equal(architectureLabel(), '未知架构（unknown）');

  assert.deepEqual(
    createAboutPanelOptions({
      applicationName: 'Slipstream',
      appVersion: '1.2.3+build.4',
      arch: 'arm64',
      buildIdentity: BUILD_IDENTITIES.LOCAL_ADHOC,
    }),
    {
      applicationName: 'Slipstream',
      applicationVersion: '1.2.3+build.4',
      version: '1.2.3+build.4',
      credits: [
        localAdHoc.label,
        localAdHoc.detail,
        '架构：Apple 芯片（arm64）',
      ].join('\n'),
    }
  );

  const unknownAbout = createAboutPanelOptions({
    applicationName: 'Slipstream',
    appVersion: '9.8.7',
    arch: 'x64',
    buildIdentity: 'invented-identity',
  });
  assert.equal(
    unknownAbout.credits,
    `${packagedUnknown.label}\n${packagedUnknown.detail}\n架构：Intel（x64）`
  );

  console.log('build identity check passed');
}

main();
