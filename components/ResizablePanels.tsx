'use client';

import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';

interface PanelConfig {
    id: string;
    minSize?: number;  // Minimum size in pixels
    maxSize?: number;  // Maximum size in pixels
    defaultSize?: number; // Default size as percentage (0-100)
}

interface ResizablePanelsProps {
    children: ReactNode[];
    direction?: 'horizontal' | 'vertical';
    panelConfigs?: PanelConfig[];
    storageKey?: string; // For persisting sizes
    className?: string;
}

const STORAGE_PREFIX = 'agent_conductor_panels_';

export function ResizablePanels({
    children,
    direction = 'horizontal',
    panelConfigs = [],
    storageKey,
    className = '',
}: ResizablePanelsProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [sizes, setSizes] = useState<number[]>(() => {
        // Try to load from storage
        if (storageKey && typeof window !== 'undefined') {
            const saved = localStorage.getItem(STORAGE_PREFIX + storageKey);
            if (saved) {
                try {
                    return JSON.parse(saved);
                } catch { }
            }
        }

        // Use default sizes from config or equal distribution
        const count = children.length;
        return panelConfigs.length > 0
            ? panelConfigs.map(c => c.defaultSize || 100 / count)
            : Array(count).fill(100 / count);
    });

    const [isDragging, setIsDragging] = useState<number | null>(null);
    const startPosRef = useRef(0);
    const startSizesRef = useRef<number[]>([]);

    // Persist sizes to storage
    useEffect(() => {
        if (storageKey && typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(sizes));
        }
    }, [sizes, storageKey]);

    // Handle resize start
    const handleResizeStart = useCallback((index: number, e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(index);
        startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
        startSizesRef.current = [...sizes];
    }, [direction, sizes]);

    // Handle resize move
    useEffect(() => {
        if (isDragging === null) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;

            const containerSize = direction === 'horizontal'
                ? containerRef.current.offsetWidth
                : containerRef.current.offsetHeight;

            const delta = direction === 'horizontal'
                ? e.clientX - startPosRef.current
                : e.clientY - startPosRef.current;

            const deltaPercent = (delta / containerSize) * 100;

            const newSizes = [...startSizesRef.current];
            const leftIndex = isDragging;
            const rightIndex = isDragging + 1;

            // Apply delta to adjacent panels
            let newLeft = newSizes[leftIndex] + deltaPercent;
            let newRight = newSizes[rightIndex] - deltaPercent;

            // Get constraints
            const leftConfig = panelConfigs[leftIndex] || {};
            const rightConfig = panelConfigs[rightIndex] || {};

            const leftMin = leftConfig.minSize ? (leftConfig.minSize / containerSize) * 100 : 10;
            const rightMin = rightConfig.minSize ? (rightConfig.minSize / containerSize) * 100 : 10;
            const leftMax = leftConfig.maxSize ? (leftConfig.maxSize / containerSize) * 100 : 90;
            const rightMax = rightConfig.maxSize ? (rightConfig.maxSize / containerSize) * 100 : 90;

            // Clamp to constraints
            if (newLeft < leftMin) {
                newRight += newLeft - leftMin;
                newLeft = leftMin;
            }
            if (newRight < rightMin) {
                newLeft += newRight - rightMin;
                newRight = rightMin;
            }
            if (newLeft > leftMax) {
                newRight += newLeft - leftMax;
                newLeft = leftMax;
            }
            if (newRight > rightMax) {
                newLeft += newRight - rightMax;
                newRight = rightMax;
            }

            newSizes[leftIndex] = newLeft;
            newSizes[rightIndex] = newRight;

            setSizes(newSizes);
        };

        const handleMouseUp = () => {
            setIsDragging(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, direction, panelConfigs]);

    // Double-click to reset
    const handleDoubleClick = useCallback((index: number) => {
        const count = children.length;
        const equalSize = 100 / count;
        setSizes(Array(count).fill(equalSize));
    }, [children.length]);

    return (
        <div
            ref={containerRef}
            className={`flex ${direction === 'horizontal' ? 'flex-row' : 'flex-col'} h-full w-full ${className}`}
        >
            {children.map((child, index) => (
                <div key={index} className="flex" style={{ flexDirection: direction === 'horizontal' ? 'row' : 'column' }}>
                    {/* Panel */}
                    <div
                        className="overflow-hidden"
                        style={{
                            [direction === 'horizontal' ? 'width' : 'height']: `${sizes[index]}%`,
                            flexShrink: 0,
                        }}
                    >
                        {child}
                    </div>

                    {/* Resize handle (not for last panel) */}
                    {index < children.length - 1 && (
                        <div
                            className={`
                                relative flex-shrink-0 group
                                ${direction === 'horizontal' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}
                                ${isDragging === index ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700 hover:bg-blue-400'}
                                transition-colors
                            `}
                            onMouseDown={(e) => handleResizeStart(index, e)}
                            onDoubleClick={() => handleDoubleClick(index)}
                        >
                            {/* Wider hit area */}
                            <div
                                className={`
                                    absolute
                                    ${direction === 'horizontal'
                                        ? '-left-1 -right-1 top-0 bottom-0'
                                        : '-top-1 -bottom-1 left-0 right-0'}
                                `}
                            />
                            {/* Visual indicator on hover */}
                            <div
                                className={`
                                    absolute opacity-0 group-hover:opacity-100 transition-opacity
                                    ${direction === 'horizontal'
                                        ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8'
                                        : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1 w-8'}
                                    bg-blue-500 rounded-full
                                `}
                            />
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// Preset layouts
export type LayoutPreset = 'equal' | 'focus-left' | 'focus-right' | 'sidebar-left' | 'sidebar-right';

export function getLayoutSizes(preset: LayoutPreset, panelCount: number): number[] {
    switch (preset) {
        case 'equal':
            return Array(panelCount).fill(100 / panelCount);
        case 'focus-left':
            if (panelCount === 2) return [65, 35];
            if (panelCount === 3) return [50, 25, 25];
            return Array(panelCount).fill(100 / panelCount);
        case 'focus-right':
            if (panelCount === 2) return [35, 65];
            if (panelCount === 3) return [25, 25, 50];
            return Array(panelCount).fill(100 / panelCount);
        case 'sidebar-left':
            if (panelCount >= 2) {
                const mainSize = 75;
                const sidebarSize = 25;
                const rest = panelCount - 1;
                return [sidebarSize, ...Array(rest).fill((100 - sidebarSize) / rest)];
            }
            return [100];
        case 'sidebar-right':
            if (panelCount >= 2) {
                const mainSize = 75;
                const sidebarSize = 25;
                const rest = panelCount - 1;
                return [...Array(rest).fill((100 - sidebarSize) / rest), sidebarSize];
            }
            return [100];
        default:
            return Array(panelCount).fill(100 / panelCount);
    }
}
