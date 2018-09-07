'use strict';

// Imports
const childProcess = require('child_process');
const commandUtils = require('../../lib/command-utils');
const utils = require('../../lib/internal-utils');
const processUtils = require('../../lib/process-utils');
const {reversePromise, tickAsPromised} = require('../test-utils');

// Tests
describe('runner', () => {
  describe('.expandCmd()', () => {
    const expandCmd = commandUtils.expandCmd;
    let cmd;
    let runtimeArgs;
    let config;

    beforeEach(() => {
      cmd = 'foo --bar';
      runtimeArgs = ['baz', '"q u x"'];
      config = {quux: 'quuux'};
    });

    it('should be a function', () => {
      expect(expandCmd).toEqual(jasmine.any(Function));
    });

    it('should return a promise', async () => {
      const promise = expandCmd(cmd, runtimeArgs, config);
      expect(promise).toEqual(jasmine.any(Promise));

      await promise;
    });

    it('should return the command unchanged if there is nothing to expand', async () => {
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);
      expect(expandedCmd).toBe(cmd);
    });

    it('should remove argument placeholders if there are no corresponding arguments', async () => {
      cmd = 'foo $1 --bar ${2} $k $* $$ ${*} || _$* && $3*-${3*}';
      const expandedCmd = await expandCmd(cmd, [], config);

      expect(expandedCmd).toBe('foo --bar $k $$ || _ &&-');
    });

    it('should replace all occurences of `$*`/`${*}` with all arguments', async () => {
      cmd = 'foo $* | ${*} | $* | ${*}';
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

      expect(expandedCmd).toBe('foo baz "q u x" | baz "q u x" | baz "q u x" | baz "q u x"');
    });

    it('should replace all occurences of `$n*`/`${n*}` with all arguments (starting at `n`)', async () => {
      cmd = 'foo $1* | ${1*} | $2* | ${2*} | $33* | ${33*}';
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

      expect(expandedCmd).toBe('foo baz "q u x" | baz "q u x" | "q u x" | "q u x" | |');
    });

    it('should replace all occurrences of `$n`/`${n}` with the nth argument (1-based index)', async () => {
      cmd = 'foo $2 | ${2} | $1 | ${1}';
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

      expect(expandedCmd).toBe('foo "q u x" | "q u x" | baz | baz');
    });

    it('should always treat `$0`/`${0}` as not having an associated argument', async () => {
      cmd = 'foo $0 | $1 | ${0}';
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

      expect(expandedCmd).toBe('foo | baz |');
    });

    it('should not recognize `$0*`/`${0*}`', async () => {
      cmd = 'foo $0* | $1* | ${0*} | ${2*}';
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

      expect(expandedCmd).toBe('foo* | baz "q u x" | ${0*} | "q u x"');
    });

    it('should match escaped `$` (and remove leading `\\`)', async () => {
      cmd = 'foo \\$* | \\${*} | \\$1* | \\${2*} | \\$2 | \\${1} | \\$0 | \\${0}';
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

      expect(expandedCmd).toBe('foo baz "q u x" | baz "q u x" | baz "q u x" | "q u x" | "q u x" | baz | |');
    });

    it('should recognize argument placeholders even if not preceded by whitespace', async () => {
      cmd = 'foo .$1. | -${2}- | 1$1*1 | 4${2*}4 | p$*p | $${*}$';
      const expectedCmd = 'foo .baz. | -"q u x"- | 1baz "q u x"1 | 4"q u x"4 | pbaz "q u x"p | $baz "q u x"$';
      const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

      expect(expandedCmd).toBe(expectedCmd);
    });

    describe('(with static fallback values)', () => {
      it('should ignore fallback values if actual values passed as arguments', async () => {
        cmd = 'foo ${2:two} | ${2*:all-skip-1} | ${*:all}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo "q u x" | "q u x" | baz "q u x"');
      });

      it('should use fallback values if actual values not passed for specific argument', async () => {
        cmd = 'foo ${3:three} | ${1*:all-skip-0} | ${3*:all-skip-2} | ${*:all}';

        const expandedCmd1 = await expandCmd(cmd, runtimeArgs, config);
        expect(expandedCmd1).toBe('foo three | baz "q u x" | all-skip-2 | baz "q u x"');

        const expandedCmd2 = await expandCmd(cmd, [], config);
        expect(expandedCmd2).toBe('foo three | all-skip-0 | all-skip-2 | all');
      });

      it('should always use fallback values for `$0`/`${0}`', async () => {
        cmd = 'foo ${0:zero} | ${1} | ${0*:ooops} | $* | "${0:nil}"';

        const expandedCmd1 = await expandCmd(cmd, runtimeArgs, config);
        expect(expandedCmd1).toBe('foo zero | baz | ${0*:ooops} | baz "q u x" | "nil"');

        const expandedCmd2 = await expandCmd(cmd, [], config);
        expect(expandedCmd2).toBe('foo zero | | ${0*:ooops} | | "nil"');
      });

      it('should allow using "`" in fallback values (as long as not starting and ending with "`")', async () => {
        cmd = 'foo ${3:t`h`r`e`e} | ${4:```4} | ${5:5````}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo t`h`r`e`e | ```4 | 5````');
      });
    });

    describe('(with commands as fallback values)', () => {
      beforeEach(() => {
        spyOn(commandUtils, 'spawnAsPromised').and.callFake(rawCmd => Promise.resolve(`{{${rawCmd}}}`));
      });

      it('should recognize fallback values wrapped in "|" as commands', async () => {
        cmd = 'foo ${3:::three}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{three}}');
        expect(commandUtils.spawnAsPromised).toHaveBeenCalledWith('three', jasmine.any(Object));
      });

      it('should not call the fallback command if not necessary', async () => {
        cmd = 'foo ${1:::three}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo baz');
        expect(commandUtils.spawnAsPromised).not.toHaveBeenCalled();
      });

      it('should replace all occurrences', async () => {
        cmd = 'foo ${3:::three} ${3:::three} ${2*:::all-skip-1} ${2*:::all-skip-1} ${*:::all} ${*:::all}';
        const expectedCmd = 'foo {{three}} {{three}} {{all-skip-1}} {{all-skip-1}} {{all}} {{all}}';
        const expandedCmd = await expandCmd(cmd, [], config);

        expect(expandedCmd).toBe(expectedCmd);
      });

      it('should not call a fallback command more than once (but reuse the result)', async () => {
        cmd = 'foo ${3:::three} ${3:::three} ${4:::three} ${4:::four}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{three}} {{three}} {{three}} {{four}}');
        expect(commandUtils.spawnAsPromised).toHaveBeenCalledTimes(2);
      });

      it('should treat empty output as non-specified value', async () => {
        commandUtils.spawnAsPromised.and.returnValue(Promise.resolve(''));

        cmd = 'foo ${3:::three} --bar ${4:::four}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo --bar');
      });

      it('should trim the fallback command output (including cursor move ANSI escape sequences)', async () => {
        const output = ' \n\u001b[1a\r\u001B[987B\t {{test}} \t\u001b[23C\r\u001B[00d\n ';
        commandUtils.spawnAsPromised.and.returnValue(Promise.resolve(output));

        cmd = 'foo ${3:::three} --bar ${4:::four}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{test}} --bar {{test}}');
      });

      it('should call `spawnAsPromised()` with `returnOutput: true` (but not affect the original config)',
        async () => {
          cmd = 'foo ${3:::three}';
          config.returnOutput = false;

          await expandCmd(cmd, runtimeArgs, config);

          expect(commandUtils.spawnAsPromised).toHaveBeenCalledWith('three', jasmine.objectContaining({
            quux: 'quuux',
            returnOutput: true,
          }));
          expect(config.returnOutput).toBe(false);
        }
      );

      it('should support setting `returnOutput: n` (with the special `--gkcu-returnOutput=n` syntax)', async () => {
        cmd = 'foo ${3:::three --gkcu-returnOutput=33}';
        config.returnOutput = false;

        await expandCmd(cmd, runtimeArgs, config);

        expect(commandUtils.spawnAsPromised).toHaveBeenCalledWith('three', jasmine.objectContaining({
          quux: 'quuux',
          returnOutput: 33,
        }));
        expect(config.returnOutput).toBe(false);
      });

      it('should not support setting `returnOutput: n` (with the `--gkcu-returnOutput n` syntax)', async () => {
        const fbCmd = 'three --gkcu-returnOutput 33';
        cmd = `foo \${3:::${fbCmd}}`;
        config.returnOutput = false;

        await expandCmd(cmd, runtimeArgs, config);

        expect(commandUtils.spawnAsPromised).toHaveBeenCalledWith(fbCmd, jasmine.objectContaining({
          quux: 'quuux',
          returnOutput: true,
        }));
        expect(config.returnOutput).toBe(false);
      });

      it('should only recognize `--gkcu-returnOutput=n` at the end (and separated by a space)', async () => {
        const fbCmd1 = 'three --gkcu-returnOutput=33 --bar';
        const fbCmd2 = 'three--gkcu-returnOutput=33';
        const cmd1 = `foo \${3:::${fbCmd1}}`;
        const cmd2 = `foo \${3:::${fbCmd2}}`;

        await expandCmd(cmd1, runtimeArgs, config);
        expect(commandUtils.spawnAsPromised).toHaveBeenCalledWith(fbCmd1, jasmine.objectContaining({
          returnOutput: true
        }));

        await expandCmd(cmd2, runtimeArgs, config);
        expect(commandUtils.spawnAsPromised).toHaveBeenCalledWith(fbCmd2, jasmine.objectContaining({
          returnOutput: true,
        }));
      });

      it('should support expanding `$*`/`$n*`/`$n` in fallback commands (with same runtime arguments)', async () => {
        cmd = 'foo ${3:::three $1 $2 $3 | $2* | $*}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{three baz "q u x" | "q u x" | baz "q u x"}}');
      });

      it('should log debug info when expanding fallback commands (in debug mode)', async () => {
        spyOn(console, 'log');

        cmd = 'foo ${3:::three $*}';

        await expandCmd(cmd, runtimeArgs, config);
        expect(console.log).not.toHaveBeenCalled();

        await expandCmd(cmd, runtimeArgs, {debug: true});
        expect(console.log).toHaveBeenCalledTimes(2);
        expect(console.log).toHaveBeenCalledWith('Input command: \'three $*\'');
        expect(console.log).toHaveBeenCalledWith('Expanded command: \'three baz "q u x"\'');
      });
    });
  });

  describe('.preprocessArgs()', () => {
    const preprocessArgs = commandUtils.preprocessArgs;

    it('should be a function', () => {
      expect(preprocessArgs).toEqual(jasmine.any(Function));
    });

    it('should return an object with `args` and `config` properties', () => {
      const rawArgs = [];
      const result = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: jasmine.any(Object),
      });

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should quote arguments with spaces', () => {
      const rawArgs = ['foo', 'bar baz', 'qux'];
      const result = jasmine.objectContaining({
        args: ['foo', '"bar baz"', 'qux'],
        config: jasmine.any(Object),
      });

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should remove `--gkcu-`-prefixed arguments', () => {
      const rawArgs = ['foo', '--gkcu-bar', 'baz', '--gkcu-qux'];
      const result = jasmine.objectContaining({
        args: ['foo', 'baz'],
        config: jasmine.any(Object),
      });

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should use `--gkcu-`-prefixed arguments to populate `config`', () => {
      const rawArgs = ['foo', '--gkcu-bar', 'baz', '--gkcu-qux'];
      const result = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: {bar: true, qux: true},
      });

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should extract values from `--gkcu-`-prefixed arguments', () => {
      const rawArgs = ['foo', '--gkcu-bar=bar-value', 'baz', '--gkcu-qux=qux-value'];
      const result = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: {bar: 'bar-value', qux: 'qux-value'},
      });

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should extract convert numeric `--gkcu-`-prefixed argument values to numbers', () => {
      const rawArgs = ['foo', '--gkcu-bar=42', 'baz', '--gkcu-qux=1337'];
      const result = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: {bar: 42, qux: 1337},
      });

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });
  });

  describe('.run()', () => {
    const run = commandUtils.run;
    let cmd;
    let runtimeArgs;
    let config;

    beforeEach(() => {
      spyOn(commandUtils, 'expandCmd').and.callFake(cmd => Promise.resolve(`expanded:${cmd}`));
      spyOn(commandUtils, 'spawnAsPromised').and.returnValue(Promise.resolve(''));

      cmd = 'foo --bar';
      runtimeArgs = ['baz', '--qux'];
      config = {quux: 'quuux'};
    });

    it('should be a function', () => {
      expect(run).toEqual(jasmine.any(Function));
    });

    it('should return a promise', async () => {
      const promise = run('');
      expect(promise).toEqual(jasmine.any(Promise));

      await promise;
    });

    it('should expand the command', async () => {
      await run(cmd, runtimeArgs, config);
      expect(commandUtils.expandCmd).toHaveBeenCalledWith(cmd, runtimeArgs, config);
    });

    it('should default to `[]` for `runtimeArgs`', async () => {
      await run(cmd, null, config);
      expect(commandUtils.expandCmd).toHaveBeenCalledWith(cmd, [], config);
    });

    it('should default to `{}` for `config`', async () => {
      await run(cmd, runtimeArgs, null);
      expect(commandUtils.expandCmd).toHaveBeenCalledWith(cmd, runtimeArgs, {});
    });

    it('should call `spawnAsPromised()` (with the expanded command)', async () => {
      await run(cmd, runtimeArgs, config);
      expect(commandUtils.spawnAsPromised).toHaveBeenCalledWith(`expanded:${cmd}`, config);
    });

    it('should log debug info (in debug mode)', async () => {
      spyOn(console, 'log');

      await run(cmd, runtimeArgs, config);
      expect(console.log).not.toHaveBeenCalled();

      await run(cmd, runtimeArgs, {debug: true});
      expect(console.log).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(`Input command: '${cmd}'`);
      expect(console.log).toHaveBeenCalledWith(`Expanded command: 'expanded:${cmd}'`);
    });

    it('should pass errors to `utils.onError()`', async () => {
      commandUtils.expandCmd.and.returnValues(Promise.reject('expandCmd error'), Promise.resolve(''));
      commandUtils.spawnAsPromised.and.returnValue(Promise.reject('spawnAsPromised error'));

      const rejections = await Promise.all([
        reversePromise(run(cmd, runtimeArgs, config)),
        reversePromise(run(cmd, runtimeArgs, config)),
      ]);

      expect(commandUtils.expandCmd).toHaveBeenCalledTimes(2);
      expect(commandUtils.spawnAsPromised).toHaveBeenCalledTimes(1);
      expect(rejections).toEqual(['expandCmd error', 'spawnAsPromised error']);
    });
  });

  describe('.spawnAsPromised()', () => {
    const spawnAsPromised = commandUtils.spawnAsPromised;
    const createMockProcess = jsmn =>
      Object.assign(new childProcess.ChildProcess(), {
        stdin: {},
        stdout: {pipe: jsmn.createSpy('mockProcess.stdout.pipe')},
      });
    let spawned;
    let autoExitSpawned;
    let anyObj;
    let rawCmd;
    let config;

    beforeEach(() => {
      let spawnedIndex = -1;
      spawned = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => createMockProcess(jasmine));

      spyOn(childProcess, 'spawn').and.callFake(() => {
        const proc = spawned[++spawnedIndex];

        if (!proc) {
          throw new Error('Ran out of pre-spawned MockChildProcesses.');
        } else if (autoExitSpawned) {
          Promise.resolve().then(() => proc.emit('exit', 0));
        }

        return proc;
      });

      autoExitSpawned = true;
      anyObj = jasmine.any(Object);
      rawCmd = 'foo --bar';
      config = {};
    });

    it('should be a function', () => {
      expect(spawnAsPromised).toEqual(jasmine.any(Function));
    });

    it('should return a promise', async () => {
      const promise = spawnAsPromised(rawCmd, config);
      expect(promise).toEqual(jasmine.any(Promise));

      await promise;
    });

    it('should spawn a process for the specified command', async () => {
      await spawnAsPromised(rawCmd, config);
      expect(childProcess.spawn).toHaveBeenCalledWith('foo', ['--bar'], jasmine.any(Object));
    });

    it('should parse the specified command (respecting double-quoted values)', async () => {
      await spawnAsPromised('foo1     "bar1" --baz1 --qux1="foo bar" "baz qux 1"', config);

      const parsedArgs1 = ['"bar1"', '--baz1', '--qux1="foo bar"', '"baz qux 1"'];
      expect(childProcess.spawn).toHaveBeenCalledWith('foo1', parsedArgs1, anyObj);

      await spawnAsPromised('"foo2"     "bar2" --baz2 --qux2="foo bar" "baz qux 2"', config);

      const parsedArgs2 = ['"bar2"', '--baz2', '--qux2="foo bar"', '"baz qux 2"'];
      expect(childProcess.spawn).toHaveBeenCalledWith('"foo2"', parsedArgs2, anyObj);
    });

    it('should support command "piping" (and spawn a process for each command)', async () => {
      await spawnAsPromised('foo bar | bar "baz" | "baz" qux | qux "q u u x"', config);

      expect(childProcess.spawn).toHaveBeenCalledTimes(4);

      expect(childProcess.spawn.calls.argsFor(0)).toEqual(['foo', ['bar'], anyObj]);
      expect(childProcess.spawn.calls.argsFor(1)).toEqual(['bar', ['"baz"'], anyObj]);
      expect(childProcess.spawn.calls.argsFor(2)).toEqual(['"baz"', ['qux'], anyObj]);
      expect(childProcess.spawn.calls.argsFor(3)).toEqual(['qux', ['"q u u x"'], anyObj]);

      expect(spawned[0].stdout.pipe.calls.argsFor(0)[0]).toBe(spawned[1].stdin);
      expect(spawned[1].stdout.pipe.calls.argsFor(0)[0]).toBe(spawned[2].stdin);
      expect(spawned[2].stdout.pipe.calls.argsFor(0)[0]).toBe(spawned[3].stdin);
    });

    it('should use appropriate values for `stdio`', async () => {
      await spawnAsPromised(rawCmd, config);

      const expectedStdio1 = ['inherit', 'inherit', 'inherit'];
      expect(childProcess.spawn.calls.argsFor(0)[2].stdio).toEqual(expectedStdio1);

      childProcess.spawn.calls.reset();

      await spawnAsPromised('foo bar | bar "baz" | "baz" qux | qux "q u u x"', config);

      const expectedStdio2 = [
        ['inherit', 'pipe', 'inherit'],
        ['pipe', 'pipe', 'inherit'],
        ['pipe', 'pipe', 'inherit'],
        ['pipe', 'inherit', 'inherit'],
      ];
      expect(childProcess.spawn.calls.argsFor(0)[2].stdio).toEqual(expectedStdio2[0]);
      expect(childProcess.spawn.calls.argsFor(1)[2].stdio).toEqual(expectedStdio2[1]);
      expect(childProcess.spawn.calls.argsFor(2)[2].stdio).toEqual(expectedStdio2[2]);
      expect(childProcess.spawn.calls.argsFor(3)[2].stdio).toEqual(expectedStdio2[3]);
    });

    it('should register a clean-up callback', async () => {
      const doOnExitSpy = spyOn(processUtils, 'doOnExit').and.callThrough();
      await spawnAsPromised(rawCmd, config);

      expect(doOnExitSpy).toHaveBeenCalledWith(process, jasmine.any(Function));
    });

    it('should suppress "Terminate batch job (Y/N)?" confirmation on Windows with `suppressTbj: true`', async () => {
      const suppressTbjConfirmationSpy = spyOn(processUtils, 'suppressTerminateBatchJobConfirmation').and.callThrough();

      await spawnAsPromised(rawCmd, config);
      expect(suppressTbjConfirmationSpy).not.toHaveBeenCalled();

      await spawnAsPromised(rawCmd, {suppressTbj: false});
      expect(suppressTbjConfirmationSpy).not.toHaveBeenCalled();

      await spawnAsPromised(rawCmd, {suppressTbj: true});
      expect(suppressTbjConfirmationSpy).toHaveBeenCalledWith(process);
    });

    describe('returned promise', () => {
      const expectNotToHaveCleanedUp = () => {
        expect(cancelCleanUpSpy).not.toHaveBeenCalled();
        expect(unsuppressTbjSpy).not.toHaveBeenCalled();
      };
      const expectToHaveCleanedUp = (times = 1) => {
        // TODO(gkalpak): Verify that besides cancelling automatic clean-up, it does indeed clean up.
        expect(cancelCleanUpSpy).toHaveBeenCalledTimes(times);
        expect(unsuppressTbjSpy).toHaveBeenCalledTimes(times);

        cancelCleanUpSpy.calls.reset();
        unsuppressTbjSpy.calls.reset();
      };
      let cancelCleanUpSpy;
      let unsuppressTbjSpy;

      beforeEach(() => {
        cancelCleanUpSpy = jasmine.createSpy('cancelCleanUp');
        unsuppressTbjSpy = spyOn(utils, 'noop');

        spyOn(processUtils, 'doOnExit').and.returnValue(cancelCleanUpSpy);

        autoExitSpawned = false;
      });

      it('should be rejected if a spawned process exits with error (single command)', async () => {
        const promise = reversePromise(spawnAsPromised(rawCmd, config));
        spawned[0].emit('exit', 1);

        expect(await promise).toBe(1);
        expectToHaveCleanedUp();
      });

      it('should be rejected if a spawned process errors (single command)', async () => {
        const promise = reversePromise(spawnAsPromised(rawCmd, config));
        spawned[0].emit('error', 'Test');

        expect(await promise).toBe('Test');
        expectToHaveCleanedUp();
      });

      it('should be rejected if a spawned process exits with error (piped command)', async () => {
        const promise = Promise.all([
          reversePromise(spawnAsPromised('foo | bar | baz', config)),
          reversePromise(spawnAsPromised('foo | bar | baz', config)),
          reversePromise(spawnAsPromised('foo | bar | baz', config)),
        ]);

        spawned[0].emit('exit', 1);
        spawned[4].emit('exit', 2);
        spawned[8].emit('exit', null, 'SIGNAL');

        expect(await promise).toEqual([1, 2, 'SIGNAL']);
        expectToHaveCleanedUp(3);
      });

      it('should be rejected if a spawned process errors (piped command)', async () => {
        const promise = Promise.all([
          reversePromise(spawnAsPromised('foo | bar | baz', config)),
          reversePromise(spawnAsPromised('foo | bar | baz', config)),
          reversePromise(spawnAsPromised('foo | bar | baz', config)),
        ]);

        spawned[0].emit('error', 'Test0');
        spawned[4].emit('error', 'Test1');
        spawned[8].emit('error', 'Test2');

        expect(await promise).toEqual(['Test0', 'Test1', 'Test2']);
        expectToHaveCleanedUp(3);
      });

      it('should be resolved when all spawned processes complete (single command)', async () => {
        const resolved = jasmine.createSpy('resolved');

        spawnAsPromised(rawCmd, config).then(resolved);

        // The promise's success handlers are executed asynchronously.
        await tickAsPromised();
        expect(resolved).not.toHaveBeenCalled();
        expectNotToHaveCleanedUp();

        spawned[0].emit('exit', 0);
        expect(resolved).not.toHaveBeenCalled();
        expectNotToHaveCleanedUp();

        await tickAsPromised();
        expect(resolved).toHaveBeenCalledWith('');
        expectToHaveCleanedUp();
      });

      it('should be resolved when all spawned processes complete (piped commands)', async () => {
        const resolved = jasmine.createSpy('resolved');

        spawnAsPromised('foo | bar | baz', config).then(resolved);

        // The promise's success handlers are executed asynchronously.
        await tickAsPromised();
        spawned[0].emit('exit', 0);
        spawned[1].emit('exit', 0);
        expect(resolved).not.toHaveBeenCalled();
        expectNotToHaveCleanedUp();

        await tickAsPromised();
        spawned[2].emit('exit', 0);
        expect(resolved).not.toHaveBeenCalled();
        expectNotToHaveCleanedUp();

        await tickAsPromised();
        expect(resolved).toHaveBeenCalledWith('');
        expectToHaveCleanedUp();
      });
    });
  });
});
