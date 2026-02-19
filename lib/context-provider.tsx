'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface ProjectContextType {
    sharedContext: string;
    setSharedContext: (context: string) => void;
    isSidebarOpen: boolean;
    toggleSidebar: () => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function ProjectContextProvider({ children }: { children: React.ReactNode }) {
    const [sharedContext, setSharedContext] = useState<string>('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // Load from local storage on mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('agent-conductor-context');
            if (saved) setSharedContext(saved);
        }
    }, []);

    // Save to local storage on change
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('agent-conductor-context', sharedContext);
        }
    }, [sharedContext]);

    const toggleSidebar = () => setIsSidebarOpen(prev => !prev);

    return (
        <ProjectContext.Provider value={{ sharedContext, setSharedContext, isSidebarOpen, toggleSidebar }}>
            {children}
        </ProjectContext.Provider>
    );
}

export function useProjectContext() {
    const context = useContext(ProjectContext);
    if (context === undefined) {
        throw new Error('useProjectContext must be used within a ProjectContextProvider');
    }
    return context;
}
