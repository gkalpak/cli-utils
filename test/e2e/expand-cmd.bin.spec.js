'use strict';

// Imports
const {join} = require('path');
const {testScriptFactory, withJasmineTimeout} = require('../../lib/testing-utils');
const {reversePromise, ROOT_DIR} = require('../test-utils');

// Constants
const IS_WIN = (process.platform === 'win32');

// Tests
describe('bin/expand-cmd', withJasmineTimeout(30000, () => {
  const scriptPath = join(ROOT_DIR, 'bin/expand-cmd');
  const testScript = testScriptFactory(scriptPath);
  const expandCmd = (argsStr = '') => {
    if (!IS_WIN) {
      // On non-Windows platforms, escape `$` (unless already escaped).
      argsStr = argsStr.replace(/\\\$/g, '$$').replace(/\$/g, '\\$$');
    }

    return testScript(argsStr);
  };

  it('should correctly expand `$*`/`${*}`', async () => {
    let result = await expandCmd('"echo $* \\${*:bar}"');
    expect(result).toBe('echo bar');

    result = await expandCmd('"echo $* \\${*:bar}" foo');
    expect(result).toBe('echo foo foo');

    result = await expandCmd('"echo $* \\${*:bar}" foo bar');
    expect(result).toBe('echo foo bar foo bar');
  });

  it('should correctly expand `$n*`/`${n*}`', async () => {
    let result = await expandCmd('"echo $1* \\${2*:bar}"');
    expect(result).toBe('echo bar');

    result = await expandCmd('"echo $1* \\${2*:bar}" foo');
    expect(result).toBe('echo foo bar');

    result = await expandCmd('"echo $1* \\${2*:bar}" foo baz');
    expect(result).toBe('echo foo baz baz');
  });

  it('should correctly expand `$n`/`${n}`', async () => {
    let result = await expandCmd('"echo $1 ${2:bar} \\$1 \\${2:baz}" foo');
    expect(result).toBe('echo foo bar foo baz');

    result = await expandCmd('"echo $1 ${2:bar} \\$1 \\${2:baz}" foo qux');
    expect(result).toBe('echo foo qux foo qux');
  });

  it('should always substitute `${0}`', async () => {
    let result = await expandCmd('"echo ${0:foo} \\${0:bar}"');
    expect(result).toBe('echo foo bar');

    result = await expandCmd('"echo ${0:foo} \\${0:bar}" baz qux');
    expect(result).toBe('echo foo bar');
  });

  it('should correctly run fallback commands (only if necessary)', async () => {
    let result = await expandCmd('"echo ${*:::exit 1} \\${2:::echo bar}" foo');
    expect(result).toBe('echo foo bar');

    result = await expandCmd('"echo \\${0:::node -p process.platform}" foo');
    expect(result).toBe(`echo ${process.platform}`);
  });

  it('should fail if any executed sub-command fails', async () => {
    // Use `2>&1` to suppress stderr output in test results.
    const result = await reversePromise(expandCmd('"echo \\${42:::node -e process.exit(42)}" foo bar baz qux 2>&1'));
    expect(result).toBeGreaterThan(0);  // Linux always exits with 2.
  });

  it('should support `--gkcu-` arguments', async () => {
    // debug
    let result = await expandCmd('"echo $1 \\${2:bar} ${3:::echo baz}" foo --gkcu-debug');
    expect(result).toBe(
      'Input command: \'echo baz\'\n' +
      'Expanded command: \'echo baz\'\n' +
      '  Running 1/1: \'echo\', \'baz\', (stdio: inherit,pipe,inherit)\n' +
      'echo foo bar baz');

    // dryrun
    result = await expandCmd('"echo $1 \\${2:bar} ${3:::echo baz}" --gkcu-dryrun foo');
    expect(result).toBe('echo foo bar {{echo_baz}}');

    // returnOutput=n in sub-command
    const subCmd = 'node -p \\"\'blah\\nblah\\nbaz\'\\" --gkcu-returnOutput=2';
    result = await expandCmd(`"echo $1 \\\${2:bar} \${3:::${subCmd}}" foo`);
    expect(result).toBe('blah\nblah\nbaz\necho foo bar blah\nbaz');
  });
}));
