'use client';

import { useState } from 'react';
import { PERSONAS } from '@/lib/personas';
import { Workflow, WORKFLOWS } from '@/lib/workflows';

interface WorkflowBuilderProps {
    onSave: (workflow: Workflow) => void;
    onCancel: () => void;
}

export function WorkflowBuilder({ onSave, onCancel }: WorkflowBuilderProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [steps, setSteps] = useState<{ personaId: string; instruction: string }[]>([]);

    const addStep = (personaId: string) => {
        setSteps([...steps, { personaId, instruction: '' }]);
    };

    const updateStepInstruction = (index: number, instruction: string) => {
        const newSteps = [...steps];
        newSteps[index].instruction = instruction;
        setSteps(newSteps);
    };

    const removeStep = (index: number) => {
        setSteps(steps.filter((_, i) => i !== index));
    };

    const handleSave = () => {
        if (!name || steps.length === 0) return;

        const newWorkflow: Workflow = {
            id: `custom-${Date.now()}`,
            name,
            description,
            steps: steps.map((s, i) => ({
                id: `step-${i}`,
                personaId: s.personaId,
                instruction: s.instruction
            }))
        };

        onSave(newWorkflow);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold">Build Custom Workflow</h2>
                    <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Meta */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Workflow Name</label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                                placeholder="e.g., Content Machine"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                            <input
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
                                placeholder="What does this chain do?"
                            />
                        </div>
                    </div>

                    {/* Steps Visualizer */}
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Chain Steps</label>

                        <div className="space-y-4">
                            {steps.map((step, i) => (
                                <div key={i} className="flex gap-4 items-start p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                    <div className="flex flex-col items-center gap-1 mt-2">
                                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">
                                            {i + 1}
                                        </div>
                                        {i < steps.length - 1 && <div className="w-0.5 h-8 bg-gray-300 dark:bg-gray-600" />}
                                    </div>

                                    <div className="flex-1 space-y-2">
                                        <div className="flex justify-between">
                                            <span className="font-semibold text-sm">{PERSONAS.find(p => p.id === step.personaId)?.name}</span>
                                            <button onClick={() => removeStep(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                                        </div>
                                        <textarea
                                            value={step.instruction}
                                            onChange={(e) => updateStepInstruction(i, e.target.value)}
                                            placeholder="Specific instruction for this step (e.g., 'Review the code above')..."
                                            className="w-full text-sm px-3 py-2 border rounded bg-white dark:bg-gray-900 dark:border-gray-600"
                                            rows={2}
                                        />
                                    </div>
                                </div>
                            ))}

                            {steps.length === 0 && (
                                <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                                    Add personas to start building your chain.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Persona Picker */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Add Agent to Chain</label>
                        <div className="flex flex-wrap gap-2">
                            {PERSONAS.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => addStep(p.id)}
                                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-white border border-gray-200 hover:border-blue-500 hover:text-blue-600 transition-colors dark:bg-gray-800 dark:border-gray-700"
                                >
                                    + {p.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!name || steps.length === 0}
                        className="px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Save Workflow
                    </button>
                </div>
            </div>
        </div>
    );
}
