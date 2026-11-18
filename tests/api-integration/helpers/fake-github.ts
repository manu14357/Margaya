import { createHmac, generateKeyPairSync } from "node:crypto";
import { vi } from "vitest";

// A stateful stand-in for the GitHub API (REST and the import GraphQL
// queries), installed in place of `fetch` for api.github.com only. Margaya's
// own routes, database and event plugins stay real; webhooks are sent signed
// with the configured secret, as GitHub would.

export const GITHUB_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
})
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
export const WEBHOOK_SECRET = "e2e-webhook-secret";

export type FakeIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: string[];
  comments: string[];
  assignees: string[];
  author: string;
  html_url: string;
};

export type FakePull = {
  number: number;
  title: string;
  body: string | null;
  headRefName: string;
  author: string;
};

type Repo = {
  id: number;
  owner: string;
  ownerId: number;
  name: string;
  private: boolean;
};

export function createFakeGithub() {
  const repo: Repo = {
    id: 9001,
    owner: "studio-north",
    ownerId: 501,
    name: "website",
    private: false,
  };
  const state = {
    repo,
    installationId: 77,
    /** The linked Margaya user's GitHub identity. */
    account: { id: 4242, login: "octo-admin" },
    permission: "admin",
    installationPermissions: {
      issues: "write",
      metadata: "read",
      pull_requests: "read",
      contents: "read",
    } as Record<string, string>,
    issues: new Map<number, FakeIssue>(),
    pulls: [] as FakePull[],
    repoLabels: new Set<string>(),
    nextNumber: 1,
    calls: [] as string[],
  };

  const repoJson = () => ({
    id: repo.id,
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    private: repo.private,
    owner: {
      id: repo.ownerId,
      login: repo.owner,
      avatar_url: "https://avatars.example/o.png",
      type: "Organization",
    },
    description: "The Studio North website",
    html_url: `https://github.com/${repo.owner}/${repo.name}`,
    updated_at: "2026-11-01T00:00:00Z",
  });

  const issueJson = (issue: FakeIssue) => ({
    id: 100_000 + issue.number,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    html_url: issue.html_url,
    labels: issue.labels.map((name) => ({ name })),
    user: { login: issue.author },
  });

  /** Adds an issue as if someone opened it on GitHub. */
  function openIssue(input: Partial<FakeIssue> & { title: string }) {
    const number = state.nextNumber++;
    const issue: FakeIssue = {
      number,
      body: null,
      state: "open",
      labels: [],
      comments: [],
      assignees: [],
      author: "a-contributor",
      html_url: `https://github.com/${repo.owner}/${repo.name}/issues/${number}`,
      ...input,
    };
    state.issues.set(number, issue);
    return issue;
  }

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  const notFound = () => json(404, { message: "Not Found" });

  const repoPath = `/repos/${repo.owner}/${repo.name}`;

  function graphql(query: string, variables: Record<string, unknown>) {
    const pageInfo = { hasNextPage: false, endCursor: null };
    const actor = (login: string) => ({
      __typename: "User",
      login,
      avatarUrl: `https://avatars.example/${login}.png`,
    });
    if (query.includes("query ImportIssues(")) {
      // One issue per page, like the real query (first: 1).
      const open = [...state.issues.values()].filter(
        (issue) => issue.state === "open",
      );
      const after = variables.cursor ? Number(variables.cursor) : 0;
      const page = open.slice(after, after + 1);
      return {
        repository: {
          databaseId: repo.id,
          issues: {
            totalCount: open.length,
            pageInfo: {
              hasNextPage: after + 1 < open.length,
              endCursor: after + 1 < open.length ? String(after + 1) : null,
            },
            nodes: page.map((issue) => ({
              number: issue.number,
              title: issue.title,
              body: issue.body,
              url: issue.html_url,
              state: "OPEN",
              createdAt: "2026-11-01T00:00:00Z",
              author: actor(issue.author),
              labels: {
                totalCount: issue.labels.length,
                pageInfo,
                nodes: issue.labels.map((name) => ({ name, color: "aabbcc" })),
              },
              comments: {
                totalCount: issue.comments.length,
                pageInfo,
                nodes: issue.comments.map((body, index) => ({
                  body,
                  url: `${issue.html_url}#issuecomment-${index + 1}`,
                  createdAt: "2026-11-02T00:00:00Z",
                  author: actor("a-reviewer"),
                })),
              },
            })),
          },
        },
      };
    }
    if (query.includes("query ImportPullRequests(")) {
      return {
        repository: {
          databaseId: repo.id,
          pullRequests: {
            totalCount: state.pulls.length,
            pageInfo,
            nodes: state.pulls.map((pull) => ({
              number: pull.number,
              title: pull.title,
              body: pull.body,
              url: `https://github.com/${repo.owner}/${repo.name}/pull/${pull.number}`,
              state: "OPEN",
              createdAt: "2026-11-03T00:00:00Z",
              headRefName: pull.headRefName,
              author: actor(pull.author),
            })),
          },
        },
      };
    }
    const issue = state.issues.get(Number(variables.number));
    if (query.includes("query ImportIssueLabels(")) {
      return {
        repository: {
          databaseId: repo.id,
          issue: issue
            ? { labels: { totalCount: 0, pageInfo, nodes: [] } }
            : null,
        },
      };
    }
    return {
      repository: {
        databaseId: repo.id,
        issue: issue
          ? { comments: { totalCount: 0, pageInfo, nodes: [] } }
          : null,
      },
    };
  }

  function handle(method: string, url: URL, body: unknown): Response {
    const path = decodeURIComponent(url.pathname);
    state.calls.push(`${method} ${path}`);
    const data = (body ?? {}) as Record<string, unknown>;

    if (
      method === "POST" &&
      /^\/app\/installations\/\d+\/access_tokens$/.test(path)
    ) {
      return json(201, {
        token: "ghs_e2e_installation_token",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        permissions: state.installationPermissions,
        repository_selection: "selected",
      });
    }
    if (method === "GET" && path === "/app/installations") {
      return json(200, [
        {
          id: state.installationId,
          account: { login: repo.owner, id: repo.ownerId },
        },
      ]);
    }
    if (method === "GET" && path === `${repoPath}/installation`) {
      return json(200, {
        id: state.installationId,
        account: { login: repo.owner, id: repo.ownerId },
        permissions: state.installationPermissions,
      });
    }
    if (
      method === "GET" &&
      /^\/repos\/[^/]+\/[^/]+\/installation$/.test(path)
    ) {
      return notFound();
    }
    if (method === "GET" && path === "/installation/repositories") {
      return json(200, { total_count: 1, repositories: [repoJson()] });
    }
    if (method === "GET" && path === `/user/${state.account.id}`) {
      return json(200, { id: state.account.id, login: state.account.login });
    }
    if (
      method === "GET" &&
      path === `${repoPath}/collaborators/${state.account.login}/permission`
    ) {
      return json(200, {
        permission: state.permission,
        user: { login: state.account.login },
      });
    }
    if (method === "GET" && path === repoPath) return json(200, repoJson());
    if (method === "POST" && path === "/graphql") {
      return json(200, {
        data: graphql(
          String(data.query ?? ""),
          (data.variables ?? {}) as Record<string, unknown>,
        ),
      });
    }

    const label = path.match(new RegExp(`^${repoPath}/labels/(.+)$`));
    if (label && method === "GET") {
      return state.repoLabels.has(label[1] as string)
        ? json(200, { name: label[1], color: "6B7280" })
        : notFound();
    }
    if (method === "POST" && path === `${repoPath}/labels`) {
      state.repoLabels.add(String(data.name));
      return json(201, { name: data.name, color: data.color });
    }
    if (method === "POST" && path === `${repoPath}/issues`) {
      const issue = openIssue({
        title: String(data.title),
        body: (data.body as string | undefined) ?? null,
        author: "margaya-e2e[bot]",
      });
      return json(201, issueJson(issue));
    }

    const issuePath = path.match(
      new RegExp(`^${repoPath}/issues/(\\d+)(/.*)?$`),
    );
    const issue = issuePath
      ? state.issues.get(Number(issuePath[1]))
      : undefined;
    if (issuePath && !issue) return notFound();
    if (issue) {
      const rest = issuePath?.[2] ?? "";
      if (method === "PATCH" && rest === "") {
        if (typeof data.title === "string") issue.title = data.title;
        if (typeof data.body === "string") issue.body = data.body;
        if (data.state === "open" || data.state === "closed") {
          issue.state = data.state;
        }
        return json(200, issueJson(issue));
      }
      if (method === "POST" && rest === "/comments") {
        issue.comments.push(String(data.body));
        return json(201, {
          id: issue.comments.length,
          body: data.body,
          html_url: `${issue.html_url}#issuecomment-${issue.comments.length}`,
        });
      }
      if (method === "POST" && rest === "/labels") {
        for (const name of (data.labels as string[]) ?? []) {
          if (!issue.labels.includes(name)) issue.labels.push(name);
        }
        return json(
          200,
          issue.labels.map((name) => ({ name })),
        );
      }
      const removed = rest.match(/^\/labels\/(.+)$/);
      if (method === "DELETE" && removed) {
        const name = removed[1] as string;
        if (!issue.labels.includes(name)) return notFound();
        issue.labels = issue.labels.filter((existing) => existing !== name);
        return json(
          200,
          issue.labels.map((existing) => ({ name: existing })),
        );
      }
      if (method === "POST" && rest === "/assignees") {
        issue.assignees.push(...((data.assignees as string[]) ?? []));
        return json(201, issueJson(issue));
      }
    }
    return json(501, {
      message: `fake GitHub has no route for ${method} ${path}`,
    });
  }

  /** Answers api.github.com calls; every other request goes out as usual. */
  function install() {
    const realFetch = globalThis.fetch;
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request ? request.url : String(input));
        if (url.hostname !== "api.github.com") return realFetch(input, init);
        const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
        const raw = init?.body ?? (request ? await request.text() : undefined);
        const body =
          typeof raw === "string" && raw.length > 0
            ? JSON.parse(raw)
            : undefined;
        return handle(method, url, body);
      });
  }

  /** The repository and installation fields every webhook carries. */
  function source() {
    return {
      installation: { id: state.installationId },
      repository: {
        id: repo.id,
        name: repo.name,
        full_name: `${repo.owner}/${repo.name}`,
        owner: { login: repo.owner, id: repo.ownerId },
      },
      sender: { login: "a-contributor" },
    };
  }

  return { state, install, openIssue, issueJson, source };
}

export type FakeGithub = ReturnType<typeof createFakeGithub>;

/** A webhook delivery signed like GitHub signs it. */
export function signedWebhook(
  event: string,
  payload: unknown,
  secret = WEBHOOK_SECRET,
) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": crypto.randomUUID(),
      "x-hub-signature-256": signature,
    },
    body,
  };
}
