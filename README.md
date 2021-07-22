# cli-utils [![Build status][build-status-image]][build-status]

## Description

A private collection of utilities for developing cli tools.

## Usage

**You** should generally not use it. You would use tools built or developed with it, for example:

- [@gkalpak/aliases][aliases]
- [gkalpak.aio-docs-utils][aio-docs-utils]

**I** may use it for building or developing other tools (see above). Below is a brief overview of
what's in the box.

### Programmatic usage

This package exposes the following utilities (see the respective source files for API docs):

- **[commandUtils][lib-command-utils]:**

  - **`expandCmd(cmd: string, runtimeArgs: string[], config: IRunConfig): Promise<string>`:**<br />
    _Expand a command string, by substituting argument identifiers with the specified arguments. It
    also supports default/fallback arguments (specified either as static values or as commands to
    execute and use the output)._

  - **`preprocessArgs(rawArgs: string[]): {args: string[], config: IRunConfig}`:**<br />
    _Preprocess a list of input arguments into a list of arguments that can be used for
    substituting into commands. Also, derive a configuration object to modify the behavior of
    `commandUtils.run()`._

  - **`run(cmd: string, runtimeArgs?: string[], config?: IRunConfig): Promise<string>`:**<br />
    _Run a command. Could be a complex command with `|`, `&&` and `||`. It also supports argument
    substitution with `commandUtils.expandCmd()`._

  - **`spawnAsPromised(cmd: string, config?: IRunConfig): Promise<string>`:**<br />
    _Spawn a complex command (or series of piped commands) and return a promise that resolves or
    rejects based on the command's outcome. It provides some extras on top of
    `child_process.spawn()`._

- **[processUtils][lib-process-utils]:**

  - **`doOnExit(proc: Process, action: Function): Function`:**<br />
    _Run the specified `action`, when `exit` or `SIGINT` are fired on the specified process._

  - **`suppressTerminateBatchJobConfirmation(proc: Process): Function`:**<br />
    _Suppress the "Terminate batch job (Y/N)?" confirmation on Windows for the specified process.
    Calling it with a non-Windows process is a no-op._
    > NOTE: This is still an experimental feature and not guaranteed to work as expected.
    >       It is known to not work with certain types of commands (e.g. `vim`).

- **[testingUtils][lib-testing-utils]:**

  - **`testCmd(cmd: string, config?: IRunConfig): Promise<string>`:**<br />
    _Run the specified command using `commandUtils.spawnAsPromised()`, capture the output and return
    it (after normalizing newlines and trimming it)._

  - **`testScriptFactory(scriptPath: string, config?: IRunConfig): Function`:**<br />
    _Create a function that can be used for testing a Node.js script with `testingUtils.testCmd()`.
    Different arguments can be passed per call of the returned function._

  - **`withJasmineTimeout(newTimeout: number, testSuite: Function): void`:**<br />
    _Run a test suite (i.e. `describe()` block) with a different `DEFAULT_TIMEOUT_INTERVAL`. The
    previous timeout interval is restored after all tests of the suite have completed._

### Command-line usage

This package exposes the following commands (see the respective source files for API docs):

- **[gkcu-expand-cmd][bin-expand-cmd]` "<cmd>" <arg1> <arg2> --gkcu-<arg3> ...`:**<br />
  _Expand a command string by substituting argument identifiers with the specified arguments. It
  also supports default/fallback arguments (specified either as static values or as commands to
  execute and use the output)._
  > Examples:
  > ```
  > gkcu-expand-cmd "echo \$1 \${2:bar} \$1" foo
  > #--> echo foo bar foo
  >
  > gkcu-expand-cmd "echo \${1:Hello}, \${0:::whoami}!" Hey
  > #--> echo Hey, gkalpak!
  > ```

- **[gkcu-run][bin-run]` "<cmd>" <arg1> <arg2> --gkcu-<arg3> ...`:**<br />
  _Run a command with support for argument substitution. Could be a complex command with `|`, `&&`
  and `||` (but not guaranteed to work if too complex :P)._
  > Examples:
  > ```
  > gkcu-run "echo \$1 \${2:bar} \$1" foo
  > #--> foo bar foo
  >
  > gkcu-run "echo \${1:Hello}, \${0:::whoami}!" Hey
  > #--> Hey, gkalpak!
  > ```

## Testing

The following test-types/modes are available:

- **Code-linting:** `npm run lint`
  _Lint TypeScript files using TSLint._

- **Unit tests:** `npm run test-unit`
  _Run all the unit tests once. These tests are quick and suitable to be run on every change._

- **E2E tests:** `npm run test-e2e`
  _Run all the end-to-end tests once. These test may hit actual API endpoints or perform expensive
  I/O operations and are considerably slower than unit tests._

- **All tests:** `npm test` / `npm run test`
  _Run all of the above tests (code-linting, unit tests, e2e tests). This command is automatically
  run before every release (via `npm run release`)._

- **"Dev" mode:** `npm run dev`
  _Watch all files and rerun the unit tests whenever something changes. For performance reasons,
  code-linting and e2e tests are omitted._

## TODO

Things I want to (but won't necessarily) do:

- Add more unit tests for `commandUtils.spawnAsPromised()`.


[aio-docs-utils]: https://marketplace.visualstudio.com/items?itemName=gkalpak.aio-docs-utils
[aliases]: https://www.npmjs.com/package/@gkalpak/aliases
[bin-expand-cmd]: https://github.com/gkalpak/cli-utils/tree/master/src/bin/expand-cmd.ts
[bin-run]: https://github.com/gkalpak/cli-utils/tree/master/src/bin/run.ts
[build-status]: https://github.com/gkalpak/cli-utils/actions/workflows/ci.yml
[build-status-image]: https://github.com/gkalpak/cli-utils/actions/workflows/ci.yml/badge.svg?branch=master&event=push
[lib-command-utils]: https://github.com/gkalpak/cli-utils/tree/master/src/lib/command-utils.ts
[lib-process-utils]: https://github.com/gkalpak/cli-utils/tree/master/src/lib/process-utils.ts
[lib-testing-utils]: https://github.com/gkalpak/cli-utils/tree/master/src/lib/testing-utils.ts
