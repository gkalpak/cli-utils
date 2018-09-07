'use strict';

// Imports
const chalk = require('chalk');
const {finallyAsPromised, noop, onError} = require('../../lib/internal-utils');
const {reversePromise, tickAsPromised} = require('../test-utils');

// Tests
describe('internal-utils', () => {
  describe('.finallyAsPromised()', () => {
    let callback;

    beforeEach(() => callback = jasmine.createSpy('callback'));

    it('should be a function', () => {
      expect(finallyAsPromised).toEqual(jasmine.any(Function));
    });

    it('should return a promise', () => {
      expect(finallyAsPromised(new Promise(noop), noop)).toEqual(jasmine.any(Promise));
    });

    describe('when the original promise is resolved', () => {
      it('should call the callback afterwards', async () => {
        const promiseSpy = jasmine.createSpy('promiseSpy').and.callFake(() => expect(callback).not.toHaveBeenCalled());
        const promise = Promise.resolve().then(promiseSpy);

        await finallyAsPromised(promise, callback);

        expect(promiseSpy).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledTimes(1);
      });

      it('should wait if callback returns a promise', async () => {
        const callbackSpy = jasmine.createSpy('callbackSpy');
        callback.and.callFake(() => tickAsPromised().then(callbackSpy));

        await finallyAsPromised(Promise.resolve(), callback);

        expect(callbackSpy).toHaveBeenCalledTimes(1);
      });

      it('should ignore the return result of callback', async () => {
        const promise = Promise.resolve('foo');
        callback.and.returnValue('bar');

        const val = await finallyAsPromised(promise, callback);

        expect(val).toBe('foo');
      });

      it('should ignore the resolved value of callback (if it returns a promise)', async () => {
        const promise = Promise.resolve('foo');
        callback.and.returnValue(Promise.resolve('bar'));

        const val = await finallyAsPromised(promise, callback);

        expect(val).toBe('foo');
      });

      it('should reject with the value thrown by callback', async () => {
        const promise = Promise.resolve('foo');
        callback.and.callFake(() => { throw 'bar'; });

        const err = await reversePromise(finallyAsPromised(promise, callback));

        expect(err).toBe('bar');
      });

      it('should reject with the rejected value of callback (if it returns a promise)', async () => {
        const promise = Promise.resolve('foo');
        callback.and.callFake(() => Promise.reject('bar'));

        const err = await reversePromise(finallyAsPromised(promise, callback));

        expect(err).toBe('bar');
      });
    });

    describe('when the original promise is rejected', () => {
      it('should call the callback afterwards', async () => {
        const promiseSpy = jasmine.createSpy('promiseSpy').and.callFake(() => expect(callback).not.toHaveBeenCalled());
        const promise = Promise.resolve().then(promiseSpy).then(() => Promise.reject());

        await reversePromise(finallyAsPromised(promise, callback));

        expect(promiseSpy).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledTimes(1);
      });

      it('should wait if callback returns a promise', async () => {
        const callbackSpy = jasmine.createSpy('callbackSpy');
        callback.and.callFake(() => tickAsPromised().then(callbackSpy));

        await reversePromise(finallyAsPromised(Promise.reject(), callback));

        expect(callbackSpy).toHaveBeenCalledTimes(1);
      });

      it('should ignore the return result of callback', async () => {
        const promise = Promise.reject('foo');
        callback.and.returnValue('bar');

        const err  =await reversePromise(finallyAsPromised(promise, callback));

        expect(err).toBe('foo');
      });

      it('should ignore the resolved value of callback (if it returns a promise)', async () => {
        const promise = Promise.reject('foo');
        callback.and.returnValue(Promise.resolve('bar'));

        const err = await reversePromise(finallyAsPromised(promise, callback));

        expect(err).toBe('foo');
      });

      it('should reject with the value thrown by callback', async () => {
        const promise = Promise.reject('foo');
        callback.and.callFake(() => { throw 'bar'; });

        const err = await reversePromise(finallyAsPromised(promise, callback));

        expect(err).toBe('bar');
      });

      it('should reject with the rejected value of callback (if it returns a promise)', async () => {
        const promise = Promise.reject('foo');
        callback.and.callFake(() => Promise.reject('bar'));

        const err = await reversePromise(finallyAsPromised(promise, callback));

        expect(err).toBe('bar');
      });
    });
  });

  describe('.noop()', () => {
    it('should be a function', () => {
      expect(noop).toEqual(jasmine.any(Function));
    });

    it('should do nothing', () => {
      expect(noop).not.toThrow();
      expect(noop()).toBeUndefined();
    });
  });

  describe('.onError()', () => {
    beforeEach(() => {
      spyOn(console, 'error');
      spyOn(process, 'exit');
    });

    it('should be a function', () => {
      expect(onError).toEqual(jasmine.any(Function));
    });

    it('should log the error (in red)', () => {
      onError('foo');
      expect(console.error).toHaveBeenCalledWith(chalk.red('Error: foo'));
    });

    it('should log the error as exit code if a (non-zero) number', () => {
      onError(42);
      expect(console.error).toHaveBeenCalledWith(chalk.red('Exit code: 42'));

      console.error.calls.reset();

      onError('42');
      expect(console.error).toHaveBeenCalledWith(chalk.red('Error: 42'));

      console.error.calls.reset();

      onError(0);
      expect(console.error).toHaveBeenCalledWith(chalk.red('Error: 0'));
    });

    it('should log the error\'s stacktrace (in red) if an `Error`', () => {
      onError(Object.assign(new Error('bar'), {stack: 'bar'}));
      expect(console.error).toHaveBeenCalledWith(chalk.red('bar'));
    });

    it('should exit the process with 1', () => {
      onError('foo');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should exit the process with `error` if a (non-zero) number', () => {
      onError(42);
      expect(process.exit).toHaveBeenCalledWith(42);

      onError('42');
      expect(process.exit).toHaveBeenCalledWith(1);

      onError(0);
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
