CREATE TABLE IF NOT EXISTS puzzle_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  puzzle_fingerprint TEXT NOT NULL CHECK (
    length(puzzle_fingerprint) = 64 AND puzzle_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  template_id TEXT NOT NULL,
  requested_level INTEGER CHECK (requested_level IS NULL OR requested_level BETWEEN 1 AND 12),
  assessed_level INTEGER NOT NULL CHECK (assessed_level BETWEEN 1 AND 12),
  difficulty_model_version TEXT NOT NULL,
  generator_version TEXT NOT NULL,
  generation_metadata TEXT NOT NULL CHECK (json_valid(generation_metadata)),
  rating TEXT NOT NULL CHECK (rating IN ('too_easy', 'just_right', 'too_hard')),
  reason TEXT CHECK (reason IS NULL OR reason IN (
    'difficult_to_start', 'confusing_clues', 'too_many_deductions', 'took_too_long', 'other'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'in_progress')),
  hints_used INTEGER NOT NULL CHECK (hints_used BETWEEN 0 AND 100),
  mistakes INTEGER NOT NULL CHECK (mistakes BETWEEN 0 AND 100),
  elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms BETWEEN 0 AND 86400000),
  smart_marking_enabled INTEGER CHECK (smart_marking_enabled IS NULL OR smart_marking_enabled IN (0, 1)),
  submitted_at TEXT NOT NULL,
  CHECK (reason IS NULL OR rating = 'too_hard')
);

CREATE INDEX IF NOT EXISTS puzzle_feedback_fingerprint_submitted
  ON puzzle_feedback (puzzle_fingerprint, submitted_at);
CREATE INDEX IF NOT EXISTS puzzle_feedback_template_submitted
  ON puzzle_feedback (template_id, submitted_at);
CREATE INDEX IF NOT EXISTS puzzle_feedback_requested_level_submitted
  ON puzzle_feedback (requested_level, submitted_at);
CREATE INDEX IF NOT EXISTS puzzle_feedback_assessed_level_submitted
  ON puzzle_feedback (assessed_level, submitted_at);
CREATE INDEX IF NOT EXISTS puzzle_feedback_model_submitted
  ON puzzle_feedback (difficulty_model_version, submitted_at);
CREATE INDEX IF NOT EXISTS puzzle_feedback_reason_submitted
  ON puzzle_feedback (reason, submitted_at);
