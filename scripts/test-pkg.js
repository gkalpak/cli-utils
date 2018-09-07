#!/usr/bin/env node
'use strict';

// Imports
const {green, red} = require('chalk');
const {existsSync} = require('fs');
const {join, resolve} = require('path');
const {bin, main} = require('../package.json');

// Constants
const CHECK_MARK = green('\u2714');
const X_MARK = red('\u2716');
const ROOT_DIR = resolve(__dirname, '..');

// Run
_main();

// Function - Definitions
function _main() {
  checkBin(bin || {}, ROOT_DIR);
  checkMain(main || '', ROOT_DIR);
}

function checkBin(bin, rootDir) {
  const missingScripts = Object.keys(bin).
    map(key => join(rootDir, bin[key])).
    filter(path => !existsSync(path));

  reportResults(
    'All scripts mentioned in the `bin` property in `./package.json` exist.',
    'Some scripts mentioned in the `bin` property in `./package.json` are missing.',
    {'Missing scripts': missingScripts},
  );
}

function checkMain(main, rootDir) {
  if (!main) return;

  const absMainPath = join(rootDir, main);
  const missingMain = !existsSync(absMainPath) && !existsSync(`${absMainPath}.js`);

  reportResults(
    'The script mentioned in the `main` property in `./package.json` exist.',
    'The script mentioned in the `main` property in `./package.json` is missing.',
    {'Missing script': missingMain ? [main] : []},
  );
}

function reportResults(successMessage, errorMessage, errors) {
  const errorHeaders = Object.keys(errors).filter(header => errors[header].length);

  if (!errorHeaders.length) {
    console.log(`${CHECK_MARK}  ${successMessage}`);
  } else {
    const errorSummary = `${X_MARK}  ${errorMessage}`;
    const errorDetails = errorHeaders.
      reduce((lines, header) => [
        ...lines,
        `${header}:`,
        ...errors[header].map(x => `  ${x}`),
      ], []).
      map(line => `     ${line}`).
      join('\n');

    console.error(errorSummary);
    console.error(errorDetails);
    console.error();

    process.exit(1);
  }
}
