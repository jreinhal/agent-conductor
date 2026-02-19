export interface PIIFinding {
    type: 'email' | 'phone' | 'credit_card' | 'ssn' | 'api_key';
    value: string;
    index: number;
}

export function scanForPII(text: string): PIIFinding[] {
    const findings: PIIFinding[] = [];

    // Regex Patterns
    const patterns = {
        email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
        credit_card: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // Simple 16-digit check
        ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
        api_key: /\b(sk-[a-zA-Z0-9]{32,})\b/g // Basic OpenAI-like key detection
    };

    // Scan
    Object.entries(patterns).forEach(([type, regex]) => {
        let match;
        while ((match = regex.exec(text)) !== null) {
            findings.push({
                type: type as PIIFinding['type'],
                value: match[0],
                index: match.index
            });
        }
    });

    return findings;
}

export function redactPII(text: string, findings: PIIFinding[]): string {
    let redacted = text;
    // Sort descending by index to avoid shifting
    findings.sort((a, b) => b.index - a.index);

    findings.forEach(f => {
        const mask = `[REDACTED ${f.type.toUpperCase()}]`;
        redacted = redacted.substring(0, f.index) + mask + redacted.substring(f.index + f.value.length);
    });

    return redacted;
}
