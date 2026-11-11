import { useCallback, useEffect, useRef, useState } from "react";
import { AddServer } from "./components/add-server";
import { ServerList } from "./components/server-list";
import { SettingsPanel } from "./components/settings-panel";
import { SignInPanel } from "./components/sign-in-panel";
import { errorMessage } from "./lib/errors";
import { useT } from "./lib/i18n";
import { api, events, type ServerView } from "./lib/ipc";

export function Launcher() {
  const t = useT();
  const [servers, setServers] = useState<ServerView[]>([]);
  const [signingIn, setSigningIn] = useState<ServerView | null>(null);
  const [linkPrompt, setLinkPrompt] = useState<string | null>(null);
  const [checkUrl, setCheckUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const serversRef = useRef<ServerView[]>([]);

  const refresh = useCallback(() => {
    api
      .listServers()
      .then((list) => {
        serversRef.current = list;
        setServers(list);
      })
      .catch(setError);
  }, []);

  useEffect(() => {
    refresh();
    // A deep link that arrived before this window was ready.
    api
      .takeLauncherPrompt()
      .then((url) => url && setLinkPrompt(url))
      .catch(() => {});
    const subscriptions = [
      events.serversChanged(refresh),
      events.deepLinkAddServer(setLinkPrompt),
      events.signInFinished((result) => {
        setSigningIn((current) =>
          current?.id === result.serverId ? null : current,
        );
        if (result.ok) {
          const server = serversRef.current.find(
            (item) => item.id === result.serverId,
          );
          setNotice(server ? t("signIn.done", { name: server.label }) : null);
        } else {
          setError({ kind: result.errorKind ?? "signInFailed", message: "" });
        }
        refresh();
      }),
    ];
    return () => {
      for (const subscription of subscriptions)
        void subscription.then((stop) => stop());
    };
  }, [refresh, t]);

  return (
    <main className="launcher">
      <header className="brand">
        <img src="./logo.svg" alt="" width={28} height={28} />
        <h1>Margaya</h1>
      </header>

      {linkPrompt ? (
        <section
          className="card"
          role="alertdialog"
          aria-labelledby="link-prompt-title"
        >
          <h2 id="link-prompt-title">{t("deepLink.addTitle")}</h2>
          <p>{t("deepLink.addBody", { url: linkPrompt })}</p>
          <div className="row end">
            <button
              type="button"
              className="button"
              onClick={() => setLinkPrompt(null)}
            >
              {t("deepLink.ignore")}
            </button>
            <button
              type="button"
              className="button primary"
              onClick={() => {
                setCheckUrl(linkPrompt);
                setLinkPrompt(null);
              }}
            >
              {t("deepLink.check")}
            </button>
          </div>
        </section>
      ) : null}

      {signingIn ? (
        <SignInPanel server={signingIn} onClose={() => setSigningIn(null)} />
      ) : null}

      <section aria-labelledby="servers-heading">
        <h2 id="servers-heading" className="section-title">
          {t("servers.heading")}
        </h2>
        <ServerList
          servers={servers}
          onChanged={refresh}
          onSignIn={setSigningIn}
        />
      </section>

      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p className="message error" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : null}

      <AddServer initialUrl={checkUrl} onAdded={refresh} />
      <SettingsPanel />
    </main>
  );
}
