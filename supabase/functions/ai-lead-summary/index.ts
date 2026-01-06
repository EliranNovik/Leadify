import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { content, leadNumber, clientName } = await req.json();
    
    // Debug logging
    console.log('🔍 [AI Lead Summary] Request received:', {
      contentLength: content?.length || 0,
      leadNumber: leadNumber || 'none',
      clientName: clientName || 'none',
      hasOpenAIKey: !!OPENAI_API_KEY,
      contentPreview: content?.substring(0, 200) || 'empty'
    });
    
    if (!content || typeof content !== 'string') {
      console.error('❌ [AI Lead Summary] Content validation failed');
      throw new Error('Content is required');
    }

    if (!OPENAI_API_KEY) {
      console.error('❌ [AI Lead Summary] OpenAI API key not configured');
      throw new Error('OpenAI API key not configured');
    }

    const clientInfo = clientName ? `Client: ${clientName}` : '';
    const leadInfo = leadNumber ? `Lead Number: ${leadNumber}` : '';
    const contextInfo = [clientInfo, leadInfo].filter(Boolean).join('\n');

    const prompt = `You are a professional legal CRM assistant specializing in citizenship and immigration cases. Create a comprehensive, unified summary of the following lead information.

IMPORTANT FORMATTING REQUIREMENTS:
- Write in clean, plain text with paragraphs
- Do NOT use markdown formatting (no **, no *, no #, no -)
- Do NOT use bullet points or lists in the main summary
- Do NOT separate information by field names (no "Special Notes:", "General Notes:", etc.)
- Combine all information into one flowing, natural narrative
- Use paragraph breaks (double line breaks) to separate different topics naturally
- Write as a cohesive story that weaves together all the information
- Be clear, professional, and organized

STRUCTURE:
1. First, write a unified summary that combines all the information (special notes, general notes, facts, manager notes) into one flowing narrative. Do not mention field names - just naturally incorporate all the information.

2. At the end, add a section titled "Actionable Insights:" followed by specific recommendations. This section can use bullet points or numbered items for clarity.

${contextInfo ? `\n${contextInfo}\n` : ''}

Lead Information:
${content}`;

    const body = {
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert legal CRM assistant specializing in citizenship and immigration cases. Create clear, concise, and well-structured summaries that help experts quickly understand case details. Always write in clean, plain text paragraphs without any markdown formatting, bullet points, or special characters.' 
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 800,
      temperature: 0.4,
    };

    console.log('🔍 [AI Lead Summary] Calling OpenAI API:', {
      promptLength: prompt.length,
      estimatedTokens: Math.ceil(prompt.length / 4),
      model: body.model,
      maxTokens: body.max_tokens
    });

    const openaiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    console.log('🔍 [AI Lead Summary] OpenAI response status:', openaiRes.status, openaiRes.statusText);

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      const errorMessage = err.error?.message || openaiRes.statusText;
      
      const isQuotaError = errorMessage.toLowerCase().includes('quota') || 
                           errorMessage.toLowerCase().includes('billing') ||
                           errorMessage.toLowerCase().includes('exceeded');
      
      console.error('❌ [AI Lead Summary] OpenAI API error:', {
        status: openaiRes.status,
        statusText: openaiRes.statusText,
        errorMessage: errorMessage,
        errorType: err.error?.type,
        errorCode: err.error?.code,
        isQuotaError: isQuotaError,
        rateLimitInfo: err.error?.type === 'rate_limit_error' ? {
          retryAfter: openaiRes.headers.get('retry-after'),
          limit: err.error?.limit,
          remaining: err.error?.remaining
        } : null
      });
      
      // Return proper status code for rate limits and quota errors
      if (openaiRes.status === 429) {
        const retryAfter = openaiRes.headers.get('retry-after');
        
        if (isQuotaError) {
          console.warn('⚠️ [AI Lead Summary] Quota/billing limit exceeded');
          return new Response(
            JSON.stringify({ 
              error: 'OpenAI quota exceeded. Please check your billing and plan details.',
              code: 'QUOTA_EXCEEDED',
              status: 429,
              originalError: errorMessage
            }),
            { 
              status: 429, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        
        console.warn('⚠️ [AI Lead Summary] Rate limit detected. Retry after:', retryAfter, 'seconds');
        return new Response(
          JSON.stringify({ 
            error: 'Rate limit exceeded. Please try again in a moment.',
            code: 'RATE_LIMIT',
            status: 429,
            retryAfter: retryAfter
          }),
          { 
            status: 429, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      throw new Error(`${openaiRes.status} ${errorMessage}`);
    }

    const data = await openaiRes.json();
    let summary = data.choices?.[0]?.message?.content || 'Unable to generate summary';

    // Clean up any markdown formatting that might have slipped through
    // But preserve bullet points in the "Actionable Insights" section
    const actionableInsightsMatch = summary.match(/Actionable Insights:[\s\S]*$/i);
    const mainSummary = actionableInsightsMatch ? summary.substring(0, summary.indexOf('Actionable Insights:')) : summary;
    const actionableInsights = actionableInsightsMatch ? actionableInsightsMatch[0] : '';
    
    // Clean main summary (no markdown, no bullets)
    let cleanedMain = mainSummary
      .replace(/\*\*/g, '') // Remove bold markdown
      .replace(/\*/g, '') // Remove italic markdown
      .replace(/#{1,6}\s+/g, '') // Remove headers
      .replace(/^[-*+]\s+/gm, '') // Remove bullet points at start of lines
      .replace(/^\d+\.\s+/gm, '') // Remove numbered lists
      .replace(/\n{3,}/g, '\n\n') // Normalize multiple line breaks to double
      .trim();
    
    // Clean actionable insights (allow bullets but remove markdown)
    let cleanedInsights = actionableInsights
      .replace(/\*\*/g, '') // Remove bold markdown
      .replace(/\*/g, '') // Remove italic markdown (but keep * for bullets if needed)
      .replace(/#{1,6}\s+/g, '') // Remove headers
      .replace(/\n{3,}/g, '\n\n') // Normalize multiple line breaks
      .trim();
    
    // Recombine
    summary = cleanedMain + (cleanedInsights ? '\n\n' + cleanedInsights : '');

    console.log('✅ [AI Lead Summary] Successfully generated summary:', {
      summaryLength: summary.length,
      tokensUsed: data.usage?.total_tokens || 'unknown',
      promptTokens: data.usage?.prompt_tokens || 'unknown',
      completionTokens: data.usage?.completion_tokens || 'unknown'
    });

    return new Response(
      JSON.stringify({ summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('❌ [AI Lead Summary] Error generating AI summary:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
      fullError: err
    });
    return new Response(
      JSON.stringify({ error: err.message || 'Unknown error' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

