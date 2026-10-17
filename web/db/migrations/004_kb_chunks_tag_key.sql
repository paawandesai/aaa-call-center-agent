-- Rows for a new embedding model or revision are inserted beside the old ones during a deploy, so the key includes the tag.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid, unnest(i.indkey) k
      WHERE c.relname = 'kb_chunks' AND i.indisprimary) = 1 THEN
    ALTER TABLE kb_chunks DROP CONSTRAINT kb_chunks_pkey;
    ALTER TABLE kb_chunks ADD PRIMARY KEY (id, embed_model);
  END IF;
END $$;
