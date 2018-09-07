'use strict';

// Exports
module.exports = {
  normalizeNewlines: _normalizeNewlines,
  reversePromise: _reversePromise,
  stripCleanUpCharacters: _stripCleanUpCharacters,
  tickAsPromised: _tickAsPromised,
};

// Functions - Definitions
function _normalizeNewlines(str) {
  return str.replace(/\r\n/g, '\n');
}

function _reversePromise(p) {
  return p.then(val => Promise.reject(val), err => err);
}

function _stripCleanUpCharacters(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[(?:0m|\?25h)/gi, '');
}

function _tickAsPromised() {
  return new Promise(resolve => setTimeout(resolve));
}
