'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Check,
    File as FileIcon,
    FileCode2,
    FileText,
    FolderOpen,
    Image as ImageIcon,
    Paperclip,
    Trash2,
    X,
} from 'lucide-react';
import {
    LocalAttachmentFile,
    buildFileContextPack,
    detectAttachmentKind,
    formatByteSize,
} from '@/lib/file-context';

interface FileExplorerDockProps {
    files: LocalAttachmentFile[];
    onFilesChange: (files: LocalAttachmentFile[]) => void;
    onClose?: () => void;
}

const MAX_IMPORT_FILES = 150;
const MAX_TEXT_READ_BYTES = 320_000;
const MAX_TEXT_PREVIEW_CHARS = 8_000;
const MAX_IMAGE_PREVIEW_BYTES = 3_000_000;

type BrowserFile = File & { path?: string; webkitRelativePath?: string };

function getPathFromFile(file: BrowserFile): string {
    if (typeof file.path === 'string' && file.path.trim()) return file.path;
    if (typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.trim()) {
        return file.webkitRelativePath;
    }
    return file.name;
}

function normalizeTextPreview(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\u0000/g, '');
}

function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('Failed to read image preview.'));
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
        reader.readAsDataURL(file);
    });
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        const image = new window.Image();
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

function getFileIcon(kind: LocalAttachmentFile['kind']) {
    switch (kind) {
        case 'code':
            return FileCode2;
        case 'text':
            return FileText;
        case 'image':
            return ImageIcon;
        default:
            return FileIcon;
    }
}

