export interface ValidationIssue {
  message: string;
  filePath: string;
  line?: number;
  column?: number;
  expected?: string;
  received?: string;
}

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }

  format(): string {
    const lines: string[] = [this.message];
    for (const issue of this.issues) {
      const location = issue.line
        ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}`
        : '';
      const detail = issue.expected
        ? ` (expected: ${issue.expected}, received: ${issue.received})`
        : '';
      lines.push(`  ${issue.filePath}${location}: ${issue.message}${detail}`);
    }
    return lines.join('\n');
  }
}
