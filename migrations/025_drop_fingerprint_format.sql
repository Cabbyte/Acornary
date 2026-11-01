-- Legacy receipts have no way to reconstruct a canonical input; new replays use
-- the canonical fingerprint only. Keep the rows, drop the obsolete discriminator.
ALTER TABLE operations DROP COLUMN IF EXISTS fingerprint_format;
