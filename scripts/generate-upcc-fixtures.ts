import fs from 'node:fs';
import path from 'node:path';
import { buildModelSignature, parseUpccMetadata } from '../playwright/helper-functions/upcc-metadata-parser';
import { evaluateRefreshHealth } from '../playwright/helper-functions/refresh-health';
import { RefreshHistoryEntry } from '../playwright/helper-functions/types';

const repoRoot = process.cwd();
const metadataPath = path.join(repoRoot, 'UPCC Dashboard.txt');
const refreshFixturePath = path.join(
  repoRoot,
  'playwright',
  'fixtures',
  'snapshots',
  'refresh-history',
  'upcc-refresh-history.json',
);

const modelSignaturePath = path.join(
  repoRoot,
  'playwright',
  'fixtures',
  'snapshots',
  'model-signatures',
  'upcc-model-signature.json',
);

const refreshSummaryPath = path.join(
  repoRoot,
  'playwright',
  'fixtures',
  'snapshots',
  'refresh-history',
  'upcc-refresh-health.json',
);

const parsed = parseUpccMetadata(fs.readFileSync(metadataPath, 'utf8'));
const modelSignature = buildModelSignature(parsed);
const refreshes = JSON.parse(fs.readFileSync(refreshFixturePath, 'utf8')) as RefreshHistoryEntry[];
const refreshHealth = evaluateRefreshHealth(refreshes, 7, '2026-05-10T19:00:00.000Z');

fs.writeFileSync(modelSignaturePath, `${JSON.stringify(modelSignature, null, 2)}\n`);
fs.writeFileSync(refreshSummaryPath, `${JSON.stringify(refreshHealth, null, 2)}\n`);

console.log('Generated UPCC model signature and refresh health fixtures.');
