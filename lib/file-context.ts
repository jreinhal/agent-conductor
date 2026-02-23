export type LocalAttachmentKind = 'code' | 'text' | 'image' | 'binary';

export interface LocalAttachmentFile {
    id: string;
    name: string;
    path: string;
    size: number;
    mimeType: string;
    extension: string;
    kind: LocalAttachmentKind;
    includeInDebate: boolean;
    excerpt?: string;
    excerptTruncated?: boolean;
    imageWidth?: number;
    imageHeight?: number;
    previewDataUrl?: string;
    warning?: string;
    importedAt: number;
}

export interface FileContextPackOptions {
    maxFiles?: number;
    maxChars?: number;
    maxCharsPerFile?: number;
}

const DEFAULT_MAX_FILES = 12;
const DEFAULT_MAX_CHARS = 24_000;
const DEFAULT_MAX_CHARS_PER_FILE = 3_500;

const CODE_EXTENSIONS = new Set([
    'c',
    'cc',
    'cpp',
    'cs',
    'css',
    'go',
    'h',
    'hpp',
    'html',
    'java',
    'js',
    'jsx',
    'json',
    'kt',
    'm',
    'md',
    'php',
    'py',
    'rb',
    'rs',
    'sh',
    'sql',
    'swift',
    'ts',
    'tsx',
    'vue',
    'xml',
    'yaml',
    'yml',
]);

const TEXT_EXTENSIONS = new Set([
    'csv',
    'env',
    'ini',
    'log',
    'rst',
    'txt',
    'toml',
]);

const IMAGE_EXTENSIONS = new Set([
    'avif',
    'bmp',
    'gif',
    'heic',
    'jpeg',
    'jpg',
    'png',
    'svg',
    'webp',
]);

function getExtension(path: string): string {
    const normalized = path.toLowerCase().trim();
    const dotIndex = normalized.lastIndexOf('.');
    if (dotIndex < 0 || dotIndex === normalized.length - 1) return '';
    return normalized.slice(dotIndex + 1);
}

export function detectAttachmentKind(path: string, mimeType: string = ''): LocalAttachmentKind {
    const extension = getExtension(path);
    const normalizedMime = mimeType.toLowerCase();

    if (normalizedMime.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
        return 'image';
    }
    if (
        normalizedMime.startsWith('text/') ||
        normalizedMime.includes('json') ||
        normalizedMime.includes('javascript') ||
        normalizedMime.includes('typescript') ||
        normalizedMime.includes('xml') ||
        normalizedMime.includes('yaml') ||
        CODE_EXTENSIONS.has(extension)
    ) {
        return 'code';
    }
    if (TEXT_EXTENSIONS.has(extension)) {
        return 'text';
    }
    return 'binary';
}

export function formatByteSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

function fenceLanguageForPath(path: string, kind: LocalAttachmentKind): string {
    if (kind === 'text') return 'text';
    if (kind !== 'code') return '';

    const extension = getExtension(path);
    const mapping: Record<string, string> = {
        c: 'c',
        cc: 'cpp',
        cpp: 'cpp',
        cs: 'csharp',
        css: 'css',
        go: 'go',
        h: 'c',
        hpp: 'cpp',
        html: 'html',
        ini: 'ini',
        java: 'java',
        js: 'javascript',
        jsx: 'jsx',
        json: 'json',
        kt: 'kotlin',
        m: 'objectivec',
        md: 'markdown',
        php: 'php',
        py: 'python',
        rb: 'ruby',
        rs: 'rust',
        sh: 'bash',
        sql: 'sql',
        swift: 'swift',
        toml: 'toml',
        ts: 'typescript',
        tsx: 'tsx',
        vue: 'vue',
        xml: 'xml',
        yaml: 'yaml',
        yml: 'yaml',
    };
    return mapping[extension] || 'text';
}

function truncate(value: string, limit: number): { text: string; truncated: boolean } {
    if (value.length <= limit) return { text: value, truncated: false };
    return { text: value.slice(0, Math.max(0, limit)), truncated: true };
}

export function buildFileContextPack(
    files: LocalAttachmentFile[],
    options: FileContextPackOptions = {}
): string {
    const included = files.filter((file) => file.includeInDebate);
    if (included.length === 0) return '';

    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    const maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE;

    const sections: string[] = [
        '## Attached Local File Context',
        'Treat these files as high-priority user-provided evidence for this response.',
    ];

    let usedChars = sections.join('\n\n').length;
    let emittedFiles = 0;

    for (const file of included) {
        if (emittedFiles >= maxFiles || usedChars >= maxChars) break;

        const section = [
            `### File ${emittedFiles + 1}: ${file.path}`,
            `kind=${file.kind}, mime=${file.mimeType || 'unknown'}, size=${formatByteSize(file.size)}`,
        ];

        if (file.kind === 'image') {
            const dimensionText =
                file.imageWidth && file.imageHeight
                    ? `${file.imageWidth}x${file.imageHeight}`
                    : 'unknown';
            section.push(`image_dimensions=${dimensionText}`);
            section.push(
                'image_note=Image bytes are not embedded in this text channel. Use metadata and filename cues; request focused visual details if needed.'
            );
        } else if (file.excerpt && file.excerpt.trim()) {
            const clipped = truncate(file.excerpt, maxCharsPerFile);
            const language = fenceLanguageForPath(file.path, file.kind);
            section.push(`\`\`\`${language}\n${clipped.text}\n\`\`\``);
            if (file.excerptTruncated || clipped.truncated) {
                section.push('content_note=File content was truncated for context limits.');
            }
        } else {
            section.push(
                `content_note=${file.warning || 'No inline excerpt available; reason over metadata only.'}`
            );
        }

        const rendered = section.join('\n');
        const nextSize = usedChars + rendered.length + 2;
        if (nextSize > maxChars) {
            break;
        }

        sections.push(rendered);
        usedChars = nextSize;
        emittedFiles += 1;
    }

    if (included.length > emittedFiles) {
        sections.push(
            `context_note=${included.length - emittedFiles} additional attached files were omitted due to context limits.`
        );
    }

    return sections.join('\n\n');
}
