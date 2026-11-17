import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  QuickAddAttachments,
  QuickAddNotices,
} from "./components/quick-add-attachments";
import { QuickAddChips } from "./components/quick-add-chips";
import { errorMessage } from "./lib/errors";
import { useT } from "./lib/i18n";
import {
  api,
  events,
  type QuickAddAttachment,
  type QuickAddDetails,
  type QuickAddMember,
  type QuickAddNotice,
  type QuickAddPrefs,
  type QuickAddResult,
  type QuickAddTarget,
  type ServerView,
} from "./lib/ipc";
import { parseQuickAdd } from "./lib/quick-add-parse";

/** The value of a project option: workspace and project ids together. */
function projectValue(workspaceId: string, projectId: string) {
  return `${workspaceId}/${projectId}`;
}

/** The remembered project when it is still on offer, else the first one. */
function pickProject(
  targets: QuickAddTarget[],
  prefs: QuickAddPrefs | null,
  serverId: string,
) {
  if (prefs?.serverId === serverId && prefs.workspaceId && prefs.projectId) {
    const remembered = targets
      .find((target) => target.workspaceId === prefs.workspaceId)
      ?.projects.some((project) => project.id === prefs.projectId);
    if (remembered) return projectValue(prefs.workspaceId, prefs.projectId);
  }
  const first = targets.find((target) => target.projects.length > 0);
  const firstProject = first?.projects[0];
  return first && firstProject
    ? projectValue(first.workspaceId, firstProject.id)
    : "";
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
  const [members, setMembers] = useState<QuickAddMember[] | null>(null);
  const [title, setTitle] = useState("");
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());
  const [description, setDescription] = useState("");
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [attachments, setAttachments] = useState<QuickAddAttachment[]>([]);
  const [notices, setNotices] = useState<QuickAddNotice[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<QuickAddResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);
  const appliedRevision = useRef(0);
  const prefsRef = useRef<QuickAddPrefs | null>(null);

  useEffect(() => {
    Promise.all([
      api.listServers(),
      // Older builds or a broken file: start without a remembered project.
      api.quickAddPrefs().catch(() => null),
    ])
      .then(([list, remembered]) => {
        prefsRef.current = remembered ?? null;
        const signedIn = list.filter((server) => server.signedIn);
        setServers(signedIn);
        const preferred =
          signedIn.find((server) => server.id === initialServerId) ??
          signedIn.find((server) => server.id === remembered?.serverId) ??
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
        setProject(pickProject(list, prefsRef.current, serverId));
      })
      .catch(setError);
  }, [serverId]);

  const workspaceId = project.split("/")[0] ?? "";

  // The workspace's members, for @name. Null while loading or when the
  // server won't list them: @names then stay plain text.
  useEffect(() => {
    setMembers(null);
    if (!serverId || !workspaceId) return;
    let active = true;
    api
      .quickAddMembers(serverId, workspaceId)
      .then((list) => {
        if (active) setMembers(list);
      })
      .catch(() => {
        if (active) setMembers(null);
      });
    return () => {
      active = false;
    };
  }, [serverId, workspaceId]);

  // A screenshot, the clipboard or "Send to" filled the draft.
  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .quickAddDraft()
        .then((draft) => {
          if (!active || !draft) return;
          setAttachments(draft.attachments);
          setNotices(draft.notices);
          if (draft.revision === appliedRevision.current) return;
          appliedRevision.current = draft.revision;
          if (draft.title !== null) {
            setTitle(draft.title);
            setIgnored(new Set());
          }
          if (draft.description !== null) {
            setDescription(draft.description);
            setDescriptionOpen(true);
          }
          setCreated(null);
          titleInput.current?.focus();
        })
        .catch(() => {});
    void load();
    const unlisten = events.quickAddDraft(() => void load()).catch(() => null);
    return () => {
      active = false;
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void api.closeQuickAdd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loaded = servers !== null && servers.length > 0;
  useEffect(() => {
    if (loaded) titleInput.current?.focus();
  }, [loaded]);

  const parsed = parseQuickAdd(title, { now: new Date(), members, ignored });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const [workspace, projectId] = project.split("/");
    const finalTitle = parsed.title.trim();
    if (!workspace || !projectId || !finalTitle) return;
    const details: QuickAddDetails = {
      description: description.trim() || undefined,
      dueDate: parsed.dueDate?.toISOString(),
      priority: parsed.priority ?? undefined,
      assigneeIds:
        parsed.assignees.length > 0
          ? parsed.assignees.map((member) => member.id)
          : undefined,
    };
    const hasDetails = Object.values(details).some(
      (value) => value !== undefined,
    );
    setBusy(true);
    setError(null);
    try {
      const result = await api.quickAddCreate(
        serverId,
        workspace,
        projectId,
        finalTitle,
        hasDetails ? details : undefined,
        attachments.length > 0
          ? attachments.map((attachment) => attachment.id)
          : undefined,
      );
      setCreated(result);
      prefsRef.current = { serverId, workspaceId: workspace, projectId };
      setTitle("");
      setIgnored(new Set());
      setDescription("");
      setDescriptionOpen(false);
      setAttachments([]);
      setNotices([]);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((list) => list.filter((attachment) => attachment.id !== id));
    void api.quickAddRemoveAttachment(id).catch(() => {});
  };

  if (servers === null)
    return <p className="quick-add muted">{t("quickAdd.loading")}</p>;
  if (servers.length === 0)
    return <p className="quick-add">{t("quickAdd.noServers")}</p>;

  const hasProjects =
    targets?.some((target) => target.projects.length > 0) ?? false;
  const failed = created?.failedAttachments ?? [];

  return (
    <main className="quick-add">
      <h1 className="sr-only">{t("quickAdd.title")}</h1>
      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span>{t("quickAdd.taskTitle")}</span>
          <input
            ref={titleInput}
            type="text"
            placeholder={t("quickAdd.placeholder")}
            aria-describedby={
              parsed.tokens.length === 0 ? "quick-add-hint" : undefined
            }
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setCreated(null);
            }}
          />
        </label>
        {parsed.tokens.length > 0 ? (
          <QuickAddChips
            tokens={parsed.tokens}
            onRemove={(key) => setIgnored((keys) => new Set(keys).add(key))}
          />
        ) : (
          <p id="quick-add-hint" className="muted small">
            {t("quickAdd.hint")}
          </p>
        )}
        {descriptionOpen ? (
          <label className="field">
            <span>{t("quickAdd.description")}</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        ) : null}
        <QuickAddAttachments
          attachments={attachments}
          onRemove={removeAttachment}
        />
        <QuickAddNotices notices={notices} />
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
        {failed.length > 0 ? (
          <p className="message warning" role="alert">
            {t("quickAdd.attachmentsFailed", { names: failed.join(", ") })}
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
          {!descriptionOpen ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => setDescriptionOpen(true)}
            >
              {t("quickAdd.addDescription")}
            </button>
          ) : null}
          <button
            type="submit"
            className="button primary"
            disabled={busy || !parsed.title.trim() || !project}
          >
            {busy ? t("quickAdd.creating") : t("quickAdd.create")}
          </button>
        </div>
      </form>
    </main>
  );
}
