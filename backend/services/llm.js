import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Groq client - OpenAI-compatible API, FREE TIER available
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

// Groq models: llama-3.1-8b-instant (fast), llama-3.1-70b-versatile (smart), mixtral-8x7b-32768
const DEFAULT_MODEL = process.env.LLM_MODEL || 'llama-3.1-8b-instant';

// Load knowledge base at startup
let knowledgeBase = null;
try {
  const kbPath = join(__dirname, '..', 'knowledge', 'faq.json');
  const kbData = readFileSync(kbPath, 'utf-8');
  knowledgeBase = JSON.parse(kbData);
  console.log('Knowledge base loaded:', knowledgeBase.faqs.length, 'FAQs');
} catch (err) {
  console.error('Failed to load knowledge base:', err.message);
}

/**
 * Format knowledge base as context for the prompt
 */
function buildContextPrompt() {
  if (!knowledgeBase) return '';

  const faqText = knowledgeBase.faqs
    .map((faq, i) => `Q${i + 1}: ${faq.question}\nA${i + 1}: ${faq.answer}`)
    .join('\n\n');

  const policyText = Object.entries(knowledgeBase.policies || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  return `COMPANY: ${knowledgeBase.company}
DESCRIPTION: ${knowledgeBase.description}

FREQUENTLY ASKED QUESTIONS:
${faqText}

POLICIES:
${policyText}`;
}

/**
 * Build system prompt that allows reasoning from context
 */
function buildSystemPrompt() {
  const context = buildContextPrompt();

  return `You are a customer support AI for ${knowledgeBase?.company || 'our company'}.

INSTRUCTIONS:
1. Answer using ONLY the provided context below
2. If the exact answer is stated, provide it clearly
3. If the exact answer is not stated BUT can be logically inferred from the context (dates, policies, rules), answer based on that inference
4. If the answer truly cannot be determined from the context, say: "I don't have information about that. Please contact support@techsupport.com for help."
5. Do NOT use outside knowledge or make up facts not in the context
6. Keep responses concise (1-2 sentences max)
7. Be polite and professional

EXAMPLE of good reasoning:
- Context: "Full refunds within 14 days of purchase. No refunds after 14 days."
- User asks: "Can I get refund after 30 days?"
- Good answer: "No, refunds are only available within 14 days of purchase. After 30 days, you are not eligible for a refund."
- This shows inference: 30 days > 14 days → no refund

CONTEXT:
---
${context}
---`;
}

/**
 * Send message to LLM with knowledge context
 * @param {string} message - User message
 * @returns {Promise<string>} - LLM response text
 */
export async function getChatResponse(message) {
  try {
    const systemPrompt = buildSystemPrompt();

    const completion = await groq.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      max_tokens: 300,
      temperature: 0.3  // Slightly higher for reasoning, still conservative
    });

    return completion.choices[0]?.message?.content || 'No response from AI';
  } catch (error) {
    console.error('LLM Error:', error.message);
    throw error;
  }
}
