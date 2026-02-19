import { Persona } from './personas';

export interface WorkflowStep {
    id: string;
    personaId: string; // The ID of the persona to run
    instruction: string; // Specific instruction for this step (e.g. "Review the code")
}

export interface Workflow {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
}

export const WORKFLOWS: Workflow[] = [
    {
        id: 'security-audit-chain',
        name: 'Full Security Audit',
        description: 'Architect review followed by Security deep-dive.',
        steps: [
            {
                id: 'step-1',
                personaId: 'software-architect',
                instruction: "Analyze the architectural patterns and potential bottlenecks in the provided context."
            },
            {
                id: 'step-2',
                personaId: 'security-auditor',
                instruction: "Based on the architecture review, identify critical security vulnerabilities (OWASP Top 10)."
            }
        ]
    },
    {
        id: 'product-launch-chain',
        name: 'Product Launch Prep',
        description: 'Strategist definition followed by Quality assurance check.',
        steps: [
            {
                id: 'step-1',
                personaId: 'product-strategist',
                instruction: "Draft a product announcement and feature highlight list based on this context."
            },
            {
                id: 'step-2',
                personaId: 'qa-engineer',
                instruction: "Review the product features for testability and identify potential edge cases."
            }
        ]
    }
];
