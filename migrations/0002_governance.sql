-- Phase 3: governance snapshot (capability + files + protection) per repository.
ALTER TABLE repositories ADD COLUMN governance TEXT;
