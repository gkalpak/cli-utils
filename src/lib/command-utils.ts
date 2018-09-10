import {spawn, SpawnOptions} from 'child_process';
import {PassThrough, Readable} from 'stream';
import {internalUtils} from './internal-utils';
import {processUtils} from './process-utils';


/**
 * A configuration object, specifying the behavior of {@link commandUtils#run run()}.
 */
export interface IRunConfig {
  /**
   * If true, produce verbose, debug-friendly output.
   * (Default: false)
   */
  debug?: boolean;

  /**
   * If true, print the command instead of actually running it.
   * (Default: false)
   *
   * NOTE: This is still an experimental feature and not guaranteed to work as expected.
   */
  dryrun?: boolean;

  /**
   * If true, return the output of the command instead of printing it to stdout. If a number (`n`), print the output to
   * stdout, but also return the `n` last lines (ignoring trailing whitespace).
   * (Default: false)
   */
  returnOutput?: boolean | number;

  /**
   * If true, suppress the "Terminate batch job (Y/N)?" confirmation on Windows.
   * (Default: false)
   *
   * NOTE: This is still an experimental feature and not guaranteed to work as expected.
   *       It is known to not work with certain types of commands (e.g. `vim`).
   */
  suppressTbj?: boolean;
}

export class CommandUtils {
  /**
   * Expand a command string, by substituting argument identifiers with the specified arguments. It also supports
   * default/fallback arguments (specified either as static values or as commands to execute and use the output).
   *
   * The following rules apply (independently of the underlying OS):
   * - `$*`, `${*}`: Substitute with all arguments (if any).
   * - `$n`, `${n}`: Substitute with the nth argument (if specified), where `n` is a positive integer.
   * - `$n*`, `${n*}`: Substitute with all arguments starting at the nth one (if any).
   * - `${*:value}`, `${n:value}`, `${n*:value}`: Substitute with all arguments (`*`) or the nth argument (`n`) or the
   *   nth and all subsequent arguments (`n*`). If not specified, substitute with `value`.
   * - `${*:::command}`, `${n:::command}`, `${n*:::command}`: Substitute with all arguments (`*`) or the nth
   *   argument (`n`) or the nth and all subsequent arguments (`n*`). If not specified, run `command` and substitute
   *   with its trimmed output.
   *
   * In all rules above, `$`s can also be escaped with `\`, which will be removed when executing the command. This
   * allows avoiding variable expansion in non-Windows platforms, while still not affecting the output on Windows.
   *
   * Hint: `${0:::command}` will always be substituted with the output of `command`. This is useful when you want to
   *       always use the output of `command` in an OS-independent way.
   *
   * You can use {@link CommandUtils#preprocessArgs preprocessArgs()} to obtain the basic `runtimeArgs` and `config`
   * values. For example: `const {args, config} = preprocessArgs(process.argv.slice(2))`.
   *
   * @param cmd - The command to expand.
   * @param runtimeArgs - The runtime arguments that will be used for substituting.
   * @param config - A configuration object. See {@link command-utils/IRunConfig} for more details.
   *
   * @return A promise that resolves with the expanded command, with arguments substituted (including running
   *     default/fallback value sub-commands, as necessary).
   */
  public async expandCmd(cmd: string, runtimeArgs: string[], config: IRunConfig): Promise<string> {
    // 1: leading \s
    // 2, 5: $*
    // 3, 6: $\d+*
    // 4, 7: $\d+
    // 8: default/fallback value (possibly with `returnOutput` limit)
    const re = /(\s{0,1})\\?\$(?:(\*)|([1-9]+)\*|(\d+)|{(?:(?:(\*)|([1-9]+)\*|(\d+))(?::([^}]*))?)})/g;
    const cmdPromises = new Map<string, Promise<string>>();

