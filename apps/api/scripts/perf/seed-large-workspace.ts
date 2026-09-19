// Seeds one large workspace for performance work. LOCAL DEVELOPMENT ONLY.
//
//   PERF_API_URL=http://localhost:3501 \
//   PERF_DATABASE_URL=postgresql://margaya:margaya@127.0.0.1:55432/margaya_perf \
//   pnpm --filter @margaya/api exec tsx scripts/perf/seed-large-workspace.ts [manifest.json]
//
// Users, the workspace and the projects go through the HTTP API (so sign-in,
// roles and default columns are real); the bulk rows are inserted with SQL in
// one transaction. The target database must be a throwaway one: the script
// refuses names that do not contain "perf".

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const API_URL = process.env.PERF_API_URL ?? "http://localhost:3501";
const DATABASE_URL = process.env.PERF_DATABASE_URL ?? "";
const PASSWORD = "perf-only-password-0001";
const WORKSPACE_NAME = "Perf Workspace";

const MEMBERS = 20;
const BIG_PROJECT_TASKS = 5_000;
const SMALL_PROJECT_TASKS = 200;
const CYCLES = 5;
const MODULES = 10;
const PAGES = 50;
const ACTIVITY_ROWS = 20_000;
const COMMENT_SHARE = 0.15;
const NOTIFICATIONS = 1_000;
const AUDIT_ROWS = 2_000;
const TRASHED_TASKS = 100;

if (!/perf/.test(new URL(DATABASE_URL || "postgres://x/none").pathname)) {
  throw new Error(
    "Set PERF_DATABASE_URL to a throwaway database whose name contains 'perf'.",
  );
}

type Session = { cookie: string; userId: string; email: string };

