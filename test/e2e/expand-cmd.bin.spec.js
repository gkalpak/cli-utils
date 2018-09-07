'use strict';

// Imports
const {join, resolve} = require('path');
const {spawnAsPromised} = require('../../lib/command-utils');
const {normalizeNewlines, reversePromise, stripCleanUpCharacters} = require('../test-utils');

// Constants
const IS_WIN = (process.platform === 'win32');
const ROOT_DIR = resolve(__dirname, '../../');
const BIN_DIR = join(ROOT_DIR, 'bin');

// Tests
describe('`expand-cmd`', () => {
  const cmdPrefix = `node ${BIN_DIR}/expand-cmd`;
  const testWith = async argsStr => {
    if (!IS_WIN) {
      // On non-Windows platforms, escape `$` (unless already escaped).
      argsStr = argsStr.replace(/\\\$/g, '$$').replace(/\$/g, '\\$$');
    }

    const result = await spawnAsPromised(`${cmdPrefix} ${argsStr}`, {returnOutput: true});
    return normalizeNewlines(stripCleanUpCharacters(result)).trim();
  };
  let originalDefaultTimeoutInterval;

  beforeAll(() => {
    originalDefaultTimeoutInterval = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
  });

  afterAll(() => jasmine.DEFAULT_TIMEOUT_INTERVAL = originalDefaultTimeoutInterval);

  it('should correctly expand `$*`/`${*}`', async () => {
    let result = await testWith('"echo $* \\${*:bar}"');
    expect(result).toBe('echo bar');

    result = await testWith('"echo $* \\${*:bar}" foo');
    expect(result).toBe('echo foo foo');

    result = await testWith('"echo $* \\${*:bar}" foo bar');
    expect(result).toBe('echo foo bar foo bar');
  });

  it('should correctly expand `$n*`/`${n*}`', async () => {
    let result = await testWith('"echo $1* \\${2*:bar}"');
    expect(result).toBe('echo bar');

    result = await testWith('"echo $1* \\${2*:bar}" foo');
    expect(result).toBe('echo foo bar');

    result = await testWith('"echo $1* \\${2*:bar}" foo baz');
    expect(result).toBe('echo foo baz baz');
  });

  it('should correctly expand `$n`/`${n}`', async () => {
    let result = await testWith('"echo $1 ${2:bar} \\$1 \\${2:baz}" foo');
    expect(result).toBe('echo foo bar foo baz');

    result = await testWith('"echo $1 ${2:bar} \\$1 \\${2:baz}" foo qux');
    expect(result).toBe('echo foo qux foo qux');
  });

  it('should always substitute `${0}`', async () => {
    let result = await testWith('"echo ${0:foo} \\${0:bar}"');
    expect(result).toBe('echo foo bar');

    result = await testWith('"echo ${0:foo} \\${0:bar}" baz qux');
    expect(result).toBe('echo foo bar');
  });

  it('should correctly run fallback commands (only if necessary)', async () => {
    let result = await testWith('"echo ${*:::exit 1} \\${2:::echo bar}" foo');
    expect(result).toBe('echo foo bar');

    result = await testWith('"echo \\${0:::node -p process.platform}" foo');
    expect(result).toBe(`echo ${process.platform}`);
  });

  it('should fail if any executed sub-command fails', async () => {
    // Use `2>&1` to suppress stderr output in test results.
    const result = await reversePromise(testWith('"echo \\${42:::node -e process.exit(42)}" foo bar baz qux 2>&1'));
    expect(result).toBeGreaterThan(0);  // Linux always exits with 2.
  });

  it('should support `--gkcu-` arguments', async () => {
    // debug
    let result = await testWith('"echo $1 \\${2:bar} ${3:::echo baz}" foo --gkcu-debug');
    expect(result).toBe(
      'Input command: \'echo baz\'\n' +
      'Expanded command: \'echo baz\'\n' +
      '  Running 1/1: \'echo\', \'baz\', (stdio: inherit,pipe,inherit)\n' +
      'echo foo bar baz');

    // dryrun
    result = await testWith('"echo $1 \\${2:bar} ${3:::echo baz}" --gkcu-dryrun foo');
    expect(result).toBe('echo foo bar {{echo_baz}}');

    // returnOutput=n in sub-command
    const subCmd = 'node -p \\"\'blah\\nblah\\nbaz\'\\" --gkcu-returnOutput=2';
    result = await testWith(`"echo $1 \\\${2:bar} \${3:::${subCmd}}" foo`);
    expect(result).toBe('blah\nblah\nbaz\necho foo bar blah\nbaz');
  });
});
