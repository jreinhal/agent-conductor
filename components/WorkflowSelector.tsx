'use client';

import { Workflow } from '@/lib/workflows';

interface WorkflowSelectorProps {
    workflows: Workflow[];
    activeWorkflowId: string | null;
    onSelect: (workflowId: string) => void;
}

export function WorkflowSelector({ workflows, activeWorkflowId, onSelect }: WorkflowSelectorProps) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Workflows</span>
            <div className="flex gap-2">
                {workflows.map(wf => (
                    <button
                        key={wf.id}
                        onClick={() => onSelect(wf.id === activeWorkflowId ? '' : wf.id)}
                        className={`
                            px-3 py-1.5 rounded-full text-xs font-medium transition-all border
                            ${wf.id === activeWorkflowId
                                ? 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'}
                        `}
                        title={wf.description}
                    >
                        {wf.name}
                        {wf.id === activeWorkflowId && <span className="ml-1.5 animate-pulse">●</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}