    let expandedCmd = cmd.replace(re, (_, g1, g2, g3, g4, g5, g6, g7, g8) => {
      const valToReplacement = (val: string) => !val ? '' : `${g1}${val}`;

      // Value based on the supplied arguments.
      const startIdx = (g2 || g5) ? 0 : (g3 || g6 || g4 || g7) - 1;
      const endIdx = (g2 || g5 || g3 || g6) ? runtimeArgs.length : +(g4 || g7);
      let value = runtimeArgs.slice(startIdx, endIdx).join(' ');

      // No argument(s), fall back to default.
      if (!value && g8) {
        const match = /^::(.+)$/.exec(g8);

        if (!match) {
          // It is a plain ol' fallback value.
          value = g8;
        } else {
          // It is a command.
          let returnOutput: boolean | number = true;
          const subCmd = match[1].replace(/ --gkcu-returnOutput=(\d+)$/, (__, g) => {
            returnOutput = +g;
            return '';
          });
          const placeholder = `${Math.random()}`;

          if (!cmdPromises.has(subCmd)) {
            const runConfig: IRunConfig = Object.assign({}, config, {returnOutput});
            const cmdPromise = this.run(subCmd, runtimeArgs, runConfig).
              then(result => this.trimOutput(result)).
              then(result => valToReplacement(runConfig.dryrun ? `{{${result.replace(/\s/g, '_')}}}` : result));

            cmdPromises.set(subCmd, cmdPromise);
          }

          cmdPromises.set(subCmd, cmdPromises.get(subCmd)!.then(repl => {
            expandedCmd = expandedCmd.replace(placeholder, repl);
            return repl;
          }));

          return placeholder;
        }
      }

      return valToReplacement(value);
    });

    await Promise.all(cmdPromises.values());

