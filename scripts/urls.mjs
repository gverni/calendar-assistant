/**
 * Print the dev (HEAD) and prod URLs without making any changes.
 *
 * Usage: npm run urls
 */

import fs from 'node:fs';
import {
  DEPLOYMENT_STATE, CLASP_PROJECT,
  die, readJson, listDeployments, webAppUrl, isHeadDeployment,
} from './lib.mjs';

async function main() {
  if (!fs.existsSync(CLASP_PROJECT)) die('Missing .clasp.json — copy from .clasp.json.example');

  const { scriptId } = readJson(CLASP_PROJECT);
  const deployments = await listDeployments(scriptId);

  // Dev URL: the HEAD deployment (no version number, only accessible to editors)
  const headDep = deployments.find(isHeadDeployment);
  const devUrl = headDep ? webAppUrl(headDep) : null;

  // Prod URL: the deployment whose ID is saved in .webapp-deployment.json
  let prodUrl = null;
  if (fs.existsSync(DEPLOYMENT_STATE)) {
    const { deploymentId } = readJson(DEPLOYMENT_STATE);
    const prodDep = deployments.find(d => d.deploymentId === deploymentId);
    prodUrl = prodDep ? webAppUrl(prodDep) : null;
  }

  console.log('\n─────────────────────────────────────────────────────────');
  console.log('  Dev  (HEAD):', devUrl  || '(not found — run npm run push first)');
  console.log('  Prod:       ', prodUrl || '(not found — run npm run release first)');
  console.log('─────────────────────────────────────────────────────────\n');
}

main().catch(e => { console.error(e); process.exit(1); });
