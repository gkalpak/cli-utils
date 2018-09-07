'use strict';

// Imports
const childProcess = require('child_process');
const {EventEmitter} = require('events');
const rl = require('readline');
const {noop} = require('../../lib/internal-utils');
const {doOnExit, suppressTerminateBatchJobConfirmation} = require('../../lib/process-utils');
const {tickAsPromised} = require('../test-utils');

// Tests
describe('process-utils', () => {
  describe('.doOnExit()', () => {
    let mockProc;
    let mockAction;
    let cancelFn;

    beforeEach(() => {
      mockProc = new EventEmitter();
      mockProc.exit = jasmine.createSpy('mockProc.exit');
      mockAction = jasmine.createSpy('mockAction');

      spyOn(console, 'warn');
      spyOn(mockProc, 'addListener').and.callThrough();

      cancelFn = doOnExit(mockProc, mockAction);
    });

    it('should be a function', () => {
      expect(doOnExit).toEqual(jasmine.any(Function));
    });

    it('should throw if no process specified', () => {
      expect(() => doOnExit()).toThrowError('No process specified.');
    });

    it('should throw if no action specified', () => {
      expect(() => doOnExit(mockProc)).toThrowError('No action specified.');
    });

    it('should take action on `SIGINT`', () => {
      expect(mockAction).not.toHaveBeenCalled();

      mockProc.emit('sigint');
      expect(mockAction).not.toHaveBeenCalled();

      mockProc.emit('SIGINT');
      expect(mockAction).toHaveBeenCalledTimes(1);
    });

    it('should take action on `exit`', () => {
      expect(mockAction).not.toHaveBeenCalled();

      mockProc.emit('EXIT');
      expect(mockAction).not.toHaveBeenCalled();

      mockProc.emit('exit');
      expect(mockAction).toHaveBeenCalledTimes(1);
    });

    it('should pass the emitted code to the action', () => {
      mockProc.emit('SIGINT');
      expect(mockAction).toHaveBeenCalledWith(undefined);

      mockProc.emit('exit', 0);
      expect(mockAction).toHaveBeenCalledWith(0);

      mockProc.emit('SIGINT', 42);
      expect(mockAction).toHaveBeenCalledWith(42);

      mockProc.emit('exit', 1337);
      expect(mockAction).toHaveBeenCalledWith(1337);
    });

    it('should exit the process (after taking action)', () => {
      mockProc.exit.and.callFake(() => expect(mockAction).toHaveBeenCalledTimes(1));
      mockAction.and.callFake(() => expect(mockProc.exit).not.toHaveBeenCalled());

      mockProc.emit('SIGINT');
      expect(mockProc.exit).toHaveBeenCalledTimes(1);

      mockProc.exit.calls.reset();
      mockAction.calls.reset();
      expect(mockProc.exit).not.toHaveBeenCalled();

      mockProc.emit('exit');
      expect(mockProc.exit).toHaveBeenCalledTimes(1);
    });

    it('should exit the process with the emitted code', () => {
      mockProc.emit('SIGINT', 42);
      expect(mockProc.exit).toHaveBeenCalledWith(42);

      mockProc.emit('exit', 1337);
      expect(mockProc.exit).toHaveBeenCalledWith(1337);
    });

    it('should do nothing if canceled', () => {
      cancelFn();

      mockProc.emit('SIGINT');
      mockProc.emit('exit');

      expect(mockProc.exit).not.toHaveBeenCalled();
      expect(mockAction).not.toHaveBeenCalled();
    });
  });

  describe('.suppressTerminateBatchJobConfirmation()', () => {
    let mockProc;
    let mockRlInstance;
    let createInterfaceSpy;
    let execSpy;

    beforeEach(() => {
      mockProc = {
        pid: 42,
        platform: 'win32',
        stdin: {},
        stdout: {},
      };

      mockRlInstance = Object.assign(new EventEmitter(), {
        close: jasmine.createSpy('mockRlInstance.close'),
      });

      createInterfaceSpy = spyOn(rl, 'createInterface').and.returnValue(mockRlInstance);
      execSpy = spyOn(childProcess, 'exec');
    });

    it('should be a function', () => {
      expect(suppressTerminateBatchJobConfirmation).toEqual(jasmine.any(Function));
    });

    it('should do nothing on non-Windows platforms', () => {
      mockProc.platform = 'not-win32';
      suppressTerminateBatchJobConfirmation(mockProc);

      expect(createInterfaceSpy).not.toHaveBeenCalled();
    });

    it('should create a `readline` interface (delegating stdio to the specified process)', () => {
      suppressTerminateBatchJobConfirmation(mockProc);
      expect(createInterfaceSpy).toHaveBeenCalledTimes(1);

      const options = createInterfaceSpy.calls.mostRecent().args[0];
      expect(options.input).toBe(mockProc.stdin);
      expect(options.output).toBe(mockProc.stdout);
    });

    it('should kill the specified process on `SIGINT`', () => {
      suppressTerminateBatchJobConfirmation(mockProc);
      expect(execSpy).not.toHaveBeenCalled();

      mockRlInstance.emit('SIGINT');
      expect(execSpy).toHaveBeenCalledWith('taskkill /F /PID 42 /T');
    });

    it('should return an `unsuppress` function', async () => {
      const unsuppressTbj = suppressTerminateBatchJobConfirmation(mockProc);

      expect(unsuppressTbj).toEqual(jasmine.any(Function));
      expect(mockRlInstance.close).not.toHaveBeenCalled();

      unsuppressTbj();
      expect(mockRlInstance.close).not.toHaveBeenCalled();

      await tickAsPromised();
      expect(mockRlInstance.close).toHaveBeenCalledTimes(1);
    });

    it('should still return a (no-op) `unsuppress` function on non-Windows platforms', () => {
      mockProc.platform = 'not-win32';
      const unsuppressTbj = suppressTerminateBatchJobConfirmation(mockProc);

      expect(unsuppressTbj).toBe(noop);
    });
  });
});
