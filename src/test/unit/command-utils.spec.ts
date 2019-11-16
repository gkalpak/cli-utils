import * as chalk from 'chalk';
import * as childProcess from 'child_process';
import {Writable} from 'stream';
import {commandUtils, IRunConfig} from '../../lib/command-utils';
import {internalUtils} from '../../lib/internal-utils';
import {processUtils} from '../../lib/process-utils';
import {reversePromise, tickAsPromised} from '../test-utils';


describe('runner', () => {
  describe('.expandCmd()', () => {
    const expandCmd: typeof commandUtils.expandCmd = commandUtils.expandCmd.bind(commandUtils);
    let cmd: string;
    let runtimeArgs: string[];
    let config: IRunConfig;

    beforeEach(() => {
      cmd = 'foo --bar';
      runtimeArgs = ['baz', '"q u x"'];
      config = {quux: 'quuux'} as any;
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

      it('should allow using starting fallback values with `::` when quoted', async () => {
        cmd = 'foo ${3:"::three"} | ${4:\'::4\'}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo "::three" | \'::4\'');
      });
    });

    describe('(with commands as fallback values)', () => {
      let cuSpawnAsPromisedSpy: jasmine.Spy;

      beforeEach(() => {
        cuSpawnAsPromisedSpy = spyOn(commandUtils, 'spawnAsPromised').and.
          callFake((rawCmd: string) => Promise.resolve(`{{${rawCmd}}}`));
      });

      it('should recognize fallback values starting with "::" as commands', async () => {
        cmd = 'foo ${3:::three}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{three}}');
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith('three', jasmine.any(Object));
      });

      it('should not call the fallback command if not necessary', async () => {
        cmd = 'foo ${1:::three}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo baz');
        expect(cuSpawnAsPromisedSpy).not.toHaveBeenCalled();
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
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledTimes(2);
      });

      it('should correctly handle occurrences of a fallback command with different leading whitespace', async () => {
        cmd = 'foo ${3:::three} /path/to/${3:::three}   ${3:::three}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{three}} /path/to/{{three}}   {{three}}');
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledTimes(1);
      });

      it('should treat empty output as non-specified value', async () => {
        cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve(''));

        cmd = 'foo ${3:::three} --bar ${4:::four}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo --bar');
      });

      it('should trim the fallback command output (including cursor move ANSI escape sequences)', async () => {
        const output = ' \n\u001b[1a\r\u001B[987B\t {{test}} \t\u001b[23C\r\u001B[00d\n ';
        cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve(output));

        cmd = 'foo ${3:::three} --bar ${4:::four}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{test}} --bar {{test}}');
      });

      it('should call `spawnAsPromised()` with `returnOutput: true` (but not affect the original config)', async () => {
        cmd = 'foo ${3:::three}';
        config.returnOutput = false;

        await expandCmd(cmd, runtimeArgs, config);

        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith('three', jasmine.objectContaining({
          quux: 'quuux',
          returnOutput: true,
        }));
        expect(config.returnOutput).toBe(false);
      });

      it('should support setting `returnOutput: n` (with the special `--gkcu-returnOutput=n` syntax)', async () => {
        cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve('.\n'.repeat(50)));
        cmd = 'foo ${3:::three --gkcu-returnOutput=33}';
        config.returnOutput = false;

        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe(`foo ${'.\n'.repeat(33).trim()}`);
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith('three', jasmine.objectContaining({
          quux: 'quuux',
          returnOutput: Infinity,
        }));
        expect(config.returnOutput).toBe(false);
      });

      it('should support setting `returnOutput: n` (with the special `--gkcu-returnOutput=n` syntax)', async () => {
        cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve('.\n'.repeat(50)));
        cmd = 'foo ${3:::three --gkcu-returnOutput=33}';
        config.returnOutput = false;

        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe(`foo ${'.\n'.repeat(33).trim()}`);
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith('three', jasmine.objectContaining({
          quux: 'quuux',
          returnOutput: Infinity,
        }));
        expect(config.returnOutput).toBe(false);
      });

      it('should correctly handle occurrences of a fallback command with different `returnOutput` values', async () => {
        const dots = (count: number) => '.\n'.repeat(count).trim();

        cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve(dots(10)));
        cmd = 'foo ${3:::three} ${3:::three --gkcu-returnOutput=4} ${3:::three --gkcu-returnOutput=2}';
        config.returnOutput = false;

        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe(`foo ${dots(10)} ${dots(4)} ${dots(2)}`);
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledTimes(1);
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith('three', jasmine.objectContaining({
          quux: 'quuux',
          returnOutput: Infinity,
        }));
        expect(config.returnOutput).toBe(false);
      });

      it('should not support setting `returnOutput: n` (with the `--gkcu-returnOutput n` syntax)', async () => {
        const fbCmd = 'three --gkcu-returnOutput 33';
        cmd = `foo \${3:::${fbCmd}}`;
        config.returnOutput = false;

        await expandCmd(cmd, runtimeArgs, config);

        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith(fbCmd, jasmine.objectContaining({
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
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith(fbCmd1, jasmine.objectContaining({
          returnOutput: true,
        }));

        await expandCmd(cmd2, runtimeArgs, config);
        expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith(fbCmd2, jasmine.objectContaining({
          returnOutput: true,
        }));
      });

      it('should support expanding `$*`/`$n*`/`$n` in fallback commands (with same runtime arguments)', async () => {
        cmd = 'foo ${3:::three $1 $2 $3 | $2* | $*}';
        const expandedCmd = await expandCmd(cmd, runtimeArgs, config);

        expect(expandedCmd).toBe('foo {{three baz "q u x" | "q u x" | baz "q u x"}}');
      });

      it('should log debug info when expanding fallback commands (in debug mode)', async () => {
        const consoleDebugSpy = spyOn(console, 'debug');

        cmd = 'foo ${3:::three $*}';

        await expandCmd(cmd, runtimeArgs, config);
        expect(consoleDebugSpy).not.toHaveBeenCalled();

        await expandCmd(cmd, runtimeArgs, {debug: true});
        expect(consoleDebugSpy).toHaveBeenCalledTimes(2);
        expect(consoleDebugSpy).toHaveBeenCalledWith(chalk.gray('[debug] Input command: \'three $*\''));
        expect(consoleDebugSpy).toHaveBeenCalledWith(chalk.gray('[debug] Expanded command: \'three baz "q u x"\''));
      });
    });
  });

  describe('.preprocessArgs()', () => {
    const preprocessArgs: typeof commandUtils.preprocessArgs = commandUtils.preprocessArgs.bind(commandUtils);

    it('should be a function', () => {
      expect(preprocessArgs).toEqual(jasmine.any(Function));
    });

    it('should return an object with `args` and `config` properties', () => {
      const rawArgs: string[] = [];
      const result: ReturnType<typeof preprocessArgs> = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: jasmine.any(Object),
      }) as any;

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should quote arguments with spaces', () => {
      const rawArgs = ['foo', 'bar baz', 'qux'];
      const result: ReturnType<typeof preprocessArgs> = jasmine.objectContaining({
        args: ['foo', '"bar baz"', 'qux'],
        config: jasmine.any(Object),
      }) as any;

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should remove `--gkcu-`-prefixed arguments', () => {
      const rawArgs = ['foo', '--gkcu-bar', 'baz', '--gkcu-qux'];
      const result: ReturnType<typeof preprocessArgs> = jasmine.objectContaining({
        args: ['foo', 'baz'],
        config: jasmine.any(Object),
      }) as any;

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should use `--gkcu-`-prefixed arguments to populate `config`', () => {
      const rawArgs = ['foo', '--gkcu-bar', 'baz', '--gkcu-qux'];
      const result: ReturnType<typeof preprocessArgs> = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: {bar: true, qux: true},
      }) as any;

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should extract values from `--gkcu-`-prefixed arguments', () => {
      const rawArgs = ['foo', '--gkcu-bar=bar-value', 'baz', '--gkcu-qux=qux-value'];
      const result: ReturnType<typeof preprocessArgs> = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: {bar: 'bar-value', qux: 'qux-value'},
      }) as any;

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });

    it('should extract convert numeric `--gkcu-`-prefixed argument values to numbers', () => {
      const rawArgs = ['foo', '--gkcu-bar=42', 'baz', '--gkcu-qux=1337'];
      const result: ReturnType<typeof preprocessArgs> = jasmine.objectContaining({
        args: jasmine.any(Array),
        config: {bar: 42, qux: 1337},
      }) as any;

      expect(preprocessArgs(rawArgs)).toEqual(result);
    });
  });

  describe('.run()', () => {
    const run: typeof commandUtils.run = commandUtils.run.bind(commandUtils);
    let cmd: string;
    let runtimeArgs: string[];
    let config: IRunConfig;
    let cuExpandCmdSpy: jasmine.Spy;
    let cuSpawnAsPromisedSpy: jasmine.Spy;

    beforeEach(() => {
      cmd = 'foo --bar';
      runtimeArgs = ['baz', '--qux'];
      config = {quux: 'quuux'} as any;

      cuExpandCmdSpy = spyOn(commandUtils, 'expandCmd').and.
        callFake((rawCmd: string) => Promise.resolve(`expanded:${rawCmd}`));
      cuSpawnAsPromisedSpy = spyOn(commandUtils, 'spawnAsPromised').and.returnValue(Promise.resolve(''));
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
      expect(cuExpandCmdSpy).toHaveBeenCalledWith(cmd, runtimeArgs, config);
    });

    it('should default to `[]` for `runtimeArgs`', async () => {
      await run(cmd);
      expect(cuExpandCmdSpy).toHaveBeenCalledWith(cmd, [], jasmine.any(Object));
    });

    it('should default to `{}` for `config`', async () => {
      await run(cmd, runtimeArgs);
      expect(cuExpandCmdSpy).toHaveBeenCalledWith(cmd, runtimeArgs, {});
    });

    it('should call `spawnAsPromised()` (with the expanded command)', async () => {
      await run(cmd, runtimeArgs, config);
      expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith(`expanded:${cmd}`, config);
    });

    it('should log debug info (in debug mode)', async () => {
      const consoleDebugSpy = spyOn(console, 'debug');

      await run(cmd, runtimeArgs, config);
      expect(consoleDebugSpy).not.toHaveBeenCalled();

      await run(cmd, runtimeArgs, {debug: true});
      expect(consoleDebugSpy).toHaveBeenCalledTimes(2);
      expect(consoleDebugSpy).toHaveBeenCalledWith(chalk.gray(`[debug] Input command: '${cmd}'`));
      expect(consoleDebugSpy).toHaveBeenCalledWith(chalk.gray(`[debug] Expanded command: 'expanded:${cmd}'`));
    });

    it('should pass errors to `utils.onError()`', async () => {
      cuExpandCmdSpy.and.returnValues(Promise.reject('expandCmd error'), Promise.resolve(''));
      cuSpawnAsPromisedSpy.and.returnValue(Promise.reject('spawnAsPromised error'));

      const rejections = await Promise.all([
        reversePromise(run(cmd, runtimeArgs, config)),
        reversePromise(run(cmd, runtimeArgs, config)),
      ]);

      expect(cuExpandCmdSpy).toHaveBeenCalledTimes(2);
      expect(cuSpawnAsPromisedSpy).toHaveBeenCalledTimes(1);
      expect(rejections).toEqual(['expandCmd error', 'spawnAsPromised error']);
    });
  });

  describe('.spawnAsPromised()', () => {
    const spawnAsPromised: typeof commandUtils.spawnAsPromised = commandUtils.spawnAsPromised.bind(commandUtils);
    const createMockProcess = (jsmn: typeof jasmine) =>
      Object.assign(new (childProcess as any).ChildProcess(), {
        stdin: {},
        stdout: {pipe: jsmn.createSpy('mockProcess.stdout.pipe')},
      }) as childProcess.ChildProcessWithoutNullStreams;
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
    let spawned: childProcess.ChildProcessWithoutNullStreams[];
    let autoExitSpawned: boolean;
    let anyObj: jasmine.AsymmetricMatcher<any>;
    let rawCmd: string;
    let config: IRunConfig;
    let cpSpawnSpy: jasmine.Spy;
    let puDoOnExitSpy: jasmine.Spy;
    let cancelCleanUpSpy: jasmine.Spy;
    let unsuppressTbjSpy: jasmine.Spy;

    beforeEach(() => {
      let spawnedIndex = -1;
      spawned = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(() => createMockProcess(jasmine));

      cpSpawnSpy = spyOn(childProcess, 'spawn').and.callFake(() => {
        const proc = spawned[++spawnedIndex];

        if (!proc) {
          throw new Error('Ran out of pre-spawned MockChildProcesses.');
        } else if (autoExitSpawned) {
          Promise.resolve().then(() => proc.emit('exit', 0));
        }

        return proc as any;
      });

      cancelCleanUpSpy = jasmine.createSpy('cancelCleanUp');
      unsuppressTbjSpy = spyOn(internalUtils, 'noop');

      puDoOnExitSpy = spyOn(processUtils, 'doOnExit').and.returnValue(cancelCleanUpSpy);

      autoExitSpawned = true;
      anyObj = jasmine.any(Object);
      rawCmd = 'foo --bar';
      config = {};
    });

    it('should be a function', () => {
      expect(spawnAsPromised).toEqual(jasmine.any(Function));
    });

    it('should have default value for `config`', async () => {
      await spawnAsPromised(rawCmd);
      expect(cpSpawnSpy).toHaveBeenCalledTimes(1);
    });

    it('should default to `sapVersion: 1`', async () => {
      await spawnAsPromised(rawCmd);
      expect(cpSpawnSpy).toHaveBeenCalledWith('foo', ['--bar'], anyObj);

      await spawnAsPromised(rawCmd, {suppressTbj: false});
      expect(cpSpawnSpy).toHaveBeenCalledWith('foo', ['--bar'], anyObj);

      await spawnAsPromised(rawCmd, {sapVersion: 1});
      expect(cpSpawnSpy).toHaveBeenCalledWith('foo', ['--bar'], anyObj);

      await spawnAsPromised(rawCmd, {sapVersion: 2});
      expect(cpSpawnSpy).toHaveBeenCalledWith('foo --bar', [], anyObj);
    });

    // With all `sapVersion`:
    [1, 2].forEach(sapVersion => describe(`v${sapVersion}`, () => {
      beforeEach(() => config.sapVersion = sapVersion);

      it('should return a promise', async () => {
        const promise = spawnAsPromised(rawCmd, config);
        expect(promise).toEqual(jasmine.any(Promise));

        await promise;
      });

      it('should register a clean-up callback', async () => {
        await spawnAsPromised(rawCmd, config);
        expect(puDoOnExitSpy).toHaveBeenCalledWith(process, jasmine.any(Function));
      });

      it('should suppress "Terminate batch job (Y/N)?" confirmation on Windows with `suppressTbj: true`', async () => {
        const suppressTbjSpy = spyOn(processUtils, 'suppressTerminateBatchJobConfirmation').and.
          returnValue(internalUtils.noop);

        await spawnAsPromised(rawCmd, config);
        expect(suppressTbjSpy).not.toHaveBeenCalled();

        await spawnAsPromised(rawCmd, {...config, suppressTbj: false});
        expect(suppressTbjSpy).not.toHaveBeenCalled();

        await spawnAsPromised(rawCmd, {...config, suppressTbj: true});
        expect(suppressTbjSpy).toHaveBeenCalledWith(process);
      });

      describe('returned promise', () => {
        beforeEach(() => autoExitSpawned = false);

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

        it('should be resolved with the appropriate value (based on `returnOutput`)', async () => {
          spyOn(process.stdout, 'write');
          const resolved = jasmine.createSpy('resolved');

          spawnAsPromised(rawCmd, {returnOutput: 2}).then(resolved);

          expect(spawned[0].stdout.pipe).toHaveBeenCalledTimes(1);

          const dataCapturingStream: Writable = (spawned[0].stdout.pipe as jasmine.Spy).calls.argsFor(0)[0];
          dataCapturingStream.emit('data', Buffer.from('  foo  '));
          dataCapturingStream.emit('data', Buffer.from('  \n  bar  \n  '));
          dataCapturingStream.emit('data', Buffer.from('  baz  \n  '));
          dataCapturingStream.emit('data', Buffer.from('  qux  \n  '));
          spawned[0].emit('exit', 0);
          await tickAsPromised();

          expect(resolved).toHaveBeenCalledWith('baz  \n    qux');
        });
      });
    }));

    // With `sapVersion: 1`:
    describe(`v1`, () => {
      beforeEach(() => config.sapVersion = 1);

      it('should spawn a process for the specified command', async () => {
        await spawnAsPromised(rawCmd, config);
        expect(cpSpawnSpy).toHaveBeenCalledWith('foo', ['--bar'], anyObj);
      });

      it('should parse the specified command (respecting double-quoted values)', async () => {
        await spawnAsPromised('foo1     "bar1" --baz1 --qux1="foo bar" "baz qux 1"', config);

        const parsedArgs1 = ['"bar1"', '--baz1', '--qux1="foo bar"', '"baz qux 1"'];
        expect(cpSpawnSpy).toHaveBeenCalledWith('foo1', parsedArgs1, anyObj);

        await spawnAsPromised('"foo2"     "bar2" --baz2 --qux2="foo bar" "baz qux 2"', config);

        const parsedArgs2 = ['"bar2"', '--baz2', '--qux2="foo bar"', '"baz qux 2"'];
        expect(cpSpawnSpy).toHaveBeenCalledWith('"foo2"', parsedArgs2, anyObj);
      });

      it('should support command "piping" (and spawn a process for each command)', async () => {
        await spawnAsPromised('foo bar | bar "baz" | "baz" qux | qux "q u u x"', config);

        expect(cpSpawnSpy).toHaveBeenCalledTimes(4);

        expect(cpSpawnSpy.calls.argsFor(0)).toEqual(['foo', ['bar'], anyObj]);
        expect(cpSpawnSpy.calls.argsFor(1)).toEqual(['bar', ['"baz"'], anyObj]);
        expect(cpSpawnSpy.calls.argsFor(2)).toEqual(['"baz"', ['qux'], anyObj]);
        expect(cpSpawnSpy.calls.argsFor(3)).toEqual(['qux', ['"q u u x"'], anyObj]);

        expect((spawned[0].stdout.pipe as jasmine.Spy).calls.argsFor(0)[0]).toBe(spawned[1].stdin);
        expect((spawned[1].stdout.pipe as jasmine.Spy).calls.argsFor(0)[0]).toBe(spawned[2].stdin);
        expect((spawned[2].stdout.pipe as jasmine.Spy).calls.argsFor(0)[0]).toBe(spawned[3].stdin);
      });

      it('should use appropriate values for `stdio`', async () => {
        await spawnAsPromised(rawCmd, config);

        const expectedStdio1 = ['inherit', 'inherit', 'inherit'];
        expect(cpSpawnSpy.calls.argsFor(0)[2].stdio).toEqual(expectedStdio1);

        cpSpawnSpy.calls.reset();

        await spawnAsPromised('foo bar | bar "baz" | "baz" qux | qux "q u u x"', config);

        const expectedStdio2 = [
          ['inherit', 'pipe', 'inherit'],
          ['pipe', 'pipe', 'inherit'],
          ['pipe', 'pipe', 'inherit'],
          ['pipe', 'inherit', 'inherit'],
        ];
        expect(cpSpawnSpy.calls.argsFor(0)[2].stdio).toEqual(expectedStdio2[0]);
        expect(cpSpawnSpy.calls.argsFor(1)[2].stdio).toEqual(expectedStdio2[1]);
        expect(cpSpawnSpy.calls.argsFor(2)[2].stdio).toEqual(expectedStdio2[2]);
        expect(cpSpawnSpy.calls.argsFor(3)[2].stdio).toEqual(expectedStdio2[3]);
      });

      describe('returned promise', () => {
        beforeEach(() => autoExitSpawned = false);

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

    // With `sapVersion: 2`:
    describe(`v2`, () => {
      beforeEach(() => config.sapVersion = 2);

      it('should spawn a process for the specified command', async () => {
        await spawnAsPromised(rawCmd, config);
        expect(cpSpawnSpy).toHaveBeenCalledWith('foo --bar', [], anyObj);
      });

      it('should not parse the specified command', async () => {
        const unparsedCmd1 = 'foo1     "bar1" --baz1 --qux1="foo bar" "baz qux 1"';
        await spawnAsPromised(unparsedCmd1, config);

        expect(cpSpawnSpy).toHaveBeenCalledWith(unparsedCmd1, [], anyObj);

        const unparsedCmd2 = '"foo2"     "bar2" --baz2 --qux2="foo bar" "baz qux 2"';
        await spawnAsPromised(unparsedCmd2, config);

        expect(cpSpawnSpy).toHaveBeenCalledWith(unparsedCmd2, [], anyObj);
      });

      it('should not handle command "piping" speciall (and only spawn one process)', async () => {
        const pipedCmd = 'foo bar | bar "baz" | "baz" qux | qux "q u u x"';
        await spawnAsPromised(pipedCmd, config);

        expect(cpSpawnSpy).toHaveBeenCalledTimes(1);
        expect(cpSpawnSpy.calls.argsFor(0)).toEqual([pipedCmd, [], anyObj]);

        expect(spawned[0].stdout.pipe).not.toHaveBeenCalled();
        expect(spawned[1].stdout.pipe).not.toHaveBeenCalled();
        expect(spawned[2].stdout.pipe).not.toHaveBeenCalled();
      });

      it('should use appropriate values for `stdio`', async () => {
        // In default mode.
        await spawnAsPromised(rawCmd, config);
        const expectedStdio1 = ['inherit', 'inherit', 'inherit'];

        expect(cpSpawnSpy.calls.argsFor(0)[2].stdio).toEqual(expectedStdio1);
        expect(spawned[0].stdout.pipe).not.toHaveBeenCalled();

        await spawnAsPromised('foo bar | bar "baz" | "baz" qux | qux "q u u x"', config);
        const expectedStdio2 = ['inherit', 'inherit', 'inherit'];

        expect(cpSpawnSpy.calls.argsFor(1)[2].stdio).toEqual(expectedStdio2);
        expect(spawned[1].stdout.pipe).not.toHaveBeenCalled();

        // With `returnOutput: true`.
        await spawnAsPromised(rawCmd, {...config, returnOutput: true});
        const expectedStdio3 = ['inherit', 'pipe', 'inherit'];

        expect(cpSpawnSpy.calls.argsFor(2)[2].stdio).toEqual(expectedStdio3);
        expect(spawned[2].stdout.pipe).toHaveBeenCalledTimes(1);

        await spawnAsPromised('foo bar | bar "baz" | "baz" qux | qux "q u u x"', {...config, returnOutput: true});
        const expectedStdio4 = ['inherit', 'pipe', 'inherit'];

        expect(cpSpawnSpy.calls.argsFor(3)[2].stdio).toEqual(expectedStdio4);
        expect(spawned[3].stdout.pipe).toHaveBeenCalledTimes(1);
      });
    });
  });
});
