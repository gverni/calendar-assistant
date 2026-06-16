/**
 * Shared utilities for deployment scripts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const DEPLOYMENT_STATE = path.join(REPO_ROOT, '.webapp-deployment.json');
export const CLASP_PROJECT = path.join(REPO_ROOT, '.clasp.json');

const CLASP_OAUTH = {
  clientId: '1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com',
  clientSecret: 'v6V3fKV_zWU7iw1DrpO1rknX',
  redirectUri: 'http://localhost',
};

export function die(msg) { console.error(msg); process.exit(1); }
export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

export function loadClaspAuth() {
  const localRc = path.join(REPO_ROOT, '.clasprc.json');
  const globalRc = path.join(os.homedir(), '.clasprc.json');
  const rcPath = fs.existsSync(localRc) ? localRc : globalRc;
  if (!fs.existsSync(rcPath)) die('No clasp credentials found. Run: npx clasp login');
  const raw = readJson(rcPath);
  const token = raw.token || raw;
  const s = raw.oauth2ClientSettings;
  const client = new OAuth2Client(
    s?.clientId || CLASP_OAUTH.clientId,
    s?.clientSecret || CLASP_OAUTH.clientSecret,
    s?.redirectUri || CLASP_OAUTH.redirectUri,
  );
  client.setCredentials(token);
  return client;
}

export function scriptApi() {
  return google.script({ version: 'v1', auth: loadClaspAuth() });
}

export function runClasp(args) {
  const r = spawnSync('npx', ['clasp', ...args], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.error) die(String(r.error));
  if (r.status !== 0) { console.error(out); die(`clasp ${args[0]} failed (exit ${r.status})`); }
  if (out.trim()) process.stdout.write(out);
  return out;
}

export async function listDeployments(scriptId) {
  const res = await scriptApi().projects.deployments.list({ scriptId });
  return res.data.deployments || [];
}

export function webAppUrl(deployment) {
  const eps = deployment.entryPoints || [];
  return eps.find(e => e.entryPointType === 'WEB_APP')?.webApp?.url || null;
}

export function isHeadDeployment(deployment) {
  // HEAD deployment has no versionNumber in its config
  return deployment.deploymentConfig?.versionNumber == null;
}
