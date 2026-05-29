import {
  DEGRADED_ERROR_THRESHOLD,
  IMPORTS_FAILED_OUTAGE,
  OUTAGE_ERROR_THRESHOLD,
  determineModuleStatus,
  rollUpOverall,
} from './status-rules';

describe('determineModuleStatus', () => {
  const base = { dbReachable: true, hasAuditSignal: true, errorsInWindow: 0 };

  it('reports outage when the database is unreachable, regardless of other signals', () => {
    const verdict = determineModuleStatus({
      ...base,
      dbReachable: false,
      errorsInWindow: 0,
    });
    expect(verdict.status).toBe('outage');
    expect(verdict.determination).toMatch(/SELECT 1/);
  });

  it('reports operational with no errors and a reachable database', () => {
    expect(determineModuleStatus(base).status).toBe('operational');
  });

  it('reports degraded at the degraded error threshold', () => {
    const verdict = determineModuleStatus({
      ...base,
      errorsInWindow: DEGRADED_ERROR_THRESHOLD,
    });
    expect(verdict.status).toBe('degraded');
  });

  it('reports outage at the outage error threshold', () => {
    const verdict = determineModuleStatus({
      ...base,
      errorsInWindow: OUTAGE_ERROR_THRESHOLD,
    });
    expect(verdict.status).toBe('outage');
  });

  it('escalates imports to outage on high failed-batch volume', () => {
    const verdict = determineModuleStatus({
      ...base,
      errorsInWindow: 0,
      importsFailed24h: IMPORTS_FAILED_OUTAGE,
    });
    expect(verdict.status).toBe('outage');
  });

  it('marks imports degraded on a single failed batch', () => {
    const verdict = determineModuleStatus({
      ...base,
      errorsInWindow: 0,
      importsFailed24h: 1,
    });
    expect(verdict.status).toBe('degraded');
  });

  it('marks whatsapp degraded when a credential is in ERROR state', () => {
    const verdict = determineModuleStatus({
      ...base,
      errorsInWindow: 0,
      whatsappErrorCount: 1,
    });
    expect(verdict.status).toBe('degraded');
  });

  it('reports connectivity-only operational for modules without an audit signal', () => {
    const verdict = determineModuleStatus({
      dbReachable: true,
      hasAuditSignal: false,
      errorsInWindow: 0,
    });
    expect(verdict.status).toBe('operational');
    expect(verdict.determination).toMatch(/connectivity-only/);
  });
});

describe('rollUpOverall', () => {
  it('returns operational when all modules are operational', () => {
    expect(rollUpOverall(['operational', 'operational'])).toBe('operational');
  });

  it('returns degraded when any module is degraded but none are down', () => {
    expect(rollUpOverall(['operational', 'degraded'])).toBe('degraded');
  });

  it('returns outage when any module is in outage (worst wins)', () => {
    expect(rollUpOverall(['operational', 'degraded', 'outage'])).toBe('outage');
  });
});
