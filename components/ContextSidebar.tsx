'use client';

import { useAgentStore } from '@/lib/store';

export function ContextSidebar() {
    const sharedContext = useAgentStore((state) => state.sharedContext);
    const setSharedContext = useAgentStore((state) => state.setSharedContext);
    const isSidebarOpen = useAgentStore((state) => state.ui.isSidebarOpen);
    const toggleSidebar = useAgentStore((state) => state.toggleSidebar);

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                    }`}
                onClick={toggleSidebar}
            />

            {/* Sidebar Panel */}
            <div
                className={`fixed inset-y-0 right-0 z-50 w-full md:w-96 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 transform transition-transform duration-300 ease-in-out shadow-2xl ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-md">
                        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                            <span className="text-xl">🧠</span> Project Memory
                        </h2>
                        <button
                            onClick={toggleSidebar}
                            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-4 overflow-y-auto">
                        <div className="prose prose-sm dark:prose-invert mb-4">
                            <p className="text-gray-500 text-sm">
                                Instructions added here will be injected into <strong>every</strong> agent's system prompt.
                                Use this to define your tech stack, coding standards, or project goals.
                            </p>
                        </div>

                        <textarea
                            value={sharedContext}
                            onChange={(e) => setSharedContext(e.target.value)}
                            placeholder="# Project Context\n\n- Tech Stack: Next.js 14, Tailwind\n- Style: Functional components\n- Rules: No useEffect without dependency array..."
                            className="w-full h-[calc(100vh-200px)] p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm leading-relaxed transition-all"
                        />
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 text-xs text-center text-gray-400">
                        Auto-saved locally
                    </div>
                </div>
            </div>
        </>
    );
}
