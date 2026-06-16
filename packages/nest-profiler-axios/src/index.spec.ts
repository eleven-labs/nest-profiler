import * as shim from './index';
import { HttpCollectorModule } from '@eleven-labs/nest-profiler-http';

describe('@eleven-labs/nest-profiler-axios (deprecated shim)', () => {
  it('re-exports the public surface of @eleven-labs/nest-profiler-http', () => {
    expect(shim.HttpCollectorModule).toBe(HttpCollectorModule);
    expect(shim.HttpProfilerRecorder).toBeDefined();
  });

  it('keeps AxiosCollectorModule as a drop-in alias for HttpCollectorModule', () => {
    expect(shim.AxiosCollectorModule).toBe(HttpCollectorModule);
  });
});
