import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDataDir, LOCAL_CONFIG } from '../datadir.js';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'slokabhyasa-datadir-'));
const withEnv = (value, fn) => {
  const before = process.env.SLOKABHYASA_DATA;
  if (value == null) delete process.env.SLOKABHYASA_DATA; else process.env.SLOKABHYASA_DATA = value;
  try { return fn(); } finally { if (before == null) delete process.env.SLOKABHYASA_DATA; else process.env.SLOKABHYASA_DATA = before; }
};

test('data lives beside the code unless told otherwise', () => {
  const root = scratch();
  withEnv(null, () => assert.equal(resolveDataDir(root), root));
});

test('local.json moves the data folder; relative paths count from the project', () => {
  const root = scratch();
  fs.writeFileSync(path.join(root, LOCAL_CONFIG), JSON.stringify({ data: '../my-slokas' }));
  withEnv(null, () => assert.equal(resolveDataDir(root), path.resolve(root, '..', 'my-slokas')));
  fs.writeFileSync(path.join(root, LOCAL_CONFIG), JSON.stringify({ data: 'C:\\Slokas' }));
  withEnv(null, () => assert.equal(resolveDataDir(root), path.resolve('C:\\Slokas')));
});

test('a leading ~ means the home folder', () => {
  const root = scratch();
  fs.writeFileSync(path.join(root, LOCAL_CONFIG), JSON.stringify({ data: '~/SlokAbhyasa' }));
  withEnv(null, () => assert.equal(resolveDataDir(root), path.join(os.homedir(), 'SlokAbhyasa')));
});

test('the environment variable wins over local.json; junk in local.json is ignored', () => {
  const root = scratch();
  fs.writeFileSync(path.join(root, LOCAL_CONFIG), JSON.stringify({ data: 'from-file' }));
  withEnv('from-env', () => assert.equal(resolveDataDir(root), path.resolve(root, 'from-env')));
  fs.writeFileSync(path.join(root, LOCAL_CONFIG), '{ not json');
  withEnv(null, () => assert.equal(resolveDataDir(root), root));
  fs.writeFileSync(path.join(root, LOCAL_CONFIG), JSON.stringify({ data: '   ' }));
  withEnv(null, () => assert.equal(resolveDataDir(root), root));
});
