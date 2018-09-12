import {commandUtils, IRunConfig} from './command-utils';


export class TestingUtils {
  /**
   * Run the specified command using {@link CommandUtils#spawnAsPromised spawnAsPromised()}, capture the output and
   * return it. Before returning the captured output, it removes non-visible, clean-up characters written by
   * `spawnAsPromised()`, normalizes newlines to `\n`, and trims it.
   *
   * This can be useful (among other things) if you want to compare the output of a command with an expected output.
   *
   * NOTE 1: Normally, `spawnAsPromised()` only captures `stdout`. If you want to also capture `stderr`, you can
   *         redirect it to `stdout` by appending `2>&1` to the command.
   *
   * NOTE 2: Normally, `spawnAsPromised()` will reject without returning the output if the executed command fails. If
   *         you want the output nonetheless, you can make the command succeed by appending `|| true` to it.
   *
   * @example
   * ```js
   * const output = await testCmd('node --print "\'foo\\r\\nbar\\r\\n\'"');
   * // output === 'foo\nbar';
   *
   * const output = await testCmd('node --print "\'foo\\r\\nbar\\r\\n\'"', {dryrun: true});
   * // output === 'node --print "\'foo\\r\\nbar\\r\\n\'"';
   * ```
   *
   * @param cmd - The command to run.
   * @param config? - A configuration object. See {@link command-utils/IRunConfig} for more details.
   *
   * @return A promise that resolves once the command has been executed. The resolved value is the output of the
   *     command.
   */
  public async testCmd(cmd: string, config?: IRunConfig): Promise<string> {
    const result = await commandUtils.spawnAsPromised(cmd, {returnOutput: true, ...config});
    return this.normalizeNewlines(this.stripCleanUpCharacters(result)).trim();
  }

  /**
   * Create a function that can be used for testing a Node.js script with {@link TestingUtils#testCmd testCmd()}. It can
   * be used, for example, to test `bin` scripts.
   *
   * Basically, it takes a script path and returns a function that calls `testCmd('node <script-path>')`. The returned
   * function can also get extra arguments (as a string) to be appended to the executed command per call.
   *
   * @example
   * ```js
   * const testScript = testScriptFactory('/foo/bar.js');
   * testScript();               // Runs: node /foo/bar.js
   * testScript('--baz --qux');  // Runs: node /foo/bar.js --baz --qux
   * ```
   *
   * @param scriptPath - The path to the Node.js script to be run.
   *
   * @return A function that runs the script (via `testCmd()`) when called. Optionally accepts extra arguments (as a
   *     string) to be appended to the command and a {@link command-utils/IRunConfig configuration object}.
   */
  public testScriptFactory(scriptPath: string): (argsStr?: string, config?: IRunConfig) => Promise<string> {
    const baseCmd = `node ${scriptPath}`;
    return (argsStr = '', config?: IRunConfig) => this.testCmd(`${baseCmd} ${argsStr}`, config);
  }

  /**
   * Run a test suite (i.e. `describe()` block) with a different `DEFAULT_TIMEOUT_INTERVAL`. The previous timeout
   * interval is restored after all tests of the suite have completed.
   *
   * @example
   * ```js
   * describe('My slow suite', withJasmineTimeout(30000, () => {
   *   it('should take its time', done => setTimeout(done, 15000));
   * }));
   * ```
   *
   * @param newTimeout - The new timeout to use for the test suite (in milliseconds).
   * @param testSuite - The test suite function (same as a `describe()` block's second argument).
   */
  public withJasmineTimeout(newTimeout: number, testSuite: () => void): () => void {
    return () => {
      let originalDefaultTimeoutInterval: number;

      beforeAll(() => {
        originalDefaultTimeoutInterval = jasmine.DEFAULT_TIMEOUT_INTERVAL;
        jasmine.DEFAULT_TIMEOUT_INTERVAL = newTimeout;
      });

      afterAll(() => jasmine.DEFAULT_TIMEOUT_INTERVAL = originalDefaultTimeoutInterval);

      testSuite();
    };
  }

  // Methods - Private
  private normalizeNewlines(str: string): string {
    return str.replace(/\r\n?/g, '\n');
  }

  private stripCleanUpCharacters(str: string): string {
    return str.replace(/\u001b\[(?:0m|\?25h)/gi, '');
  }
}

export const testingUtils = new TestingUtils();
