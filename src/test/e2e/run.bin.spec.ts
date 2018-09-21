import {join} from 'path';
import {testingUtils} from '../../lib/testing-utils';
import {IS_WINDOWS, reversePromise, ROOT_DIR} from '../test-utils';


describe('bin/run', testingUtils.withJasmineTimeout(30000, () => {
  const scriptPath = join(ROOT_DIR, 'bin/run');
  const testScript = testingUtils.testScriptFactory(scriptPath);
  const unescapeDollars = (str: string) => str.replace(/\\\$/g, '$$');
  const runCmd = (argsStr = '') => {
    if (!IS_WINDOWS) {
      // On non-Windows platforms, escape `$` (unless already escaped).
      argsStr = unescapeDollars(argsStr).replace(/\$/g, '\\$$');
    }

    return testScript(argsStr, {sapVersion: 2});
  };

  it('should execute the command', async () => {
    const result = await runCmd('"echo foo bar"');
    expect(result).toBe('foo bar');
  });

  it('should correctly expand `$*`/`${*}`', async () => {
    let result = await runCmd('"echo $* \\${*:bar}"');
    expect(result).toBe('bar');

    result = await runCmd('"echo $* \\${*:bar}" foo');
    expect(result).toBe('foo foo');

    result = await runCmd('"echo $* \\${*:bar}" foo bar');
    expect(result).toBe('foo bar foo bar');
  });

  it('should correctly expand `$n*`/`${n*}`', async () => {
    let result = await runCmd('"echo $1* \\${2*:bar}"');
    expect(result).toBe('bar');

    result = await runCmd('"echo $1* \\${2*:bar}" foo');
    expect(result).toBe('foo bar');

    result = await runCmd('"echo $1* \\${2*:bar}" foo baz');
    expect(result).toBe('foo baz baz');
  });

  it('should correctly expand `$n`/`${n}`', async () => {
    let result = await runCmd('"echo $1 ${2:bar} \\$1 \\${2:baz}" foo');
    expect(result).toBe('foo bar foo baz');

    result = await runCmd('"echo $1 ${2:bar} \\$1 \\${2:baz}" foo qux');
    expect(result).toBe('foo qux foo qux');
  });

  it('should always substitute `${0}`', async () => {
    let result = await runCmd('"echo ${0:foo} \\${0:bar}"');
    expect(result).toBe('foo bar');

    result = await runCmd('"echo ${0:foo} \\${0:bar}" baz qux');
    expect(result).toBe('foo bar');
  });

  it('should correctly run fallback commands (only if necessary)', async () => {
    let result = await runCmd('"echo ${*:::exit 1} \\${2:::echo bar}" foo');
    expect(result).toBe('foo bar');

    result = await runCmd('"echo \\${0:::node -p \\"process.platform\\"}" foo');
    expect(result).toBe(process.platform);
  });

  it('should fail if the command (or any sub-command) fails', async () => {
    // Use `2>&1` to suppress stderr output in test results.
    let result = await reversePromise(runCmd('"node -e process.exit(${42:42})" foo bar baz qux 2>&1'));
    expect(result).toBeGreaterThan(0);  // Linux always exits with 2.

    // Use `2>&1` to suppress stderr output in test results.
    result = await reversePromise(runCmd('"echo \\${1337:::node -e process.exit(1337)}" foo bar baz qux 2>&1'));
    expect(result).toBeGreaterThan(0);  // Linux always exits with 2.
  });

  it('should support piped commands', async () => {
    const out = 'process.stdout';
    const pipeCmd = `node --eval \\"${out}.write('piped:'),process.stdin.on('data', ${out}.write.bind(${out}))\\"`;

    let result = await runCmd(`"echo foo | ${pipeCmd}"`);
    expect(result).toBe('piped:foo');

    result = await runCmd(`"echo $1 \\\${2*:bar} | ${pipeCmd}" foo`);
    expect(result).toBe('piped:foo bar');

    result = await runCmd(`"echo \${0:::echo foo} bar \${1:baz} | ${pipeCmd}" qux`);
    expect(result).toBe('piped:foo bar qux');

    result = await runCmd(`"echo foo \${0:::echo bar | ${pipeCmd}}"`);
    expect(result).toBe('foo piped:bar');
  });

  it('should support `--gkcu-` arguments (sapVersion: 1)', async () => {
    // debug
    let result = await runCmd('"echo $1 \\${2:bar} ${3:::echo baz}" foo --gkcu-debug');
    expect(unescapeDollars(result)).toBe(
      '[debug] Input command: \'echo baz\'\n' +
      '[debug] Expanded command: \'echo baz\'\n' +
      '[debug]   Running 1/1: \'echo\', \'baz\'\n' +
      '[debug]     (sapVersion: 1, stdio: inherit, pipe, inherit)\n' +
      '[debug] Input command: \'echo $1 ${2:bar} ${3:::echo baz}\'\n' +
      '[debug] Expanded command: \'echo foo bar baz\'\n' +
      '[debug]   Running 1/1: \'echo\', \'foo, bar, baz\'\n' +
      '[debug]     (sapVersion: 1, stdio: inherit, inherit, inherit)\n' +
      'foo bar baz\n' +
      '[debug]   Reseting the output and cursor styles.');

    // dryrun
    result = await runCmd('"echo $1 \\${2:bar} ${3:::echo baz}" --gkcu-dryrun foo');
    expect(result).toBe('echo foo bar {{echo_baz}}');

    // returnOutput
    result = await runCmd('"node -p \\"\'$1\\n\\${2:bar}\\n${3:::echo baz}\'\\"" foo --gkcu-returnOutput');
    expect(result).toBe('');

    // returnOutput=n
    result = await runCmd('"node -p \\"\'$1\\n\\${2:bar}\\n${3:::echo baz}\'\\"" --gkcu-returnOutput=2 foo');
    expect(result).toBe('foo\nbar\nbaz');

    // returnOutput=n in sub-command
    const subCmd1 = 'node -p \\"\'foo\\nbar\\nbaz\'\\" --gkcu-returnOutput=1';
    result = await runCmd(`"node -p \\"'\${*:::${subCmd1}}'\\""`);
    expect(result).toBe('foo\nbar\nbaz\nbaz');

    // returnOutput=n in multiple sub-command
    const subCmd2 = 'node -p \\"\'foo\\nbar\\nbaz\'\\" --gkcu-returnOutput=1';
    result = await runCmd(`"node -p \\"'\${*:::${subCmd2}} \${*:::${subCmd2}}'\\""`);
    expect(result).toBe('foo\nbar\nbaz\nbaz baz');
  });

  it('should support `--gkcu-` arguments (sapVersion: 2)', async () => {
    // debug
    let result = await runCmd('"echo $1 \\${2:bar} ${3:::echo baz}" foo --gkcu-debug --gkcu-sapVersion=2');
    expect(unescapeDollars(result)).toBe(
      '[debug] Input command: \'echo baz\'\n' +
      '[debug] Expanded command: \'echo baz\'\n' +
      '[debug]   Running 1/1: \'echo baz\', \'\'\n' +
      '[debug]     (sapVersion: 2, stdio: inherit, pipe, inherit)\n' +
      '[debug] Input command: \'echo $1 ${2:bar} ${3:::echo baz}\'\n' +
      '[debug] Expanded command: \'echo foo bar baz\'\n' +
      '[debug]   Running 1/1: \'echo foo bar baz\', \'\'\n' +
      '[debug]     (sapVersion: 2, stdio: inherit, inherit, inherit)\n' +
      'foo bar baz\n' +
      '[debug]   Reseting the output and cursor styles.');

    // dryrun
    result = await runCmd('"echo $1 \\${2:bar} ${3:::echo baz}" --gkcu-sapVersion=2 --gkcu-dryrun foo');
    expect(result).toBe('echo foo bar {{echo_baz}}');

    // returnOutput
    result = await runCmd(
      '"node -p \\"\'$1\\n\\${2:bar}\\n${3:::echo baz}\'\\"" foo --gkcu-returnOutput --gkcu-sapVersion=2');
    expect(result).toBe('');

    // returnOutput=n
    result = await runCmd(
      '"node -p \\"\'$1\\n\\${2:bar}\\n${3:::echo baz}\'\\"" --gkcu-sapVersion=2 --gkcu-returnOutput=2 foo');
    expect(result).toBe('foo\nbar\nbaz');

    // returnOutput=n in sub-command
    const subCmd = 'node -p \\"\'foo\\nbar\\nbaz\'\\" --gkcu-returnOutput=1';
    result = await runCmd(`"node -p \\"'\${*:::${subCmd}}'\\"" --gkcu-sapVersion=2`);
    expect(result).toBe('foo\nbar\nbaz\nbaz');

    // returnOutput=n in multiple sub-command
    const subCmd2 = 'node -p \\"\'foo\\nbar\\nbaz\'\\" --gkcu-returnOutput=1';
    result = await runCmd(`"node -p \\"'\${*:::${subCmd2}} \${*:::${subCmd2}}'\\"" --gkcu-sapVersion=2`);
    expect(result).toBe('foo\nbar\nbaz\nbaz baz');
  });
}));
