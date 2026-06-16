/**
 * Push code and update (or create) the production deployment.
 *
 * Usage: npm run release
 *
 * - First run: creates the prod deployment, saves its ID, then redeploys so
 *   prod gets code that already has the correct PROD_DEPLOYMENT_ID_ baked in.
 * - Subsequent runs: patches Web.gs before pushing, so a single deploy suffices.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT, DEPLOYMENT_STATE, CLASP_PROJECT,
  die, readJson, runClasp, listDeployments, webAppUrl,
} from './lib.mjs';

const WEB_GS = path.join(REPO_ROOT, 'src', 'Web.gs');

function parseDeploymentId(output) {
  const m = output.match(/-\s+(AKfycb[^\s]+)\s+@/);
  return m ? m[1] : null;
}

function patchWebGs(deploymentId) {
  const src = fs.readFileSync(WEB_GS, 'utf8');
  const patched = src.replace(
    /var PROD_DEPLOYMENT_ID_ = '.*?';/,
    `var PROD_DEPLOYMENT_ID_ = '${deploymentId}';`,
  );
  if (patched !== src) fs.writeFileSync(WEB_GS, patched);
}

function restoreWebGs() {
  const src = fs.readFileSync(WEB_GS, 'utf8');
  const restored = src.replace(
    /var PROD_DEPLOYMENT_ID_ = '.*?';/,
    `var PROD_DEPLOYMENT_ID_ = '';`,
  );
  if (restored !== src) fs.writeFileSync(WEB_GS, restored);
}

async function deploy(deploymentId) {
  const args = deploymentId
    ? ['deploy', '--deploymentId', deploymentId, '--description', 'Calendar Assistant']
    : ['deploy', '--description', 'Calendar Assistant'];
  return runClasp(args);
}

async function main() {
  if (!fs.existsSync(CLASP_PROJECT)) die('Missing .clasp.json — copy from .clasp.json.example');

  // If we already have a prod deployment ID, patch Web.gs before pushing
  // so the deployed version already has the correct ID baked in.
  let deploymentId = fs.existsSync(DEPLOYMENT_STATE)
    ? (readJson(DEPLOYMENT_STATE).deploymentId || null)
    : null;

  if (deploymentId) {
    patchWebGs(deploymentId);
  }

  console.log('\n→ Pushing code…\n');
  runClasp(['push', '-f']);
  restoreWebGs();

  console.log(deploymentId
    ? '\n→ Updating production deployment…\n'
    : '\n→ Creating production deployment (first time)…\n');
  const out = await deploy(deploymentId);

  if (!deploymentId) {
    // First run: save the new ID, patch Web.gs, push + deploy again so prod
    // gets code that has the correct PROD_DEPLOYMENT_ID_ baked in.
    deploymentId = parseDeploymentId(out);
    if (!deploymentId) die('Could not parse deployment ID from clasp output.');
    fs.writeFileSync(
      DEPLOYMENT_STATE,
      JSON.stringify({ deploymentId, createdAt: new Date().toISOString() }, null, 2) + '\n',
    );
    console.log('\nProd deployment ID saved to .webapp-deployment.json.');
    patchWebGs(deploymentId);
    console.log('\n→ Pushing patched Web.gs and redeploying…\n');
    runClasp(['push', '-f']);
    restoreWebGs();
    await deploy(deploymentId);
  }

  const { scriptId } = readJson(CLASP_PROJECT);
  const deployments = await listDeployments(scriptId);
  const prodDep = deployments.find(d => d.deploymentId === deploymentId);
  const prodUrl = prodDep ? webAppUrl(prodDep) : null;

  console.log('\n─────────────────────────────────────');
  console.log('  Prod URL:', prodUrl || '(unavailable — check Apps Script dashboard)');
  console.log('─────────────────────────────────────');
  console.log('\nTip: use "npm run push" for dev changes, test via "npm run urls" dev URL.');
  console.log('Run "npm run release" only when ready to ship to prod.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
