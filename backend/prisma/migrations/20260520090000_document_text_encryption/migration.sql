-- Add encrypted text storage for documents
ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "textContentCiphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "textContentIv" TEXT,
  ADD COLUMN IF NOT EXISTS "textContentTag" TEXT;
