import { parseLogErrors, formatDiagnostics } from '../diagnostics.js';

describe('parseLogErrors', () => {
  it('classifies errors and warnings by message type', () => {
    const result = parseLogErrors([
      { message: 'ServerScriptService.Main:12: attempt to index nil with "Foo"', messageType: 'Enum.MessageType.MessageError' },
      { message: 'Something deprecated', messageType: 'Enum.MessageType.MessageWarning' },
      { message: 'hello', messageType: 'Enum.MessageType.MessageOutput' },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('extracts the script path and line number from an error', () => {
    const result = parseLogErrors([
      { message: 'ServerScriptService.Systems.Combat:42: attempt to call a nil value', messageType: 'MessageError' },
    ]);
    expect(result.errors[0]).toMatchObject({
      scriptPath: 'ServerScriptService.Systems.Combat',
      line: 42,
    });
  });

  it('keeps an error without a parseable location (no script/line)', () => {
    const result = parseLogErrors([
      { message: 'Requested module experienced an error while loading', messageType: 'MessageError' },
    ]);
    expect(result.errors[0].scriptPath).toBeUndefined();
    expect(result.errors[0].message).toMatch(/Requested module/);
  });

  it('ignores junk entries', () => {
    const result = parseLogErrors([null, {}, { message: 5 }] as unknown as Array<{ message: string; messageType: string }>);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('formatDiagnostics', () => {
  it('summarizes counts and lists affected scripts', () => {
    const report = formatDiagnostics({
      errors: [{ message: 'boom', messageType: 'MessageError', scriptPath: 'ServerScriptService.Main', line: 12 }],
      warnings: [{ message: 'meh', messageType: 'MessageWarning' }],
    });
    expect(report).toMatch(/1 error/i);
    expect(report).toMatch(/1 warning/i);
    expect(report).toContain('ServerScriptService.Main');
    expect(report).toContain('12');
  });

  it('reports a clean bill of health when there are no errors or warnings', () => {
    expect(formatDiagnostics({ errors: [], warnings: [] })).toMatch(/no errors|clean/i);
  });

  it('warns that diagnostics only cover the current Studio output buffer', () => {
    const report = formatDiagnostics({ errors: [], warnings: [] });
    expect(report).toContain('current Studio output log');
    expect(report).toContain('restart the playtest');
  });
});
