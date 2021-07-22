import * as childProcess from 'child_process';
import {EventEmitter} from 'events';
import * as rl from 'readline';
import {internalUtils} from '../../lib/internal-utils';
import {processUtils} from '../../lib/process-utils';
import {tickAsPromised} from '../test-utils';


describe('process-utils', () => {
  describe('.doOnExit()', () => {
    const doOnExit: typeof processUtils.doOnExit = processUtils.doOnExit.bind(processUtils);
    const emit = (event: string, code?: number) => mockProc.emit(event as any, code as any);
    let mockProc: NodeJS.Process;
    let mockProcExitSpy: jasmine.Spy;
    let mockActionSpy: jasmine.Spy;
    let cancelFn: ReturnType<typeof doOnExit>;

    beforeEach(() => {
      mockProc = new EventEmitter() as any;
      mockProcExitSpy = (mockProc as any).exit = jasmine.createSpy('mockProc.exit');
      mockActionSpy = jasmine.createSpy('mockAction');

      cancelFn = doOnExit(mockProc, mockActionSpy);
    });

    it('should be a function', () => {
      expect(doOnExit).toEqual(jasmine.any(Function));
    });

    it('should throw if no process specified', () => {
      expect(() => (doOnExit as any)()).toThrowError('No process specified.');
    });

    it('should throw if no action specified', () => {
      expect(() => (doOnExit as any)(mockProc)).toThrowError('No action specified.');
    });

    it('should take action on `SIGINT`', () => {
      expect(mockActionSpy).not.toHaveBeenCalled();

      emit('sigint');
      expect(mockActionSpy).not.toHaveBeenCalled();

      emit('SIGINT');
      expect(mockActionSpy).toHaveBeenCalledTimes(1);
    });

    it('should take action on `exit`', () => {
      expect(mockActionSpy).not.toHaveBeenCalled();

      emit('EXIT');
      expect(mockActionSpy).not.toHaveBeenCalled();

      emit('exit');
      expect(mockActionSpy).toHaveBeenCalledTimes(1);
    });

    it('should pass the emitted code to the action', () => {
      emit('SIGINT');
      expect(mockActionSpy).toHaveBeenCalledWith(undefined);

      emit('exit', 0);
      expect(mockActionSpy).toHaveBeenCalledWith(0);

      emit('SIGINT', 42);
      expect(mockActionSpy).toHaveBeenCalledWith(42);

      emit('exit', 1337);
      expect(mockActionSpy).toHaveBeenCalledWith(1337);
    });

    it('should exit the process (after taking action)', () => {
      mockProcExitSpy.and.callFake(() => expect(mockActionSpy).toHaveBeenCalledTimes(1));
      mockActionSpy.and.callFake(() => expect(mockProcExitSpy).not.toHaveBeenCalled());

      emit('SIGINT');
      expect(mockProcExitSpy).toHaveBeenCalledTimes(1);

      mockProcExitSpy.calls.reset();
      mockActionSpy.calls.reset();
      expect(mockProcExitSpy).not.toHaveBeenCalled();

      emit('exit');
      expect(mockProcExitSpy).toHaveBeenCalledTimes(1);
    });

    it('should exit the process with the emitted code (on `exit` only)', () => {
      emit('SIGINT', 42);
      expect(mockProcExitSpy).toHaveBeenCalledWith(1);

      emit('exit', 1337);
      expect(mockProcExitSpy).toHaveBeenCalledWith(1337);
    });

    it('should do nothing if canceled', () => {
      cancelFn();

      emit('SIGINT');
      emit('exit');

      expect(mockProcExitSpy).not.toHaveBeenCalled();
      expect(mockActionSpy).not.toHaveBeenCalled();
    });
  });

  describe('.suppressTerminateBatchJobConfirmation()', () => {
    const suppressTerminateBatchJobConfirmation: typeof processUtils.suppressTerminateBatchJobConfirmation =
      processUtils.suppressTerminateBatchJobConfirmation.bind(processUtils);
    let mockProc: NodeJS.Process;
    let mockRlInstance: ReturnType<typeof rl.createInterface>;
    let createInterfaceSpy: jasmine.Spy;
    let execSpy: jasmine.Spy;

    beforeEach(() => {
      mockProc = {
        pid: 42,
        platform: 'win32',
        stdin: {},
        stdout: {},
      } as any;

      mockRlInstance = Object.assign(new EventEmitter(), {
        close: jasmine.createSpy('mockRlInstance.close'),
      }) as any;

      createInterfaceSpy = spyOn(rl, 'createInterface').and.returnValue(mockRlInstance);
      execSpy = spyOn(childProcess, 'exec');
    });

    it('should be a function', () => {
      expect(suppressTerminateBatchJobConfirmation).toEqual(jasmine.any(Function));
    });

    it('should do nothing on non-Windows platforms', () => {
      (mockProc.platform as string) = 'linux';
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
      (mockProc.platform as string) = 'linux';
      const unsuppressTbj = suppressTerminateBatchJobConfirmation(mockProc);

      expect(unsuppressTbj).toBe(internalUtils.noop);
    });
  });
});
