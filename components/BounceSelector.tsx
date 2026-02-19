'use client';

import { PERSONAS, Persona } from '@/lib/personas';

interface BounceSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (persona: Persona) => void;
}

export function BounceSelector({ isOpen, onClose, onSelect }: BounceSelectorProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-gray-800 scale-100 sm:scale-100">
                <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
                    <h3 className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                        {/* Conductor Baton Icon */}
                        <svg className="w-5 h-5 text-gray-600 dark:text-gray-400 rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.5 4.5L4.5 13.5m0 0l-2.25 2.25a1.5 1.5 0 002.25 2.25l2.25-2.25m9-9l2.25-2.25a1.5 1.5 0 00-2.25-2.25L13.5 4.5" />
                        </svg>
                        Select Specialist
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 grid gap-3 max-h-[60vh] overflow-y-auto">
                    {PERSONAS.map(persona => (
                        <button
                            key={persona.id}
                            onClick={() => onSelect(persona)}
                            className="flex items-start gap-4 p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 text-left transition-all group"
                        >
                            <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center mt-1 group-hover:bg-white dark:group-hover:bg-gray-700 group-hover:shadow-sm transition-all border border-transparent group-hover:border-gray-200 dark:group-hover:border-gray-600">
                                <span className="font-semibold text-sm">{persona.name[0]}</span>
                            </div>
                            <div>
                                <h4 className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-black dark:group-hover:text-white">
                                    {persona.name}
                                </h4>
                                <p className="text-xs text-gray-500 mt-0.5 mb-1">{persona.role}</p>
                                <p className="text-xs text-gray-400 line-clamp-2 italic border-l-2 border-gray-200 pl-2">
                                    "{persona.systemPrompt.slice(0, 80)}..."
                                </p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
