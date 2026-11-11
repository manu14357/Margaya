import { type FormEvent, useEffect, useState } from "react";
import { errorMessage } from "./lib/errors";
import { useT } from "./lib/i18n";
import {
  api,
  type QuickAddResult,
  type QuickAddTarget,
  type ServerView,
} from "./lib/ipc";

/** The value of a project option: workspace and project ids together. */
function projectValue(workspaceId: string, projectId: string) {
  return `${workspaceId}/${projectId}`;
}

export function QuickAdd({
  initialServerId,
}: {
  initialServerId: string | null;
}) {
  const t = useT();
  const [servers, setServers] = useState<ServerView[] | null>(null);
  const [serverId, setServerId] = useState<string>("");
  const [targets, setTargets] = useState<QuickAddTarget[] | null>(null);
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<QuickAddResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .listServers()
      .then((list) => {
        const signedIn = list.filter((server) => server.signedIn);
        setServers(signedIn);
        const preferred =
          signedIn.find((server) => server.id === initialServerId) ??
          signedIn[0];
        setServerId(preferred?.id ?? "");
      })
      .catch(setError);
  }, [initialServerId]);

  useEffect(() => {
    if (!serverId) return;
    setTargets(null);
    setProject("");
    api
      .quickAddTargets(serverId)
      .then((list) => {
        setTargets(list);
        const first = list.find((target) => target.projects.length > 0);
        const firstProject = first?.projects[0];
        if (first && firstProject)
          setProject(projectValue(first.workspaceId, firstProject.id));
      })
      .catch(setError);
  }, [serverId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.closeQuickAdd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const [workspaceId, projectId] = project.split("/");
    if (!workspaceId || !projectId || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setCreated(
        await api.quickAddCreate(
          serverId,
          workspaceId,
          projectId,
          title.trim(),
        ),
      );
      setTitle("");
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (servers === null)
    return <p className="quick-add muted">{t("quickAdd.loading")}</p>;
  if (servers.length === 0)
    return <p className="quick-add">{t("quickAdd.noServers")}</p>;

  const hasProjects =
    targets?.some((target) => target.projects.length > 0) ?? false;

  return (
    <main className="quick-add">
      <h1 className="sr-only">{t("quickAdd.title")}</h1>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span>{t("quickAdd.taskTitle")}</span>
          <input
            ref={(input) => input?.focus()}
            type="text"
            placeholder={t("quickAdd.placeholder")}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setCreated(null);
            }}
          />
        </label>
        <div className="row">
          {servers.length > 1 ? (
            <label className="field grow">
              <span>{t("quickAdd.server")}</span>
              <select
                value={serverId}
                onChange={(event) => setServerId(event.target.value)}
              >
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field grow">
            <span>{t("quickAdd.project")}</span>
            <select
              value={project}
              disabled={!hasProjects}
              onChange={(event) => setProject(event.target.value)}
            >
              {targets?.map((target) => (
                <optgroup key={target.workspaceId} label={target.workspaceName}>
                  {target.projects.map((item) => (
                    <option
                      key={item.id}
                      value={projectValue(target.workspaceId, item.id)}
                    >
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        {targets === null ? (
          <p className="muted">{t("quickAdd.loading")}</p>
        ) : null}
        {targets !== null && !hasProjects ? (
          <p className="muted">{t("quickAdd.noProjects")}</p>
        ) : null}
        {error ? (
          <p className="message error" role="alert">
            {errorMessage(t, error)}
          </p>
        ) : null}
        <div className="row end">
          {created ? (
            <span className="grow" role="status">
              {t("quickAdd.created")}{" "}
              <button
                type="button"
                className="link"
                onClick={() => void api.quickAddOpen(serverId, created.url)}
              >
                {t("quickAdd.open")}
              </button>
            </span>
          ) : null}
          <button
            type="submit"
            className="button primary"
            disabled={busy || !title.trim() || !project}
          >
            {busy ? t("quickAdd.creating") : t("quickAdd.create")}
          </button>
        </div>
      </form>
    </main>
  );
}
