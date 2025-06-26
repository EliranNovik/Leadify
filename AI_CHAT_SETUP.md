# AI Chat with Image Upload Setup

This guide will help you set up the AI chat functionality with image upload support using OpenAI's Chat Completions API with GPT-4o vision support.

## Prerequisites

1. **OpenAI API Key**: You need a valid OpenAI API key with access to GPT-4o
2. **Supabase Project**: Your project should be set up with Edge Functions

## Setup Steps

### 1. Configure Supabase Environment Variables

Add the following environment variable to your Supabase project:

1. Go to your Supabase Dashboard
2. Navigate to Settings > Edge Functions
3. Add this environment variable:
   - `OPENAI_API_KEY`: Your OpenAI API key

### 2. Deploy the Edge Function

```bash
supabase functions deploy chat
```

### 3. Test the Setup

1. Start your development server
2. Open the AI chat in your application
3. Try uploading an image and asking a question about it

## How It Works

### Image Upload Process

1. **Frontend**: When a user uploads images, they are converted to base64 data URLs
2. **Backend**: The Supabase function receives the images and includes them in the message content
3. **OpenAI**: GPT-4o processes the images and responds with analysis
4. **Response**: The assistant can analyze the images and respond accordingly

### Supported Image Types

- PNG
- JPG/JPEG
- GIF
- WebP

### Image Size Limits

- Maximum file size: 20 MB per image (Chat Completions API limit)
- Maximum resolution: 2048 x 2048 pixels
- Project limit: Varies based on your OpenAI plan

## Troubleshooting

### Common Issues

1. **"Model not found" error**

   - Make sure you're using `gpt-4o` which supports vision
   - Verify your OpenAI account has access to GPT-4o

2. **"File too large" error**

   - Ensure images are under 20 MB
   - Consider compressing images before upload

3. **"Invalid image format" error**
   - Verify the image format is supported (PNG, JPG, GIF, WebP)
   - Check that the base64 encoding is correct

### Debug Mode

To enable debug logging, add this to your Supabase function:

```typescript
console.log("Debug info:", { messages, images });
```

## Features

### Image Analysis Capabilities

The assistant can:

- Extract text from documents
- Identify forms and their fields
- Analyze charts and graphs
- Recognize objects and scenes
- Provide insights about visual content

### Tool Integration

The assistant has access to:

- **create_lead**: Create new leads in the CRM
- **create_meeting**: Schedule meetings for leads
- **query_executor**: Run database queries for data analysis

### Example Use Cases

1. **Document Processing**: Upload a citizenship application form and ask the assistant to extract key information
2. **Data Analysis**: Upload a chart or graph and ask for insights
3. **Form Validation**: Upload a completed form and ask the assistant to check for missing fields
4. **Content Summarization**: Upload a document and ask for a summary

## Security Considerations

- Images are processed by OpenAI and may be used for model improvement
- Consider implementing image size and format validation on the frontend
- Be mindful of sensitive information in uploaded images
- Implement rate limiting if needed

## Cost Considerations

- GPT-4o with vision has different pricing than text-only models
- Image processing consumes more tokens than text
- Monitor your OpenAI usage to manage costs effectively

## Technical Details

### Message Format

When images are included, the message format looks like this:

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "What can you see in this image?"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...",
        "detail": "high"
      }
    }
  ]
}
```

### Model Selection

The system automatically selects the appropriate model:

- `gpt-4o` for messages with images (vision support)
- `gpt-4-turbo-preview` for text-only messages (faster, cheaper)

### Image Detail Levels

- `high`: Detailed analysis with high-resolution processing
- `low`: Faster processing with lower resolution (512x512)
- `auto`: Automatic selection based on image size
