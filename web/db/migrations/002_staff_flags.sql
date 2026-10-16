-- Staff flags raised from the handoff queue. Labels only, no caller text. Reviewed in the review queue.
CREATE TABLE IF NOT EXISTS staff_flags (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  handoff_id bigint NOT NULL,
  flag text NOT NULL CHECK (flag IN ('summary_wrong','could_have_answered')),
  UNIQUE (handoff_id, flag)
);
