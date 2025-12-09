-- Add read receipt tracking for RMQ Messages
-- This ensures the messages table has delivery_status and message_read_receipts table exists

-- Ensure delivery_status column exists in messages table
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(50) DEFAULT 'sent';

-- Ensure message_read_receipts table exists (should already exist from create_messaging_system_tables.sql)
-- But we'll verify and create if needed
CREATE TABLE IF NOT EXISTS public.message_read_receipts (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(message_id, user_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message_id ON public.message_read_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_message_read_receipts_user_id ON public.message_read_receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_delivery_status ON public.messages(delivery_status);

-- Add comments for documentation
COMMENT ON COLUMN public.messages.delivery_status IS 'Message delivery status: sent, delivered, read';
COMMENT ON TABLE public.message_read_receipts IS 'Tracks which users have read which messages';

