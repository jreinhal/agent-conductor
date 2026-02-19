'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface TerminalProcess {
    id: string;
    command: string;
    output: string[];
    status: 'running' | 'completed' | 'error';
    startTime: number;
    endTime?: number;
    exitCode?: number;
}

interface TerminalDockProps {
    isOpen: boolean;
    onClose: () => void;
    onToggle: () => void;
    height?: number;
}

export function TerminalDock({
    isOpen,
    onClose,
    onToggle,
    height = 200,
}: TerminalDockProps) {
    const [processes, setProcesses] = useState<TerminalProcess[]>([]);
    const [activeProcessId, setActiveProcessId] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [dockHeight, setDockHeight] = useState(height);
    const [isResizing, setIsResizing] = useState(false);

    const outputRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const startHeightRef = useRef(height);
    const startYRef = useRef(0);

    const activeProcess = processes.find(p => p.id === activeProcessId);

    // Auto-scroll output
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [activeProcess?.output]);

    // Focus input when dock opens
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    // Handle resize
    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        startYRef.current = e.clientY;
        startHeightRef.current = dockHeight;
    }, [dockHeight]);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const delta = startYRef.current - e.clientY;
            const newHeight = Math.max(100, Math.min(500, startHeightRef.current + delta));
            setDockHeight(newHeight);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    // Execute command (simulated - would need actual backend)
    const executeCommand = useCallback((command: string) => {
        const processId = `proc-${Date.now()}`;
        const newProcess: TerminalProcess = {
            id: processId,
            command,
            output: [`$ ${command}`, 'Executing...'],
            status: 'running',
            startTime: Date.now(),
        };

        setProcesses(prev => [...prev, newProcess]);
        setActiveProcessId(processId);
        setInput('');

        // Simulate command execution
        // In a real implementation, this would use WebSocket or fetch to a backend
        setTimeout(() => {
            setProcesses(prev => prev.map(p => {
                if (p.id !== processId) return p;
                return {
                    ...p,
                    output: [
                        ...p.output.slice(0, -1),
                        `Command "${command}" would execute here.`,
                        `(Terminal integration requires Electron/backend)`,
                        '',
                    ],
                    status: 'completed',
                    endTime: Date.now(),
                    exitCode: 0,
                };
            }));
        }, 500);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        executeCommand(input.trim());
    };

    const clearProcess = (processId: string) => {
        setProcesses(prev => prev.filter(p => p.id !== processId));
        if (activeProcessId === processId) {
            const remaining = processes.filter(p => p.id !== processId);
            setActiveProcessId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
        }
    };

    const runningCount = processes.filter(p => p.status === 'running').length;

    if (!isOpen) {
        // Collapsed bar
        return (
            <button
                onClick={onToggle}
                className="fixed bottom-0 left-0 right-0 h-8 bg-gray-900 border-t border-gray-700 flex items-center justify-between px-4 text-xs text-gray-400 hover:bg-gray-800 transition-colors z-40"
            >
                <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>Terminal</span>
                    {runningCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-green-600 text-white text-[10px] rounded-full">
                            {runningCount} running
                        </span>
                    )}
                </div>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                </svg>
            </button>
        );
    }

    return (
        <div
            className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 z-40 flex flex-col"
            style={{ height: dockHeight }}
        >
            {/* Resize handle */}
            <div
                className="h-1 bg-gray-700 hover:bg-blue-500 cursor-row-resize transition-colors"
                onMouseDown={handleResizeStart}
            />

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                <div className="flex items-center gap-2">
                    {/* Process tabs */}
                    <div className="flex items-center gap-1">
                        {processes.map(process => (
                            <button
                                key={process.id}
                                onClick={() => setActiveProcessId(process.id)}
                                className={`
                                    flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors
                                    ${activeProcessId === process.id
                                        ? 'bg-gray-700 text-gray-200'
                                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}
                                `}
                            >
                                <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                        process.status === 'running' ? 'bg-green-500 animate-pulse' :
                                        process.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                                    }`}
                                />
                                <span className="max-w-[100px] truncate">{process.command}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        clearProcess(process.id);
                                    }}
                                    className="ml-1 text-gray-500 hover:text-gray-300"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </button>
                        ))}
                    </div>

                    {/* New terminal button */}
                    <button
                        onClick={() => inputRef.current?.focus()}
                        className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                        title="New command"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                </div>

                <button
                    onClick={onToggle}
                    className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
            </div>

            {/* Output area */}
            <div
                ref={outputRef}
                className="flex-1 overflow-auto p-3 font-mono text-xs text-gray-300"
            >
                {activeProcess ? (
                    activeProcess.output.map((line, index) => (
                        <div key={index} className="whitespace-pre-wrap">
                            {line.startsWith('$') ? (
                                <span className="text-green-400">{line}</span>
                            ) : line.includes('error') || line.includes('Error') ? (
                                <span className="text-red-400">{line}</span>
                            ) : (
                                line
                            )}
                        </div>
                    ))
                ) : (
                    <div className="text-gray-500 italic">
                        No active process. Type a command below.
                    </div>
                )}
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-2 bg-gray-800 border-t border-gray-700">
                <span className="text-green-400 text-xs font-mono">$</span>
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Enter command..."
                    className="flex-1 bg-transparent text-gray-200 text-xs font-mono focus:outline-none placeholder-gray-600"
                />
                <button
                    type="submit"
                    disabled={!input.trim()}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Run
                </button>
            </form>
        </div>
    );
}

// Hook for terminal state
export function useTerminalDock() {
    const [isOpen, setIsOpen] = useState(false);

    const toggle = useCallback(() => setIsOpen(prev => !prev), []);
    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);

    return { isOpen, toggle, open, close };
}
