import {commandUtils} from '../../lib/command-utils';
import {testingUtils} from '../../lib/testing-utils';
import {reversePromise} from '../test-utils';


describe('testing-utils', () => {
  describe('.testCmd()', () => {
    const testCmd: typeof testingUtils.testCmd = testingUtils.testCmd.bind(testingUtils);
    let cuSpawnAsPromisedSpy: jasmine.Spy;

    beforeEach(() => {
      cuSpawnAsPromisedSpy = spyOn(commandUtils, 'spawnAsPromised').and.
        callFake((cmd: string) => Promise.resolve(`spawned(${cmd})`));
    });

    it('should be a function', () => {
      expect(testCmd).toEqual(jasmine.any(Function));
    });

    it('should delegate to `commandUtils.spawnAsPromised()` with `returnOutput: true`', async () => {
      const cmd = 'foo --bar | baz && qux';
      const result = await testCmd(cmd);

      expect(result).toBe(`spawned(${cmd})`);
      expect(cuSpawnAsPromisedSpy).toHaveBeenCalledWith(cmd, {returnOutput: true});
    });

    it('should reject if `commandUtils.spawnAsPromised()` errors', async () => {
      // tslint:disable-next-line: no-string-throw
      cuSpawnAsPromisedSpy.and.callFake(() => { throw 'bar'; });
      const err1 = await reversePromise(testCmd('foo'));

      expect(err1).toBe('bar');

      cuSpawnAsPromisedSpy.and.callFake(() => Promise.reject('baz'));
      const err2 = await reversePromise(testCmd('foo'));

      expect(err2).toBe('baz');
    });

    it('should strip clean-up characters from the output', async () => {
      const originalOutput = '1 \u001b[0m 2 \u001b[?25h 3 \u001B[?25H 4 \u001B[0M 5';
      const expectedOutput = '1  2  3  4  5';
      cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve(originalOutput));

      expect(await testCmd('foo')).toBe(expectedOutput);
    });

    it('should normalize newlines to `\n`', async () => {
      const originalOutput = '1\r\n2\n3\r\n4\r5';
      const expectedOutput = '1\n2\n3\n4\n5';
      cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve(originalOutput));

      expect(await testCmd('foo')).toBe(expectedOutput);
    });

    it('should trim the output', async () => {
      const originalOutput = ' \t\r\n 1 2 3 4 5 \t \r \n ';
      const expectedOutput = '1 2 3 4 5';
      cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve(originalOutput));

      expect(await testCmd('foo')).toBe(expectedOutput);
    });

    it('should trim the output after stripping clean-up characters', async () => {
      const originalOutput = '  \u001b[0m  \u001b[?25h  1 2 3 4 5  \u001b[?25h  \u001b[0m  ';
      const expectedOutput = '1 2 3 4 5';
      cuSpawnAsPromisedSpy.and.returnValue(Promise.resolve(originalOutput));

      expect(await testCmd('foo')).toBe(expectedOutput);
    });
  });

  describe('.testScriptFactory()', () => {
    const testScriptFactory: typeof testingUtils.testScriptFactory = testingUtils.testScriptFactory.bind(testingUtils);

    it('should be a function', () => {
      expect(testScriptFactory).toEqual(jasmine.any(Function));
    });

    it('should return a function', () => {
      expect(testScriptFactory('')).toEqual(jasmine.any(Function));
    });

    describe('returned function', () => {
      let testScript: ReturnType<typeof testScriptFactory>;
      let tuTestCmdSpy: jasmine.Spy;

      beforeEach(() => {
        testScript = testScriptFactory('/foo/bar');
        tuTestCmdSpy = spyOn(testingUtils, 'testCmd');
      });

      it('should call `testCmd()` with an appropriate command', () => {
        expect(tuTestCmdSpy).not.toHaveBeenCalled();

        testScript();
        expect(tuTestCmdSpy).toHaveBeenCalledWith('node /foo/bar ');
      });

      it('should support appending arguments per call', () => {
        testScript('--baz qux');
        expect(tuTestCmdSpy).toHaveBeenCalledWith('node /foo/bar --baz qux');

        testScript('42');
        expect(tuTestCmdSpy).toHaveBeenCalledWith('node /foo/bar 42');
      });

      it('should forward the value returned by `testCmd()`', () => {
        const retValue = Promise.resolve('returned');
        tuTestCmdSpy.and.returnValue(retValue);

        expect(testScript()).toBe(retValue);
        expect(testScript('a r g s')).toBe(retValue);
      });
    });
  });

  describe('.withJasmineTimeout()', () => {
    const withJasmineTimeout: typeof testingUtils.withJasmineTimeout =
      testingUtils.withJasmineTimeout.bind(testingUtils);

    it('should be a function', () => {
      expect(withJasmineTimeout).toEqual(jasmine.any(Function));
    });

    it('should accept two arguments', () => {
      expect(withJasmineTimeout.length).toBe(2);
    });

    it('should return a function', () => {
      expect(withJasmineTimeout(42, () => undefined)).toEqual(jasmine.any(Function));
    });

    // Since this function is fairly simple, it is not worth to mock out the Jasmine globals
    // (`jasmine`, `beforeEach()`, `afterEach()`) in order to test it more thoroughly.
  });
});
