'use client';

import { useState } from 'react';
import { MODELS } from '@/lib/models';

interface EvaluationResult {
    modelId: string;
    runId: number;
    latency: number;
    responseLength: number;
    score: number; // Simulated "Quality" score
}

export function EvaluationDashboard() {
    const [prompt, setPrompt] = useState<string>('');
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<EvaluationResult[]>([]);

    const runEvaluation = async () => {
        setIsRunning(true);
        setResults([]);

        const newResults: EvaluationResult[] = [];

        // Helper to run a single test
        const runTest = async (modelId: string, runId: number) => {
            const start = performance.now();
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [{ role: 'user', content: prompt }], // User's golden prompt
                        model: modelId
                    })
                });

                if (!response.ok) throw new Error('API Error');

                // Read stream to measure full latency and length
                const reader = response.body?.getReader();
                let chars = 0;

                if (reader) {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chars += new TextDecoder().decode(value).length;
                    }
                }

                const end = performance.now();
                return {
                    modelId,
                    runId,
                    latency: Math.round(end - start),
                    responseLength: chars,
                    // Simple heuristic score: longer response + lower latency normalized (fake score for now, but based on real metrics)
                    score: Math.min(10, Math.floor((chars / 100) + (1000 / (end - start)) * 5))
                };

            } catch (err) {
                return {
                    modelId,
                    runId,
                    latency: 0,
                    responseLength: 0,
                    score: 0 // Error
                };
            }
        };

        // Run tests in parallel groups (one run per model at a time)
        for (let i = 1; i <= 3; i++) {
            const promises = MODELS.map(model => runTest(model.id, i));
            const runResults = await Promise.all(promises);

            newResults.push(...runResults);
            setResults([...newResults]); // Update UI after each "round"
        }

        setIsRunning(false);
    };

    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 flex flex-col gap-6 h-full">
            <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <span>🧪</span> The Proving Ground (Live API)
                </h2>
                <p className="text-sm text-gray-500">Benchmark your models against a "Golden Prompt". Stats are generated from real-time API calls.</p>
            </div>

            <div className="flex gap-4">
                <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter Golden Prompt (e.g., 'Explain Quantum Computing')..."
                    className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2"
                />
                <button
                    onClick={runEvaluation}
                    disabled={isRunning || !prompt}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    {isRunning ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Running Tests...
                        </>
                    ) : 'Run Benchmark'}
                </button>

                <label className="cursor-pointer bg-white border border-gray-200 dark:bg-gray-800 dark:border-gray-700 text-gray-600 dark:text-gray-300 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center gap-2">
                    <span>📂</span> Import Dataset
                    <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                try {
                                    const json = JSON.parse(ev.target?.result as string);
                                    if (Array.isArray(json) && json.every(i => typeof i === 'string')) {
                                        // Pick random for demo or use first
                                        setPrompt(json[0]);
                                        alert(`Loaded ${json.length} prompts. Previewing the first one.`);
                                    } else {
                                        alert('Invalid JSON. Expected array of strings: ["Prompt 1", "Prompt 2"]');
                                    }
                                } catch (err) {
                                    alert('Failed to parse JSON');
                                }
                            };
                            reader.readAsText(file);
                        }}
                    />
                </label>
            </div>

            {/* Results Table */}
            <div className="flex-1 overflow-auto border border-gray-200 dark:border-gray-800 rounded-lg">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 uppercase text-xs font-medium">
                        <tr>
                            <th className="px-4 py-3">Model</th>
                            <th className="px-4 py-3">Run #</th>
                            <th className="px-4 py-3">Latency</th>
                            <th className="px-4 py-3">Length</th>
                            <th className="px-4 py-3">Perf Score</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {results.map((r, i) => (
                            <tr key={i} className={`bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${r.score === 0 ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                                <td className="px-4 py-3 font-medium">
                                    {MODELS.find(m => m.id === r.modelId)?.name}
                                    {r.score === 0 && <span className="ml-2 text-xs text-red-500">(Failed)</span>}
                                </td>
                                <td className="px-4 py-3 text-gray-500">#{r.runId}</td>
                                <td className="px-4 py-3 font-mono">{r.latency}ms</td>
                                <td className="px-4 py-3 font-mono">{r.responseLength} chars</td>
                                <td className="px-4 py-3">
                                    {r.score > 0 && (
                                        <span className={`px-2 py-0.5 rounded textxs font-bold ${r.score >= 8 ? 'bg-green-100 text-green-700' :
                                            r.score >= 5 ? 'bg-blue-100 text-blue-700' :
                                                'bg-yellow-100 text-yellow-700'
                                            }`}>
                                            {r.score}/10
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {results.length === 0 && !isRunning && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                                    Ready to benchmark. Enter a prompt and hit Run used REAL APIs.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