function mergeFiles(existing: LocalAttachmentFile[], incoming: LocalAttachmentFile[]): LocalAttachmentFile[] {
    const byPath = new Map<string, LocalAttachmentFile>();
    existing.forEach((file) => {
        byPath.set(file.path.toLowerCase(), file);
    });

    incoming.forEach((file) => {
        const key = file.path.toLowerCase();
        const previous = byPath.get(key);
        if (previous) {
            byPath.set(key, {
                ...file,
                includeInDebate: previous.includeInDebate,
                previewDataUrl: file.previewDataUrl || previous.previewDataUrl,
            });
            return;
        }
        byPath.set(key, file);
    });

    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function normalizeAttachment(file: BrowserFile): Promise<LocalAttachmentFile> {
    const path = getPathFromFile(file);
    const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
    const mimeType = file.type || 'application/octet-stream';
    const kind = detectAttachmentKind(path, mimeType);
    const id = `${path}:${file.lastModified}:${file.size}`;
    const importedAt = Date.now();

    const base: LocalAttachmentFile = {
        id,
        name: file.name,
        path,
        size: file.size,
        mimeType,
        extension,
        kind,
        includeInDebate: kind !== 'binary',
        importedAt,
    };

    if (kind === 'code' || kind === 'text') {
        const sliced = await file.slice(0, MAX_TEXT_READ_BYTES).text();
        const normalized = normalizeTextPreview(sliced);
        base.excerpt = normalized.slice(0, MAX_TEXT_PREVIEW_CHARS);
        base.excerptTruncated =
            normalized.length > MAX_TEXT_PREVIEW_CHARS || file.size > MAX_TEXT_READ_BYTES;
        if (file.size > MAX_TEXT_READ_BYTES) {
            base.warning = `Large file truncated to ${formatByteSize(MAX_TEXT_READ_BYTES)}.`;
        }
        return base;
    }

    if (kind === 'image') {
        if (file.size > MAX_IMAGE_PREVIEW_BYTES) {
            base.warning = `Image preview skipped (>${formatByteSize(MAX_IMAGE_PREVIEW_BYTES)}).`;
            return base;
        }

        try {
            const dataUrl = await readAsDataUrl(file);
            const dimensions = await readImageDimensions(dataUrl);
            base.previewDataUrl = dataUrl;
            if (dimensions) {
                base.imageWidth = dimensions.width;
                base.imageHeight = dimensions.height;
            }
        } catch {
            base.warning = 'Image preview unavailable.';
        }
        return base;
    }

    base.warning = 'Binary file attached as metadata only.';
    base.includeInDebate = false;
    return base;
}

export function FileExplorerDock({
    files,
    onFilesChange,
    onClose,
}: FileExplorerDockProps) {
    const filePickerRef = useRef<HTMLInputElement>(null);
    const folderPickerRef = useRef<HTMLInputElement>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

    useEffect(() => {
        const node = folderPickerRef.current as (HTMLInputElement & { webkitdirectory?: boolean; directory?: boolean }) | null;
        if (!node) return;
        node.webkitdirectory = true;
        node.directory = true;
    }, []);

    useEffect(() => {
        if (files.length === 0) {
            setSelectedFileId(null);
            return;
        }
        if (!selectedFileId || !files.some((file) => file.id === selectedFileId)) {
            setSelectedFileId(files[0].id);
        }
    }, [files, selectedFileId]);

    const includedCount = useMemo(
        () => files.filter((file) => file.includeInDebate).length,
        [files]
    );
    const contextCharCount = useMemo(() => buildFileContextPack(files).length, [files]);
    const selectedFile = useMemo(
        () => files.find((file) => file.id === selectedFileId) || null,
        [files, selectedFileId]
    );

    const updateFile = useCallback((fileId: string, patch: Partial<LocalAttachmentFile>) => {
        onFilesChange(
            files.map((file) => (
                file.id === fileId
                    ? { ...file, ...patch }
                    : file
            ))
        );
    }, [files, onFilesChange]);

    const removeFile = useCallback((fileId: string) => {
        onFilesChange(files.filter((file) => file.id !== fileId));
    }, [files, onFilesChange]);

    const importFromFileList = useCallback(async (list: FileList | null) => {
        if (!list || list.length === 0) return;

        setImportError(null);
        setIsImporting(true);
        try {
            const nextFiles = Array.from(list).slice(0, MAX_IMPORT_FILES) as BrowserFile[];
            const normalized = await Promise.all(nextFiles.map((file) => normalizeAttachment(file)));
            onFilesChange(mergeFiles(files, normalized));
        } catch (error) {
            setImportError(error instanceof Error ? error.message : 'Failed to import selected files.');
        } finally {
            setIsImporting(false);
        }
    }, [files, onFilesChange]);

    const handleFilePicker = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        await importFromFileList(event.target.files);
        event.target.value = '';
    }, [importFromFileList]);

    const openFilePicker = useCallback(() => {
        filePickerRef.current?.click();
    }, []);

    const openFolderPicker = useCallback(() => {
        folderPickerRef.current?.click();
    }, []);

    return (
        <div className="panel-shell rounded-2xl overflow-hidden border border-[color:var(--ac-border-soft)]">
            <input
                ref={filePickerRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilePicker}
            />
            <input
                ref={folderPickerRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFilePicker}
            />

            <div className="px-4 py-3 border-b border-[color:var(--ac-border-soft)] flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <Paperclip className="w-4 h-4 text-[color:var(--ac-text-muted)]" />
                        <h3 className="text-sm font-semibold text-[color:var(--ac-text)]">
                            File Explorer
                        </h3>
                    </div>
                    <p className="text-xs text-[color:var(--ac-text-muted)] mt-1">
                        Attach local files so every model can debate against shared evidence.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={openFilePicker}
                        disabled={isImporting}
                        className="control-chip px-3 py-1.5 text-xs"
                    >
                        Add Files
                    </button>
                    <button
                        onClick={openFolderPicker}
                        disabled={isImporting}
                        className="control-chip px-3 py-1.5 text-xs flex items-center gap-1.5"
                    >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Add Folder
                    </button>
                    {files.length > 0 && (
                        <button
                            onClick={() => onFilesChange([])}
                            className="control-chip px-3 py-1.5 text-xs text-[color:var(--ac-danger)]"
                            title="Clear all attached files"
                        >
                            Clear
                        </button>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="control-chip p-1.5"
                            title="Close file explorer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            <div className="px-4 py-3 border-b border-[color:var(--ac-border-soft)] flex flex-wrap items-center gap-2 text-xs">
                <span className="ac-badge px-2 py-1 rounded">files {files.length}</span>
                <span className="ac-badge px-2 py-1 rounded">included {includedCount}</span>
                <span className="ac-badge px-2 py-1 rounded">context {contextCharCount.toLocaleString()} chars</span>
                {isImporting && (
                    <span className="text-[color:var(--ac-text-muted)]">Importing...</span>
                )}
                {importError && (
                    <span className="text-[color:var(--ac-danger)]">{importError}</span>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="border-r border-[color:var(--ac-border-soft)] max-h-[340px] overflow-y-auto">
                    {files.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-[color:var(--ac-text-muted)]">
                            No files selected yet. Add files or a folder to start.
                        </div>
                    ) : (
                        <div className="p-3 space-y-2">
                            {files.map((file) => {
                                const Icon = getFileIcon(file.kind);
                                const isSelected = file.id === selectedFileId;
                                return (
                                    <div
                                        key={file.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedFileId(file.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setSelectedFileId(file.id);
                                            }
                                        }}
                                        className={`rounded-xl border px-3 py-2 cursor-pointer transition-all ${
                                            isSelected
                                                ? 'border-[color:var(--ac-accent)] bg-[color:var(--ac-surface-strong)]'
                                                : 'border-[color:var(--ac-border-soft)] hover:border-[color:var(--ac-border)]'
                                        }`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <button
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    updateFile(file.id, { includeInDebate: !file.includeInDebate });
                                                }}
                                                className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                                                    file.includeInDebate
                                                        ? 'border-[color:var(--ac-accent)] bg-[color:var(--ac-accent)] text-white'
                                                        : 'border-[color:var(--ac-border-soft)] text-[color:var(--ac-text-muted)]'
                                                }`}
                                                title={file.includeInDebate ? 'Exclude from debate context' : 'Include in debate context'}
                                            >
                                                {file.includeInDebate ? <Check className="w-3 h-3" /> : null}
                                            </button>

                                            <Icon className="w-4 h-4 mt-0.5 text-[color:var(--ac-text-muted)]" />

                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-[color:var(--ac-text)] truncate">
                                                    {file.name}
                                                </p>
                                                <p className="text-[11px] text-[color:var(--ac-text-muted)] truncate">
                                                    {file.path}
                                                </p>
                                                <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                                                    <span className="ac-badge px-1.5 py-0.5 rounded uppercase">{file.kind}</span>
                                                    <span className="text-[color:var(--ac-text-muted)]">{formatByteSize(file.size)}</span>
                                                </div>
                                                {file.warning && (
                                                    <p className="text-[11px] mt-1 text-[color:var(--ac-text-muted)]">
                                                        {file.warning}
                                                    </p>
                                                )}
                                            </div>

                                            <button
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    removeFile(file.id);
                                                }}
                                                className="control-chip p-1.5 text-[color:var(--ac-text-muted)] hover:text-[color:var(--ac-danger)]"
                                                title="Remove file"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="max-h-[340px] overflow-y-auto p-3">
                    {!selectedFile ? (
                        <div className="text-sm text-[color:var(--ac-text-muted)]">
                            Select a file to preview metadata and extracted content.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div>
                                <p className="text-sm font-semibold text-[color:var(--ac-text)] truncate">
                                    {selectedFile.name}
                                </p>
                                <p className="text-xs text-[color:var(--ac-text-muted)] break-all">
                                    {selectedFile.path}
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="ac-badge px-2 py-1 rounded uppercase">{selectedFile.kind}</span>
                                <span className="ac-badge px-2 py-1 rounded">{formatByteSize(selectedFile.size)}</span>
                                {selectedFile.imageWidth && selectedFile.imageHeight && (
                                    <span className="ac-badge px-2 py-1 rounded">
                                        {selectedFile.imageWidth} x {selectedFile.imageHeight}
                                    </span>
                                )}
                                <span className={`px-2 py-1 rounded ${
                                    selectedFile.includeInDebate
                                        ? 'bg-emerald-500/15 text-emerald-300'
                                        : 'bg-amber-500/15 text-amber-300'
                                }`}>
                                    {selectedFile.includeInDebate ? 'included' : 'excluded'}
                                </span>
                            </div>

                            {selectedFile.kind === 'image' && selectedFile.previewDataUrl && (
                                <div className="rounded-lg overflow-hidden border border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface-strong)]">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={selectedFile.previewDataUrl}
                                        alt={selectedFile.name}
                                        className="w-full max-h-[180px] object-contain"
                                    />
                                </div>
                            )}

                            {selectedFile.excerpt && (
                                <pre className="rounded-lg ac-soft-surface p-3 text-[11px] leading-relaxed overflow-auto max-h-[180px] whitespace-pre-wrap break-words">
                                    {selectedFile.excerpt}
                                </pre>
                            )}

                            {!selectedFile.excerpt && selectedFile.kind !== 'image' && (
                                <div className="rounded-lg ac-soft-surface p-3 text-[11px] text-[color:var(--ac-text-muted)]">
                                    No inline content preview available for this file type.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
