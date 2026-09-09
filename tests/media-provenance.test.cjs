const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  listPublicMediaFiles,
  validateManifest,
  verifyMediaProvenance
} = require('../tools/verify-media-provenance.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'distribution', 'media-provenance.json'),
  'utf8'
));

test('every current public media file has exactly one conservative provenance mapping', () => {
  const result = verifyMediaProvenance(repositoryRoot);

  assert.equal(result.profile, 'source');
  assert.equal(result.fileCount, 387);
  assert.equal(result.mappedCount, 387);
  assert.equal(result.provenanceRecordCount, 8);
  assert.equal(result.totalBytes, 88454525);
  assert.equal(result.uniqueSha256, 356);
  assert.equal(
    result.inventorySha256,
    '6a5c9fe6687cf77daaaa38d487ae4842be1b3bd985a0b8cedad0b04a57228eb3'
  );
});

test('the exact inventory prevents new or missing public media from passing silently', () => {
  const { assetPaths } = validateManifest(manifest);
  const publicMedia = listPublicMediaFiles(repositoryRoot, manifest);

  assert.deepEqual([...assetPaths].sort(), publicMedia);
  assert.equal(new Set(manifest.assets.map(asset => asset.path)).size, 387);
});

test('all provenance records keep media separate from the repository MIT license', () => {
  for (const record of manifest.provenanceRecords) {
    assert.equal(record.repositoryLicense, 'NOT_COVERED_BY_REPOSITORY_MIT');
    assert.notEqual(record.permissionBasis, '');
    assert.notEqual(record.redistributionStatus, '');
    assert.notEqual(record.modificationStatus, '');
  }
});

test('owner-created media is authorized only inside project distributions without a credit mandate', () => {
  const policy = manifest.ownerMediaPolicy;
  assert.equal(policy.independentReuseLicense, 'NOT_GRANTED');
  assert.equal(policy.independentModificationLicense, 'NOT_GRANTED');
  assert.equal(policy.relicensingPermission, 'NOT_GRANTED');
  assert.equal(policy.standaloneRedistributionLicense, 'NOT_GRANTED');
  assert.equal(
    policy.mandatoryCreditLine,
    'NONE_UNLESS_AN_INDIVIDUAL_ASSET_RECORD_EXPLICITLY_STATES_OTHERWISE'
  );

  for (const recordId of policy.appliesToProvenanceRecords) {
    const record = manifest.provenanceRecords.find(item => item.id === recordId);
    assert.match(record.redistributionStatus, /^OWNER_AUTHORIZED_FOR_PROJECT_BUNDLES_ONLY/);
    assert.equal(
      record.modificationStatus,
      'NO_SEPARATE_LICENSE_FOR_INDEPENDENT_MODIFICATION_REUSE_RELICENSING_OR_STANDALONE_REDISTRIBUTION'
    );
    assert.equal(
      record.attributionRequirement,
      'NO_MANDATORY_CREDIT_LINE_UNLESS_AN_INDIVIDUAL_ASSET_RECORD_STATES_OTHERWISE'
    );
  }
});

test('M05 contains no unresolved owner-confirmation marker', () => {
  const unresolvedOwnerMarker = new RegExp(
    ['OWNER', 'CONFIRMATION', 'REQUIRED'].join(' '),
    'i'
  );
  const documentation = fs.readFileSync(
    path.join(repositoryRoot, 'MEDIA_ATTRIBUTION.md'),
    'utf8'
  );
  assert.doesNotMatch(documentation, unresolvedOwnerMarker);
  assert.doesNotMatch(JSON.stringify(manifest), unresolvedOwnerMarker);
});

test('private and generated state cannot enter the provenance manifest', () => {
  const serializedPaths = [
    ...manifest.assets.map(asset => asset.path),
    ...manifest.provenanceRecords.flatMap(record => [
      ...(record.selector.paths || []),
      ...(record.selector.directories || []),
      ...(record.selector.excludePaths || [])
    ]),
    ...manifest.exactDuplicateGroups.flatMap(group => group.paths)
  ];

  for (const relativePath of serializedPaths) {
    const segments = relativePath.toLowerCase().split('/');
    for (const forbidden of [
      'private-data',
      'slidedeck',
      'backups',
      '.movement-media-trash',
      '.save.lock'
    ]) {
      assert.equal(segments.includes(forbidden), false, relativePath);
    }
  }

  assert.doesNotMatch(
    JSON.stringify(manifest.assets),
    /private-data|slidedeck|backups|\.movement-media-trash|\.save\.lock/i
  );
});