    return expandedCmd;
  }

  /**
   * Preprocess a list of input arguments (e.g. `process.argv.slice(2)`) into a list of arguments that can be used for
   * substituting into commands (i.e. filtering out `--gkcu-` arguments and wrapping the remaining argument in
   * double-quotes, if necessary). Also, derive a {@link command-utils/IRunConfig configuration object} (based on
   * `--gkcu-` arguments) to modify the behavior of {@link CommandUtils#run run()} (e.g. enable debug output).
   *
   * NOTE: If you want to pass a value to a `--gkcu-` argument, you need to use `=` (using a space will not work).
   *       For example: `some-command --gkcu-returnOutput=1`
   *
   * @param rawArgs - The input arguments that will be preprocessed.
   *
   * @return An object contaning a list of arguments that can be used for substituting and a
   *     {@link command-utils/IRunConfig configuration object}.
   */
  public preprocessArgs(rawArgs: string[]): {args: string[], config: IRunConfig} {
    const metaArgRe = /^--gkcu-(?=[a-z])/;
    const quoteIfNecessary = (arg: string) => /\s/.test(arg) ? `"${arg}"` : arg;
    const processMetaArg = (arg: string) => {
      const [key, ...rest] = arg.split('=');
      const value = rest.join('=');

      config[key] = +value || value || true;
    };

    const config = Object.create(null);
    const args = rawArgs.
      filter(arg => !metaArgRe.test(arg) || processMetaArg(arg.replace(metaArgRe, ''))).
      map(quoteIfNecessary);

    return {args, config};
  }

  /**
   * Run a command. Could be a complex command with `|`, `&&` and `||` (but not guaranteed to work if too complex :P).
   *
   * It supports argument substitution with {@link CommandUtils#expandCmd expandCmd()} and uses
   * {@link CommandUtils#spawnAsPromised spawnAsPromised()} to run the resulting command (after substitution).
   *
   * You can use {@link CommandUtils#preprocessArgs preprocessArgs()} to obtain the basic `runtimeArgs` and `config`
   * values. For example: `const {args, config} = preprocessArgs(process.argv.slice(2))`.
   *
   * @param cmd - The command to run. Could be a complex command with `|`, `&&` and `||` (but not guaranteed to work if
   *     too complex :P).
   * @param runtimeArgs? - The runtime arguments that will be used for substituting.
   * @param config? - A configuration object. See {@link command-utils/IRunConfig} for more details.
   *
   * @return A promise that resolves once the command has been executed. The resolved value is either an empty string or
   *     (some part of) the output of the command (if `returnOutput` is set and not false).
   */
  public async run(cmd: string, runtimeArgs: string[] = [], config: IRunConfig = {}): Promise<string> {
    const expandedCmd = await this.expandCmd(cmd, runtimeArgs, config);

    if (config.debug) {
      console.log(`Input command: '${cmd}'`);
      console.log(`Expanded command: '${expandedCmd}'`);
    }

    return this.spawnAsPromised(expandedCmd, config);
  }

  /**
   * Spawn a complex command (or series of piped commands) and return a promise that resolves or rejects based on the
   * command's outcome. It uses `child_process.spawn()` under the hood, but provides the following extras:
   *
   * - You do not have to separate the executable from the arguments.
   * - It supports complex command with `|`, correctly piping a sub-command's output to the next sub-command's input.
   * - Cleans up once finished, resetting the output style (e.g. bold) and cursor style (e.g. hidden).
   *   _This is useful, when a sub-command errors and leaves the terminal in an unclean state._
   * - Supports all {@link command-utils/IRunConfig} options.
   *
   * @param cmd - The command to run. Could be a complex command with `|`.
   * @param config? - A configuration object. See {@link command-utils/IRunConfig} for more details.
   *
   * @return A promise that resolves once the command has been executed. The resolved value is either an empty string or
   *     (some part of) the output of the command (if `returnOutput` is set and not false).
   */
  public spawnAsPromised(rawCmd: string, {debug, dryrun, returnOutput, suppressTbj}: IRunConfig = {}): Promise<string> {
    const returnOutputSubset = (typeof returnOutput === 'number');

    const cleanUp = () => {
      if (returnOutput && !returnOutputSubset) {
        // The output has not been written to stdout. No need to clean up.
        return;
      }

      if (debug) {
        console.log('  Reseting the output and cursor styles.');
      }

      // Reset the output style (e.g. bold) and show the cursor.
      process.stdout.write('\u001b[0m');
      process.stdout.write('\u001b[?25h');
    };
    const cancelCleanUp = processUtils.doOnExit(process, cleanUp);
    const unsuppressTbj = suppressTbj ?
      processUtils.suppressTerminateBatchJobConfirmation(process) :
      internalUtils.noop;

    const onDone = () => {
      unsuppressTbj();
      cancelCleanUp();
      cleanUp();
    };

    const promise = new Promise<string>((resolve, reject) => {
      let data = '';

      const getReturnData = !returnOutputSubset ?
        () => data :
        () => data.trim().split('\n').slice(-(returnOutput as number)).join('\n');

      const pipedCmdSpecs = rawCmd.
        split(/\s+\|\s+/).
        map(cmd => this.parseSingleCmd(cmd, dryrun));

      const lastStdout = pipedCmdSpecs.reduce<Readable | null>((prevStdout, cmdSpec, idx, arr) => {
        const isLast = (idx === arr.length - 1);
        const pipeOutput = !isLast || returnOutput;

        const executable = cmdSpec.executable;
        const args = cmdSpec.args;
        const options: SpawnOptions = {
          shell: true,
          stdio: [
            prevStdout ? 'pipe' : 'inherit',
            pipeOutput ? 'pipe' : 'inherit',
            'inherit',
          ],
        };

        if (debug) {
          console.log(`  Running ${idx + 1}/${arr.length}: '${executable}', '${args}', (stdio: ${options.stdio})`);
        }

        const proc = spawn(executable, args, options).
          on('error', reject).
          on('exit', (code, signal) => {
            if (code !== 0) return reject(code || signal);
            if (isLast) return resolve(getReturnData());
          });

        if (prevStdout) prevStdout.pipe(proc.stdin);

        return proc.stdout;
      }, null);

      if (returnOutput) {
        const outputStream = new PassThrough();
        outputStream.on('data', d => data += d);
        lastStdout!.pipe(outputStream);

        if (returnOutputSubset) {
          outputStream.pipe(process.stdout);
        }
      }
    });

    return internalUtils.finallyAsPromised(promise, onDone);
  }

  // Methods - Private
  private insertAfter(items: string[], newItem: string, afterItem: string): void {
    for (let i = 0; i < items.length; ++i) {
      if (items[i] === afterItem) {
        this.insertAt(items, newItem, ++i);
      }
    }
  }

  private insertAt(items: string[], newItem: string, idx: number) {
    if (items[idx] === '(') {
      ++idx;
    }

    items.splice(idx, 0, newItem);
  }

  private parseSingleCmd(cmd: string, dryrun = false): {executable: string, args: string[]} {
    const tokens = cmd.
      split('"').
      reduce((arr, str, idx) => {
        const newTokens = (idx % 2) ? [`"${str}"`] : str.split(' ');
        const lastToken = arr[arr.length - 1];

        if (lastToken) arr[arr.length - 1] += newTokens.shift();

        return arr.concat(newTokens);
      }, [] as string[]).
      filter(x => x).
      reduce((arr, str) => {
        if (str[0] === '(') {
          arr.push('(', str.slice(1));
        } else {
          arr.push(str);
        }
        return arr;
      }, [] as string[]);

    if (dryrun) {
      this.transformForDryrun(tokens);
    }

    return {
      args: tokens,
      executable: tokens.shift() || '',
    };
  }

  private transformForDryrun(tokens: string[]): void {
    this.insertAt(tokens, 'echo', 0);
    this.insertAfter(tokens, 'echo', '&&');
    this.insertAfter(tokens, 'echo', '||');
  }

  private trimOutput(str: string): string {
    const cursorMoveRe = /\u001b\[\d+[a-d]/gi;
    return str.
      replace(cursorMoveRe, '').
      trim();
  }
}

export const commandUtils = new CommandUtils();
