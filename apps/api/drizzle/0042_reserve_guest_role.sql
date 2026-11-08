-- "guest" is now a built-in role that limits its holders to chosen projects.
-- A workspace may already have its own custom role of that name: it moves to
-- "custom-guest" with everyone who holds it, so they keep exactly the access
-- they have today instead of silently becoming limited guests.
--
-- workspace_role has no unique constraint and permission lookups read one row,
-- so a workspace already using "custom-guest" gets "custom-guest-2" and so on:
-- merging the two names would hand one group the other's rights. This is one
-- statement so that every table sees the same choice of name.
WITH "renamed" AS (
  SELECT DISTINCT ON (g."workspace_id") g."workspace_id", c."name"
  FROM "workspace_role" AS g
  CROSS JOIN LATERAL (
    SELECT n, CASE n WHEN 1 THEN 'custom-guest' ELSE 'custom-guest-' || n END AS "name"
    FROM generate_series(1, (
      SELECT count(*) + 1 FROM "workspace_role" AS t
      WHERE t."workspace_id" = g."workspace_id"
    )) AS n
  ) AS c
  WHERE g."role" = 'guest'
    AND NOT EXISTS (
      SELECT 1 FROM "workspace_role" AS t
      WHERE t."workspace_id" = g."workspace_id" AND t."role" = c."name"
    )
  ORDER BY g."workspace_id", c.n
),
"members" AS (
  UPDATE "workspace_member" AS m
  SET "role" = regexp_replace(m."role", '(^|,\s*)guest(\s*(,|$))', '\1' || r."name" || '\2')
  FROM "renamed" AS r
  WHERE r."workspace_id" = m."workspace_id"
    AND string_to_array(replace(m."role", ' ', ''), ',') && ARRAY['guest']::text[]
),
"invitations" AS (
  UPDATE "invitation" AS i
  SET "role" = regexp_replace(i."role", '(^|,\s*)guest(\s*(,|$))', '\1' || r."name" || '\2')
  FROM "renamed" AS r
  WHERE r."workspace_id" = i."workspace_id"
    AND string_to_array(replace(i."role", ' ', ''), ',') && ARRAY['guest']::text[]
),
"project_members" AS (
  UPDATE "project_member" AS pm
  SET "role" = r."name"
  FROM "project" AS p
  JOIN "renamed" AS r ON r."workspace_id" = p."workspace_id"
  WHERE p."id" = pm."project_id" AND pm."role" = 'guest'
)
UPDATE "workspace_role" AS wr
SET "role" = r."name"
FROM "renamed" AS r
WHERE r."workspace_id" = wr."workspace_id" AND wr."role" = 'guest';