test('the Speechelo record covers all 159 synthetic narration files', () => {
  const narration = manifest.assets.filter(
    asset => asset.provenanceId === 'example-narration-speechelo-pro'
  );
  const record = manifest.provenanceRecords.find(
    item => item.id === 'example-narration-speechelo-pro'
  );

  assert.equal(narration.length, 159);
  assert.equal(record.sourceTool, 'Speechelo PRO / BlasterOnline');
  assert.equal(
    record.voiceType,
    'SYNTHETIC_TTS_NOT_A_HUMAN_RECORDING_AND_NOT_A_REAL_PERSON_VOICE_CLONE'
  );
  assert.match(record.modificationStatus, /^NOT_INDEPENDENTLY_VERIFIED/);
});

test('example-image records preserve unknown per-file AI tool identity and fictional likeness status', () => {
  const generalImages = manifest.provenanceRecords.find(
    item => item.id === 'example-images-ai-tool-not-individually-recorded'
  );
  const presenter = manifest.provenanceRecords.find(
    item => item.id === 'example-image-fictional-red-haired-presenter'
  );
  const chatgpt = manifest.provenanceRecords.find(
    item => item.id === 'example-image-chatgpt-filename-identified'
  );

  assert.match(generalImages.sourceTool, /ChatGPT or Gemini/);
  assert.match(generalImages.sourceTool, /not individually recorded/);
  assert.equal(
    presenter.recognizableRealPersonStatus,
    'OWNER_CONFIRMED_FICTIONAL_CHARACTER_NOT_BASED_ON_A_REAL_PERSON'
  );
  assert.match(chatgpt.sourceTool, /^ChatGPT;/);
});

test('desktop distributions carry the canonical media provenance documents', () => {
  const packageManifest = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'package.json'),
    'utf8'
  ));
  const authoringKitManifest = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'distribution', 'desktop-authoring-kit.manifest.json'),
    'utf8'
  ));

  for (const requiredPath of [
    'MEDIA_ATTRIBUTION.md',
    'distribution/media-provenance.json'
  ]) {
    assert.ok(packageManifest.build.files.includes(requiredPath), requiredPath);
    assert.ok(authoringKitManifest.files.includes(requiredPath), requiredPath);
    assert.ok(authoringKitManifest.requiredPaths.includes(requiredPath), requiredPath);
  }
  assert.ok(authoringKitManifest.files.includes('tools/verify-media-provenance.cjs'));
  assert.ok(authoringKitManifest.requiredPaths.includes('tools/verify-media-provenance.cjs'));
});

test('the verifier rejects unrecorded media before release', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-media-provenance-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(fixtureRoot, 'distribution'), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureRoot, 'distribution', 'media-provenance.json'),
    JSON.stringify(manifest)
  );
  fs.writeFileSync(path.join(fixtureRoot, 'unrecorded.png'), 'not-a-real-image');

  assert.throws(
    () => verifyMediaProvenance(fixtureRoot),
    /Public media has no provenance record: unrecorded\.png/
  );

  fs.rmSync(path.join(fixtureRoot, 'unrecorded.png'));
  assert.throws(
    () => verifyMediaProvenance(fixtureRoot),
    /Media provenance manifest refers to a missing file:/
  );
});

test('manifest validation rejects private paths and false MIT coverage', () => {
  const privateManifest = structuredClone(manifest);
  privateManifest.assets.push({
    path: 'private-data/secret.png',
    provenanceId: 'root-favicon'
  });
  assert.throws(
    () => validateManifest(privateManifest),
    /forbidden private\/generated state/
  );

  const mitManifest = structuredClone(manifest);
  mitManifest.provenanceRecords[0].repositoryLicense = 'MIT';
  assert.throws(
    () => validateManifest(mitManifest),
    /incorrectly describes repository MIT coverage/
  );
});
