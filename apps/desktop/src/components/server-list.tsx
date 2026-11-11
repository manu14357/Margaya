import { type FormEvent, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import { api, type ServerView } from "../lib/ipc";

type Props = {
  servers: ServerView[];
  onChanged: () => void;
  onSignIn: (server: ServerView) => void;
};

export function ServerList({ servers, onChanged, onSignIn }: Props) {
  const t = useT();
  if (servers.length === 0) {
    return <p className="empty">{t("servers.empty")}</p>;
  }
  return (
    <ul className="server-list" aria-label={t("servers.heading")}>
      {servers.map((server) => (
        <ServerRow
          key={server.id}
          server={server}
          onChanged={onChanged}
          onSignIn={onSignIn}
        />
      ))}
    </ul>
  );
}

function ServerRow({
  server,
  onChanged,
  onSignIn,
}: {
  server: ServerView;
  onChanged: () => void;
  onSignIn: (server: ServerView) => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [label, setLabel] = useState(server.label);
  const [error, setError] = useState<unknown>(null);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(caught);
    }
  };

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.renameServer(server.id, label.trim() || server.label);
      setRenaming(false);
    });
  };

  return (
    <li className="server">
      <div className="server-main">
        <span className="server-avatar" aria-hidden="true">
          {server.label.slice(0, 1).toUpperCase()}
        </span>
        <div className="server-text">
          {renaming ? (
            <form className="row" onSubmit={onRename}>
              <label className="field grow">
                <span className="sr-only">{t("servers.nameLabel")}</span>
                <input
                  ref={(input) => input?.focus()}
                  type="text"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
              <button type="submit" className="button primary">
                {t("servers.save")}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setRenaming(false)}
              >
                {t("servers.cancel")}
              </button>
            </form>
          ) : (
            <>
              <span className="server-name">{server.label}</span>
              <span className="server-url">{server.webUrl}</span>
            </>
          )}
          <span className="server-meta">
            <span className={server.signedIn ? "pill ok" : "pill"}>
              {server.signedIn ? t("servers.signedIn") : t("servers.signedOut")}
            </span>
            {server.unread > 0 ? (
              <span className="pill accent">
                {t("servers.unread", { count: server.unread })}
              </span>
            ) : null}
            {server.insecure ? (
              <span className="pill warn">{t("servers.insecure")}</span>
            ) : null}
          </span>
        </div>
      </div>

      {confirmRemove ? (
        <div className="confirm" role="alert">
          <p>{t("servers.removeConfirm", { name: server.label })}</p>
          <div className="row">
            <button
              type="button"
              className="button danger"
              onClick={() => void run(() => api.removeServer(server.id))}
            >
              {t("servers.remove")}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setConfirmRemove(false)}
            >
              {t("servers.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="server-actions">
          <button
            type="button"
            className="button primary"
            onClick={() => void run(() => api.openServer(server.id))}
          >
            {t("servers.open")}
          </button>
          {server.signedIn ? (
            <button
              type="button"
              className="button"
              onClick={() => void run(() => api.signOut(server.id))}
            >
              {t("servers.signOut")}
            </button>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() => onSignIn(server)}
            >
              {t("servers.signIn")}
            </button>
          )}
          <button
            type="button"
            className="button ghost"
            onClick={() => {
              setLabel(server.label);
              setRenaming(true);
            }}
          >
            {t("servers.rename")}
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => setConfirmRemove(true)}
          >
            {t("servers.remove")}
          </button>
        </div>
      )}
      {error ? (
        <p className="message error" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : null}
    </li>
  );
}
