'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface Position {
    x: number;
    y: number;
}

export interface Velocity {
    vx: number;
    vy: number;
}

export interface PhysicsConfig {
    friction?: number;      // 0-1, how quickly velocity decays (0.92 = smooth glide)
    snapThreshold?: number; // Distance to trigger snap
    snapStrength?: number;  // 0-1, how strongly it pulls to snap point
    bounds?: {              // Container bounds
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    snapPoints?: Position[]; // Points to snap to
    snapToGrid?: number;     // Grid size for snapping
}

const DEFAULT_CONFIG: PhysicsConfig = {
    friction: 0.92,
    snapThreshold: 50,
    snapStrength: 0.3,
    snapToGrid: 0,
};

export function usePhysics(
    initialPosition: Position,
    config: PhysicsConfig = {}
) {
    const settings = { ...DEFAULT_CONFIG, ...config };

    const [position, setPosition] = useState<Position>(initialPosition);
    const [isDragging, setIsDragging] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);

    const velocityRef = useRef<Velocity>({ vx: 0, vy: 0 });
    const lastPosRef = useRef<Position>(initialPosition);
    const lastTimeRef = useRef<number>(0);
    const animationRef = useRef<number | null>(null);
    const dragStartRef = useRef<Position>({ x: 0, y: 0 });
    const elementStartRef = useRef<Position>(initialPosition);

    // Clamp position to bounds
    const clampToBounds = useCallback((pos: Position): Position => {
        if (!settings.bounds) return pos;
        return {
            x: Math.max(settings.bounds.minX, Math.min(settings.bounds.maxX, pos.x)),
            y: Math.max(settings.bounds.minY, Math.min(settings.bounds.maxY, pos.y)),
        };
    }, [settings.bounds]);

    // Find nearest snap point
    const findSnapPoint = useCallback((pos: Position): Position | null => {
        // Grid snapping
        if (settings.snapToGrid && settings.snapToGrid > 0) {
            const gridX = Math.round(pos.x / settings.snapToGrid) * settings.snapToGrid;
            const gridY = Math.round(pos.y / settings.snapToGrid) * settings.snapToGrid;
            const dist = Math.hypot(gridX - pos.x, gridY - pos.y);
            if (dist < settings.snapThreshold!) {
                return { x: gridX, y: gridY };
            }
        }

        // Explicit snap points
        if (settings.snapPoints && settings.snapPoints.length > 0) {
            let nearest: Position | null = null;
            let nearestDist = Infinity;

            for (const point of settings.snapPoints) {
                const dist = Math.hypot(point.x - pos.x, point.y - pos.y);
                if (dist < nearestDist && dist < settings.snapThreshold!) {
                    nearest = point;
                    nearestDist = dist;
                }
            }

            return nearest;
        }

        return null;
    }, [settings.snapPoints, settings.snapThreshold, settings.snapToGrid]);