async function call<T>(
  session: Session | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; cookie: string }> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: API_URL,
      ...(session ? { cookie: session.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { data: (text ? JSON.parse(text) : null) as T, cookie };
}

async function signUp(index: number): Promise<Session> {
  const email = `perf-user-${index}@margaya.test`;
  const name = `Perf User ${index}`;
  try {
    const { data, cookie } = await call<{ user: { id: string } }>(
      null,
      "POST",
      "/api/auth/sign-up/email",
      { name, email, password: PASSWORD },
    );
    return { cookie, userId: data.user.id, email };
  } catch {
    const { data, cookie } = await call<{ user: { id: string } }>(
      null,
      "POST",
      "/api/auth/sign-in/email",
      { email, password: PASSWORD },
    );
    return { cookie, userId: data.user.id, email };
  }
}

async function main() {
  const started = Date.now();
  const users: Session[] = [];
  for (let i = 1; i <= MEMBERS; i += 1) users.push(await signUp(i));
  const owner = users[0];
  if (!owner) throw new Error("no owner");

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  const existing = await db.query(
    `select w.id from workspace w join workspace_member m on m.workspace_id = w.id
     where w.name = $1 and m.user_id = $2`,
    [WORKSPACE_NAME, owner.userId],
  );
  if (existing.rowCount) {
    throw new Error(
      `"${WORKSPACE_NAME}" already exists (${existing.rows[0].id}); use a fresh database.`,
    );
  }

  const { data: workspace } = await call<{ id: string }>(
    owner,
    "POST",
    "/api/auth/organization/create",
    { name: WORKSPACE_NAME, slug: `perf-${Date.now().toString(36)}` },
  );

  for (const user of users.slice(1)) {
    await db.query(
      `insert into workspace_member (id, workspace_id, user_id, role, joined_at)
       values ($1, $2, $3, 'member', now())`,
      [`perf_wm_${user.userId}`, workspace.id, user.userId],
    );
  }

  const projects: { id: string; name: string }[] = [];
  for (const [i, name] of ["Platform", "Mobile", "Website"].entries()) {
    const { data } = await call<{ id: string }>(owner, "POST", "/api/project", {
      name,
      workspaceId: workspace.id,
      icon: "Layout",
      slug: ["PLT", "MOB", "WEB"][i],
    });
    projects.push({ id: data.id, name });
  }
  const [big] = projects;
  if (!big) throw new Error("no project");

  const userIds = users.map((u) => u.userId);
  await db.query("begin");
  await db.query("set local synchronous_commit = off");
  await db.query(
    "create temp table perf_users (n int, id text) on commit drop",
  );
  await db.query(
    "insert into perf_users select ordinality - 1, id from unnest($1::text[]) with ordinality as t(id)",
    [userIds],
  );

  // Six workflow columns on every project: add backlog and cancelled ones
  // next to the defaults when they are missing.
  for (const project of projects) {
    const columns = await db.query<{ slug: string }>(
      `select slug from "column" where project_id = $1`,
      [project.id],
    );
    const have = new Set(columns.rows.map((r) => r.slug));
    const extra = [
      ["Backlog", "backlog", "backlog", false, -1],
      ["In Review", "in-review", "started", false, 2],
      ["Cancelled", "cancelled", "cancelled", true, 9],
    ] as const;
    for (const [name, slug, group, isFinal, position] of extra) {
      if (have.has(slug) || have.size >= 6) continue;
      await db.query(
        `insert into "column" (id, project_id, name, slug, position, status_group, is_final)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `perf_col_${project.id}_${slug}`,
          project.id,
          name,
          slug,
          position,
          group,
          isFinal,
        ],
      );
      have.add(slug);
    }
  }

  // Workspace labels.
  const labelNames = [
    "bug",
    "feature",
    "chore",
    "docs",
    "ux",
    "backend",
    "frontend",
    "infra",
  ];
  await db.query(
    `insert into label (id, name, color, workspace_id)
     select 'perf_lbl_' || n, n, '#' || substr(md5(n), 1, 6), $1
     from unnest($2::text[]) as n`,
    [workspace.id, labelNames],
  );

  for (const project of projects) {
    const count = project === big ? BIG_PROJECT_TASKS : SMALL_PROJECT_TASKS;
    await db.query(
      `with cols as (
         select id, slug, status_group, row_number() over (order by position) - 1 as k,
                count(*) over () as total
         from "column" where project_id = $1
       )
       insert into task (id, project_id, position, number, assignee_id, title, description,
                         status, column_id, priority, start_date, due_date, completed_at,
                         created_by, created_at, updated_at)
       select 'perf_t_' || $1 || '_' || g,
              $1, g, g,
              (select id from perf_users where n = g % $3),
              'Task ' || g || ' ' || md5(g::text),
              case when g % 3 = 0 then 'Description for task ' || g || ' with some searchable words alpha beta gamma.' end,
              c.slug, c.id,
              (array['no-priority','low','medium','high','urgent'])[1 + g % 5],
              case when g % 2 = 0 then now() - ((g % 60) || ' days')::interval end,
              case when g % 4 <> 0 then now() + (((g % 90) - 30) || ' days')::interval end,
              case when c.status_group = 'completed' then now() - ((g % 30) || ' days')::interval end,
              (select id from perf_users where n = (g * 7) % $3),
              now() - ((g % 180) || ' days')::interval,
              now() - ((g % 30) || ' hours')::interval
       from generate_series(1, $2) g
       join cols c on c.k = g % c.total`,
      [project.id, count, MEMBERS],
    );
    // Column-local positions 0..n-1, the order the board writes.
    await db.query(
      `update task set position = ranked.rn - 1
       from (select id, row_number() over (partition by status order by number) as rn
             from task where project_id = $1) ranked
       where task.id = ranked.id`,
      [project.id],
    );
    await db.query("update project set last_task_number = $2 where id = $1", [
      project.id,
      count,
    ]);
    // One or two assignees per task (the first mirrors task.assignee_id).
    await db.query(
      `insert into task_assignee (id, task_id, user_id, position)
       select 'perf_ta_' || t.id || '_0', t.id, t.assignee_id, 0
       from task t where t.project_id = $1 and t.assignee_id is not null
       union all
       select 'perf_ta_' || t.id || '_1', t.id, u.id, 1
       from task t join perf_users u on u.n = (t.number + 3) % $2
       where t.project_id = $1 and t.number % 3 = 0 and u.id <> t.assignee_id`,
      [project.id, MEMBERS],
    );
    // Task labels are per-task copies of workspace labels.
    await db.query(
      `insert into label (id, name, color, task_id, workspace_id)
       select 'perf_tl_' || t.id || '_' || l.n, l.n, '#' || substr(md5(l.n), 1, 6), t.id, $2
       from task t
       cross join lateral (
         select n from unnest($3::text[]) with ordinality as x(n, i)
         where i - 1 in (t.number % 8, (t.number * 5 + 1) % 8)
       ) l
       where t.project_id = $1 and t.number % 2 = 0`,
      [project.id, workspace.id, labelNames],
    );
  }

  // Sub-tasks: every 10th task is a parent of the next three.
  await db.query(
    `insert into task_relation (id, source_task_id, target_task_id, relation_type)
     select 'perf_rs_' || g || '_' || k,
            'perf_t_' || $1 || '_' || g, 'perf_t_' || $1 || '_' || (g + k), 'subtask'
     from generate_series(10, $2 - 10, 10) g, generate_series(1, 3) k`,
    [big.id, BIG_PROJECT_TASKS],
  );
  // Dependencies and other relations.
  await db.query(
    `insert into task_relation (id, source_task_id, target_task_id, relation_type)
     select 'perf_rr_' || g, 'perf_t_' || $1 || '_' || g,
            'perf_t_' || $1 || '_' || (g + 17),
            (array['blocks','related','duplicate','start_before','finish_before'])[1 + g % 5]
     from generate_series(5, $2 - 20, 7) g`,
    [big.id, BIG_PROJECT_TASKS],
  );

  // Cycles: two past, one current, two upcoming; 100 tasks each.
  for (let c = 0; c < CYCLES; c += 1) {
    const offset = (c - 2) * 14;
    const cycleId = `perf_cy_${c}`;
    await db.query(
      `insert into cycle (id, project_id, name, start_date, end_date, owner_id, created_by, sort_order)
       values ($1, $2, $3, current_date + $4::int, current_date + $4::int + 13, $5, $5, $6)`,
      [cycleId, big.id, `Sprint ${c + 1}`, offset, owner.userId, 65535 + c],
    );
    await db.query(
      `insert into cycle_task (task_id, cycle_id, added_by)
       select 'perf_t_' || $1 || '_' || g, $2, $3
       from generate_series($4::int, $4::int + 99) g`,
      [big.id, cycleId, owner.userId, 1 + c * 100],
    );
  }

  // Modules: 150 tasks each, overlapping.
  for (let m = 0; m < MODULES; m += 1) {
    const moduleId = `perf_mod_${m}`;
    await db.query(
      `insert into module (id, project_id, name, status, lead_id, position, created_by, start_date, target_date)
       values ($1, $2, $3, $4, $5, $6, $5, current_date - 10, current_date + 30)`,
      [
        moduleId,
        big.id,
        `Module ${m + 1}`,
        ["backlog", "planned", "in-progress", "paused", "completed"][m % 5],
        userIds[m % MEMBERS],
        m,
      ],
    );
    await db.query(
      `insert into module_task (id, module_id, task_id, created_by)
       select 'perf_mt_' || $2 || '_' || g, $2, 'perf_t_' || $1 || '_' || g, $3
       from generate_series($4::int, $4::int + 149) g`,
      [big.id, moduleId, owner.userId, 1 + m * 120],
    );
  }

  await db.query(
    `insert into page (id, workspace_id, project_id, position, title, owner_id, content_markdown,
                       content_text, created_by_id, updated_by_id)
     select 'perf_pg_' || g, $1, $2, g, 'Page ' || g,
            $3, '# Page ' || g || E'\n\nNotes about the roadmap.', 'Page ' || g || ' Notes about the roadmap.', $3, $3
     from generate_series(1, $4) g`,
    [workspace.id, big.id, owner.userId, PAGES],
  );

  // Activity on the big project, a share of it comments.
  await db.query(
    `insert into activity (id, task_id, type, user_id, content, created_at, updated_at)
     select 'perf_ac_' || g,
            'perf_t_' || $1 || '_' || (1 + g % $3),
            case when g % 100 < $4 then 'comment'
                 else (array['create','status_changed','priority','assignee_changed','title'])[1 + g % 5] end,
            (select id from perf_users where n = g % $5),
            case when g % 100 < $4 then 'Comment ' || g || ' lorem ipsum dolor sit amet.'
                 else 'changed something on ' || g end,
            now() - ((g % 2000) || ' minutes')::interval,
            now() - ((g % 2000) || ' minutes')::interval
     from generate_series(1, $2) g`,
    [
      big.id,
      ACTIVITY_ROWS,
      BIG_PROJECT_TASKS,
      Math.round(COMMENT_SHARE * 100),
      MEMBERS,
    ],
  );

  await db.query(
    `insert into notification (id, user_id, title, content, type, is_read, resource_id, resource_type,
                               workspace_id, actor_id, created_at)
     select 'perf_nt_' || g, $1, 'Task updated', 'Task ' || g || ' changed', 'task_updated',
            g % 3 = 0, 'perf_t_' || $3 || '_' || (1 + g % 5000), 'task', $2,
            (select id from perf_users where n = 1 + g % ($5 - 1)),
            now() - (g || ' minutes')::interval
     from generate_series(1, $4) g`,
    [owner.userId, workspace.id, big.id, NOTIFICATIONS, MEMBERS],
  );

  await db.query(
    `insert into audit_log (id, workspace_id, actor_type, actor_user_id, actor_name, action,
                            target_type, target_id, target_label, metadata, created_at)
     select 'perf_al_' || g, $1, 'user', $2, 'Perf User 1',
            (array['member.invited','member.role_changed','project.created','api_key.created','webhook.updated'])[1 + g % 5],
            'project', $3, 'Platform', '{}'::jsonb, now() - (g || ' minutes')::interval
     from generate_series(1, $4) g`,
    [workspace.id, owner.userId, big.id, AUDIT_ROWS],
  );

  // A trash: the last tasks of the big project, each its own batch.
  await db.query(
    `update task set deleted_at = now() - ((number % 20) || ' days')::interval,
                     deleted_by = $2, trash_batch_id = id
     where project_id = $1 and number > $3`,
    [big.id, owner.userId, BIG_PROJECT_TASKS - TRASHED_TASKS],
  );

  await db.query("commit");
  await db.query("analyze");
  await db.end();

  const manifest = {
    apiUrl: API_URL,
    password: PASSWORD,
    owner: { email: owner.email, id: owner.userId },
    users: users.map((u) => ({ email: u.email, id: u.userId })),
    workspaceId: workspace.id,
    projects,
    bigProjectId: big.id,
    cycleIds: Array.from({ length: CYCLES }, (_, c) => `perf_cy_${c}`),
    moduleIds: Array.from({ length: MODULES }, (_, m) => `perf_mod_${m}`),
  };
  const out = resolve(process.argv[2] ?? "perf-seed.json");
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s; manifest: ${out}`,
  );
}

await main();
