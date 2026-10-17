-- One rating per turn: a repeat post updates it instead of adding rows that could push real items out of the review queue.
DELETE FROM feedback f USING feedback g
  WHERE f.session_id = g.session_id AND f.turn_id = g.turn_id AND f.id < g.id;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_one_per_turn ON feedback (session_id, turn_id);