    // Animation loop for momentum
    const animate = useCallback(() => {
        const { vx, vy } = velocityRef.current;

        // Stop if velocity is negligible
        if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
            velocityRef.current = { vx: 0, vy: 0 };
            setIsAnimating(false);

            // Final snap check
            setPosition(prev => {
                const snapPoint = findSnapPoint(prev);
                return snapPoint || prev;
            });
            return;
        }

        // Apply friction
        velocityRef.current = {
            vx: vx * settings.friction!,
            vy: vy * settings.friction!,
        };

        // Update position
        setPosition(prev => {
            let newPos = {
                x: prev.x + velocityRef.current.vx,
                y: prev.y + velocityRef.current.vy,
            };

            // Check for snap attraction while moving
            const snapPoint = findSnapPoint(newPos);
            if (snapPoint) {
                // Pull towards snap point
                newPos = {
                    x: newPos.x + (snapPoint.x - newPos.x) * settings.snapStrength!,
                    y: newPos.y + (snapPoint.y - newPos.y) * settings.snapStrength!,
                };

                // If close enough, snap and stop
                if (Math.hypot(snapPoint.x - newPos.x, snapPoint.y - newPos.y) < 5) {
                    velocityRef.current = { vx: 0, vy: 0 };
                    return snapPoint;
                }
            }

            return clampToBounds(newPos);
        });

        animationRef.current = requestAnimationFrame(animate);
    }, [settings.friction, settings.snapStrength, findSnapPoint, clampToBounds]);

    // Start momentum animation
    const startMomentum = useCallback(() => {
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        setIsAnimating(true);
        animationRef.current = requestAnimationFrame(animate);
    }, [animate]);

    // Drag handlers
    const handleDragStart = useCallback((clientX: number, clientY: number) => {
        // Stop any ongoing animation
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }

        setIsDragging(true);
        setIsAnimating(false);
        velocityRef.current = { vx: 0, vy: 0 };

        dragStartRef.current = { x: clientX, y: clientY };
        elementStartRef.current = position;
        lastPosRef.current = { x: clientX, y: clientY };
        lastTimeRef.current = performance.now();
    }, [position]);

    const handleDragMove = useCallback((clientX: number, clientY: number) => {
        if (!isDragging) return;

        const now = performance.now();
        const dt = now - lastTimeRef.current;

        // Calculate velocity (pixels per frame at 60fps)
        if (dt > 0) {
            const scale = 16.67 / dt; // Normalize to 60fps
            velocityRef.current = {
                vx: (clientX - lastPosRef.current.x) * scale,
                vy: (clientY - lastPosRef.current.y) * scale,
            };
        }

        lastPosRef.current = { x: clientX, y: clientY };
        lastTimeRef.current = now;

        // Update position
        const deltaX = clientX - dragStartRef.current.x;
        const deltaY = clientY - dragStartRef.current.y;

        setPosition(clampToBounds({
            x: elementStartRef.current.x + deltaX,
            y: elementStartRef.current.y + deltaY,
        }));
    }, [isDragging, clampToBounds]);

    const handleDragEnd = useCallback(() => {
        if (!isDragging) return;

        setIsDragging(false);

        // Check if we have enough velocity for momentum
        const { vx, vy } = velocityRef.current;
        const speed = Math.hypot(vx, vy);

        if (speed > 2) {
            startMomentum();
        } else {
            // Just snap if not enough momentum
            setPosition(prev => {
                const snapPoint = findSnapPoint(prev);
                return snapPoint || prev;
            });
        }
    }, [isDragging, startMomentum, findSnapPoint]);

    // Cleanup animation on unmount
    useEffect(() => {
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, []);

    // Mouse event handlers
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        handleDragStart(e.clientX, e.clientY);
    }, [handleDragStart]);

    // Touch event handlers
    const onTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
    }, [handleDragStart]);

    // Global move/end handlers (attached to window when dragging)
    useEffect(() => {
        if (!isDragging) return;

        const onMouseMove = (e: MouseEvent) => {
            handleDragMove(e.clientX, e.clientY);
        };

        const onMouseUp = () => {
            handleDragEnd();
        };

        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
        };

        const onTouchEnd = () => {
            handleDragEnd();
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('touchmove', onTouchMove);
        window.addEventListener('touchend', onTouchEnd);

        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
        };
    }, [isDragging, handleDragMove, handleDragEnd]);

    // Teleport to position (no animation)
    const teleport = useCallback((newPosition: Position) => {
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }
        velocityRef.current = { vx: 0, vy: 0 };
        setIsAnimating(false);
        setPosition(clampToBounds(newPosition));
    }, [clampToBounds]);

    // Animate to position
    const animateTo = useCallback((target: Position, duration: number = 300) => {
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }

        const start = position;
        const startTime = performance.now();

        const step = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);

            setPosition({
                x: start.x + (target.x - start.x) * eased,
                y: start.y + (target.y - start.y) * eased,
            });

            if (progress < 1) {
                animationRef.current = requestAnimationFrame(step);
            } else {
                setIsAnimating(false);
            }
        };

        setIsAnimating(true);
        animationRef.current = requestAnimationFrame(step);
    }, [position]);

    return {
        position,
        isDragging,
        isAnimating,
        dragHandlers: {
            onMouseDown,
            onTouchStart,
        },
        teleport,
        animateTo,
    };
}
