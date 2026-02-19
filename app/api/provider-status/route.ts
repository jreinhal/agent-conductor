import { NextResponse } from 'next/server';

export async function GET() {
    // Check which API keys are configured in environment variables
    const status = {
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        google: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        xai: !!process.env.XAI_API_KEY,
        ollama: !!process.env.OLLAMA_BASE_URL
    };

    return NextResponse.json(status);
}
