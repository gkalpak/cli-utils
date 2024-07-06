#!/usr/bin/env node
'use strict';

// Imports
const {existsSync} = require('node:fs');
const {resolve} = require('node:path');
const {exit} = require('node:process');

const {green, red} = require('chalk');

const {bin, main, types} = require('../package.json');

// Constants
const CHECK_MARK = green('\u2714');
const X_MARK = red('\u2716');
const ROOT_DIR = resolve(__dirname, '..');

// Run
_main();

// Function - Definitions
function _main() {
  checkBin(bin, ROOT_DIR);
  checkFile('main', main, ROOT_DIR);
  checkFile('types', types, ROOT_DIR);
}

function checkBin(bin, rootDir) {
  const missingScripts = Object.values(bin).
    map(scriptPath => resolve(rootDir, scriptPath)).
    filter(path => !existsSync(path));

  reportResults(
      'All scripts mentioned in `package.json > bin` exist.',
      'Some scripts mentioned in `package.json > bin` are missing.',
      {'Missing scripts': missingScripts});
}

function checkFile(propName, filePath, rootDir) {
  if (!filePath) return;

  const missingFile = !existsSync(resolve(rootDir, filePath));

  reportResults(
      `The file mentioned in \`package.json > ${propName}\` exists.`,
      `The file mentioned in \`package.json > ${propName}\` is missing.`,
      {'Missing script': missingFile ? [filePath] : []});
}

function reportResults(successMessage, errorMessage, errors) {
  const errorHeaders = Object.values(errors).filter(msg => msg.length);

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

    exit(1);
  }
}
