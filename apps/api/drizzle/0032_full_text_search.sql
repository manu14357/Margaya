-- Full-text search (A1): stored tsvectors with GIN indexes for tasks, pages
-- and comments, ranked with ts_rank and matched with websearch_to_tsquery.
--
-- Trigger-maintained columns instead of GENERATED ALWAYS ... STORED: adding a
-- generated column rewrites the whole table under an ACCESS EXCLUSIVE lock,
-- which would block a large install at upgrade time. A nullable column with
-- no default is a catalog-only change. Triggers fill it for new and edited
-- rows, and the API's batched backfill job (search/backfill.ts) fills older
-- rows after boot; until then search still finds them through the partial
-- "pending" indexes below. The columns are deliberately not declared in the
-- Drizzle schema, so `select()` and `returning()` never carry them into API
-- payloads.
--
-- Text search configuration: `margaya_search`, a copy of `simple`, with the
-- `unaccent` dictionary in front when the extension can be created (it is a
-- trusted contrib extension, but some managed databases do not ship it). Not
-- a language config: Margaya has 20 UI languages and no per-row content
-- language, `simple` tokenizes every script, and a stemmed index queried with
-- another language's rules would lose matches. Prefix matching on the last
-- word covers most of what stemming adds. pg_trgm is not used; scripts
-- written without spaces (Chinese, Japanese, Thai) also match by substring.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'margaya_search') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS unaccent;
      CREATE TEXT SEARCH CONFIGURATION margaya_search (COPY = pg_catalog.simple);
      ALTER TEXT SEARCH CONFIGURATION margaya_search
        ALTER MAPPING FOR word, hword, hword_part, numword, numhword, hword_numpart
        WITH unaccent, simple;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'unaccent is unavailable (%); margaya_search falls back to simple', SQLERRM;
      CREATE TEXT SEARCH CONFIGURATION margaya_search (COPY = pg_catalog.simple);
    END;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;
--> statement-breakpoint
-- Bodies are cut at 100,000 characters so a huge description can never
-- exceed the 1 MB tsvector limit and fail the write that triggered it.
-- The task key ("WEB-12") is indexed with the title, at weight A.
CREATE OR REPLACE FUNCTION margaya_task_search_tsv(
  p_title text, p_description text, p_project_id text, p_number integer
) RETURNS tsvector LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('margaya_search', coalesce(p_title, '')), 'A')
    || setweight(to_tsvector('margaya_search', coalesce(
         (SELECT slug FROM project WHERE id = p_project_id) || '-' || p_number, '')), 'A')
    || setweight(to_tsvector('margaya_search', left(coalesce(p_description, ''), 100000)), 'B')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION margaya_page_search_tsv(p_title text, p_content text)
RETURNS tsvector LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('margaya_search', coalesce(p_title, '')), 'A')
    || setweight(to_tsvector('margaya_search', left(coalesce(p_content, ''), 100000)), 'B')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION margaya_comment_search_tsv(p_content text)
RETURNS tsvector LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT to_tsvector('margaya_search', left(coalesce(p_content, ''), 100000))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION margaya_task_search_tsv_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv := margaya_task_search_tsv(NEW.title, NEW.description, NEW.project_id, NEW.number);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION margaya_page_search_tsv_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_tsv := margaya_page_search_tsv(NEW.title, NEW.content_text);
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Only comments are indexed; other activity rows keep NULL.
CREATE OR REPLACE FUNCTION margaya_comment_search_tsv_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'comment' THEN
    NEW.search_tsv := margaya_comment_search_tsv(NEW.content);
  ELSE
    NEW.search_tsv := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- A new project key re-indexes that project's tasks.
CREATE OR REPLACE FUNCTION margaya_project_key_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE task SET search_tsv = margaya_task_search_tsv(title, description, project_id, number)
  WHERE project_id = NEW.id;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS task_search_tsv_insert ON task;
--> statement-breakpoint
CREATE TRIGGER task_search_tsv_insert BEFORE INSERT ON task
  FOR EACH ROW EXECUTE FUNCTION margaya_task_search_tsv_trigger();
--> statement-breakpoint
DROP TRIGGER IF EXISTS task_search_tsv_update ON task;
--> statement-breakpoint
CREATE TRIGGER task_search_tsv_update BEFORE UPDATE OF title, description, project_id, number ON task
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.number IS DISTINCT FROM NEW.number)
  EXECUTE FUNCTION margaya_task_search_tsv_trigger();
--> statement-breakpoint
DROP TRIGGER IF EXISTS page_search_tsv_insert ON page;
--> statement-breakpoint
CREATE TRIGGER page_search_tsv_insert BEFORE INSERT ON page
  FOR EACH ROW EXECUTE FUNCTION margaya_page_search_tsv_trigger();
--> statement-breakpoint
DROP TRIGGER IF EXISTS page_search_tsv_update ON page;
--> statement-breakpoint
CREATE TRIGGER page_search_tsv_update BEFORE UPDATE OF title, content_text ON page
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title
    OR OLD.content_text IS DISTINCT FROM NEW.content_text)
  EXECUTE FUNCTION margaya_page_search_tsv_trigger();
--> statement-breakpoint
DROP TRIGGER IF EXISTS activity_search_tsv_insert ON activity;
--> statement-breakpoint
CREATE TRIGGER activity_search_tsv_insert BEFORE INSERT ON activity
  FOR EACH ROW WHEN (NEW.type = 'comment')
  EXECUTE FUNCTION margaya_comment_search_tsv_trigger();
--> statement-breakpoint
DROP TRIGGER IF EXISTS activity_search_tsv_update ON activity;
--> statement-breakpoint
CREATE TRIGGER activity_search_tsv_update BEFORE UPDATE OF content, type ON activity
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content OR OLD.type IS DISTINCT FROM NEW.type)
  EXECUTE FUNCTION margaya_comment_search_tsv_trigger();
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_key_search_tsv ON project;
--> statement-breakpoint
CREATE TRIGGER project_key_search_tsv AFTER UPDATE OF slug ON project
  FOR EACH ROW WHEN (OLD.slug IS DISTINCT FROM NEW.slug)
  EXECUTE FUNCTION margaya_project_key_search_trigger();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_search_tsv_idx" ON "task" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_search_tsv_idx" ON "page" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_comment_search_tsv_idx" ON "activity" USING gin ("search_tsv") WHERE "type" = 'comment';
--> statement-breakpoint
-- Rows the backfill has not reached; empty once it is done.
CREATE INDEX IF NOT EXISTS "task_search_pending_idx" ON "task" ("id") WHERE "search_tsv" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_search_pending_idx" ON "page" ("id") WHERE "search_tsv" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_comment_search_pending_idx" ON "activity" ("id") WHERE "type" = 'comment' AND "search_tsv" IS NULL;
