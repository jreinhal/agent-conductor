'use client';

import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { usePhysics, Position, PhysicsConfig } from '@/lib/usePhysics';

interface PanelState {
    id: string;
    position: Position;
    size: { width: number; height: number };
    zIndex: number;
}

interface CanvasContextType {
    bringToFront: (id: string) => void;
    registerPanel: (id: string, initialPos: Position) => void;
    unregisterPanel: (id: string) => void;
    getPanelState: (id: string) => PanelState | undefined;
    updatePanelPosition: (id: string, position: Position) => void;
    snapPoints: Position[];
}

// Panel wrapper with physics
interface DraggablePanelProps {
    id: string;
    children: ReactNode;
    initialPosition?: Position;
    className?: string;
    onFocus?: () => void;
    dragHandle?: string; // CSS selector for drag handle
}

export function DraggablePanel({
    id,
    children,
    initialPosition = { x: 100, y: 100 },
    className = '',
    onFocus,
    dragHandle,
}: DraggablePanelProps) {
    const [zIndex, setZIndex] = useState(1);
    const [bounds, setBounds] = useState<PhysicsConfig['bounds']>();
    const panelRef = useRef<HTMLDivElement>(null);

    // Calculate bounds on mount and resize
    useEffect(() => {
        const updateBounds = () => {
            if (panelRef.current) {
                const rect = panelRef.current.getBoundingClientRect();
                setBounds({
                    minX: 0,
                    maxX: window.innerWidth - rect.width,
                    minY: 0,
                    maxY: window.innerHeight - rect.height,
                });
            }
        };

        updateBounds();
        window.addEventListener('resize', updateBounds);
        return () => window.removeEventListener('resize', updateBounds);
    }, []);

    const { position, isDragging, dragHandlers } = usePhysics(initialPosition, {
        friction: 0.94,
        snapThreshold: 30,
        snapToGrid: 20,
        bounds,
    });

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Check if we should only drag from handle
        if (dragHandle) {
            const target = e.target as HTMLElement;
            if (!target.closest(dragHandle)) return;
        }

        setZIndex(Date.now()); // Bring to front
        onFocus?.();
        dragHandlers.onMouseDown(e);
    }, [dragHandle, dragHandlers, onFocus]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (dragHandle) {
            const target = e.target as HTMLElement;
            if (!target.closest(dragHandle)) return;
        }

        setZIndex(Date.now());
        onFocus?.();
        dragHandlers.onTouchStart(e);
    }, [dragHandle, dragHandlers, onFocus]);

    return (
        <div
            ref={panelRef}
            className={`absolute select-none ${isDragging ? 'cursor-grabbing' : ''} ${className}`}
            style={{
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
                zIndex,
                willChange: isDragging ? 'transform' : 'auto',
            }}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
        >
            {children}
        </div>
    );
}

// The main canvas container
interface CanvasProps {
    children: ReactNode;
    className?: string;
}

export function Canvas({ children, className = '' }: CanvasProps) {
    return (
        <div
            className={`relative w-full h-full overflow-hidden ${className}`}
            style={{ touchAction: 'none' }}
        >
            {children}
        </div>
    );
}

// Snap zone indicator (visual hint for docking areas)
interface SnapZoneProps {
    position: 'left' | 'right' | 'top' | 'bottom' | 'center';
    isActive?: boolean;
}

export function SnapZone({ position, isActive = false }: SnapZoneProps) {
    const positionStyles: Record<string, string> = {
        left: 'left-0 top-0 bottom-0 w-1',
        right: 'right-0 top-0 bottom-0 w-1',
        top: 'top-0 left-0 right-0 h-1',
        bottom: 'bottom-0 left-0 right-0 h-1',
        center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full',
    };

    return (
        <div
            className={`
                absolute pointer-events-none transition-all duration-200
                ${positionStyles[position]}
                ${isActive
                    ? 'bg-blue-500/30 shadow-lg shadow-blue-500/20'
                    : 'bg-transparent'}
            `}
        />
    );
}
