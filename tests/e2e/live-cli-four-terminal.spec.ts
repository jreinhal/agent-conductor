import { expect, test, type Page } from '@playwright/test';

const LIVE_CLI_E2E_ENABLED = process.env.LIVE_CLI_E2E === '1';

const TERMINALS = [
    {
        modelId: 'gpt-5.3-codex',
        modelName: 'GPT-5.3 Codex',
        trigger: '@gpt-5.3',
    },
    {
        modelId: 'gpt-5.2',
        modelName: 'GPT-5.2',
        trigger: '@gpt-5.2',
    },
    {
        modelId: 'claude-opus-4.6',
        modelName: 'Claude Opus 4.6',
        trigger: '@claude-opus-4.6',
    },
    {
        modelId: 'gemini-3-pro',
        modelName: 'Gemini 3 Pro',
        trigger: '@gemini-3-pro',
    },
];

async function addModelTerminal(page: Page, modelId: string, trigger: string) {
    const input = page.getByTestId('smart-input');
    await input.click();
    await input.fill(trigger);

    const suggestion = page.getByTestId(`smart-suggestion-${modelId}`);
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.click();

    await expect(page.getByTestId(`chat-panel-${modelId}`)).toBeVisible({ timeout: 20_000 });
}

test.describe('live CLI browser stress - four terminals', () => {
    test.skip(
        !LIVE_CLI_E2E_ENABLED,
        'Set LIVE_CLI_E2E=1 to run this live browser+CLI test (requires local Codex, Claude, and Gemini CLI auth).'
    );

    test('broadcast query reaches all four terminals and returns live responses', async ({ page }) => {
        test.setTimeout(12 * 60 * 1000);

        await page.goto('/');
        await expect(page.getByTestId('smart-input')).toBeVisible();

        for (const terminal of TERMINALS) {
            await addModelTerminal(page, terminal.modelId, terminal.trigger);
            await expect(page.getByText(terminal.modelName, { exact: false })).toBeVisible();
        }

        await expect(page.getByText('4 active')).toBeVisible();

        const prompt = [
            'Live 4-terminal stress test:',
            'Provide a concise recommendation for hardening a multi-agent handoff protocol.',
            'Include exactly one risk and one mitigation.',
            'Start your answer with "Resolution:".',
        ].join(' ');

        const input = page.getByTestId('smart-input');
        await input.click();
        await input.fill(prompt);
        await page.keyboard.press('Enter');

        // Codex can queue multiple OpenAI models through a single local CLI lane.
        // Keep this timeout generous for real live runs with four terminals.
        const responseTimeoutMs = 6 * 60 * 1000;

        for (const terminal of TERMINALS) {
            const panel = page.getByTestId(`chat-panel-${terminal.modelId}`);

            await expect(
                panel.getByTestId('chat-message-user').last()
            ).toContainText('Live 4-terminal stress test', { timeout: 30_000 });

            const assistantMessage = panel.getByTestId('chat-message-assistant').first();
            await expect(assistantMessage).toBeVisible({ timeout: responseTimeoutMs });

            const assistantText = (await assistantMessage.innerText()).trim();
            expect(assistantText.length).toBeGreaterThan(20);
            expect(assistantText.toLowerCase()).toContain('resolution:');
        }
    });
});
