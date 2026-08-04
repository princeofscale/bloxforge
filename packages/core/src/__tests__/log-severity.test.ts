import { logSeverity, parseLogErrors } from '../diagnostics.js';

describe('logSeverity', () => {
  // The plugin's RuntimeLogBuffer tags entries with these four and sends no
  // messageType. Both readers were matching Enum.MessageType names instead.
  it('understands the plugin level tags', () => {
    expect(logSeverity({ level: 'ERR' })).toBe('error');
    expect(logSeverity({ level: 'WARN' })).toBe('warning');
    expect(logSeverity({ level: 'INFO' })).toBe('other');
    expect(logSeverity({ level: 'OUT' })).toBe('other');
  });

  it('still understands Enum.MessageType names', () => {
    expect(logSeverity({ messageType: 'MessageError' })).toBe('error');
    expect(logSeverity({ messageType: 'MessageWarning' })).toBe('warning');
    expect(logSeverity({ messageType: 'MessageOutput' })).toBe('other');
    expect(logSeverity({ messageType: 'MessageInfo' })).toBe('other');
  });

  it('treats a missing level as unclassified rather than an error', () => {
    expect(logSeverity({})).toBe('other');
    expect(logSeverity({ level: undefined })).toBe('other');
  });
});

describe('parseLogErrors', () => {
  it('reads entries that carry only a level (what the plugin actually sends)', () => {
    // Verified live before this fix: a buffer holding seven WARN entries, every
    // messageType undefined, produced "No errors or warnings ... Looks clean."
    const result = parseLogErrors([
      { message: 'ServerScriptService.Main:12: attempt to index nil', level: 'ERR' },
      { message: 'The Parent property of VideoService is locked', level: 'WARN' },
      { message: 'DataModel Loading', level: 'INFO' },
    ] as never);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors[0].scriptPath).toBe('ServerScriptService.Main');
    expect(result.errors[0].line).toBe(12);
  });

  it('still reads entries that carry messageType', () => {
    const result = parseLogErrors([
      { message: 'boom', messageType: 'MessageError' },
      { message: 'careful', messageType: 'MessageWarning' },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('skips entries with no usable message', () => {
    expect(parseLogErrors([{ level: 'ERR' } as never]).errors).toHaveLength(0);
  });
});
