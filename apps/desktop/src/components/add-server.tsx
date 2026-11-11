import { type FormEvent, useEffect, useState } from "react";
import { CERTIFICATE_HELP_URL, errorMessage, isTlsError } from "../lib/errors";
import { useT } from "../lib/i18n";
import { api, type Discovery } from "../lib/ipc";

type Props = {
  /** Prefills and checks this address, for a deep link the user confirmed. */
  initialUrl?: string | null;
  onAdded: () => void;
};

export function AddServer({ initialUrl, onAdded }: Props) {
  const t = useT();
  const [input, setInput] = useState(initialUrl ?? "");
  const [label, setLabel] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const connect = async (value: string) => {
    setBusy(true);
    setError(null);
    setDiscovery(null);
    try {
      const found = await api.discoverServer(value);
      setDiscovery(found);
      setLabel(found.suggestedLabel);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per confirmed deep link.
  useEffect(() => {
    if (initialUrl) {
      setInput(initialUrl);
      void connect(initialUrl);
    }
  }, [initialUrl]);

  const onConnect = (event: FormEvent) => {
    event.preventDefault();
    if (input.trim()) void connect(input.trim());
  };

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    if (!discovery) return;
    setBusy(true);
    setError(null);
    try {
      await api.addServer(discovery, label.trim() || discovery.suggestedLabel);
      setInput("");
      setLabel("");
      setDiscovery(null);
      onAdded();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="add-server-heading">
      <h2 id="add-server-heading">{t("add.heading")}</h2>
      <form className="row" onSubmit={onConnect}>
        <label className="field grow">
          <span>{t("add.urlLabel")}</span>
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder={t("add.urlPlaceholder")}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setDiscovery(null);
            }}
          />
        </label>
        <button
          type="submit"
          className="button"
          disabled={busy || !input.trim()}
        >
          {busy && !discovery ? t("add.connecting") : t("add.connect")}
        </button>
      </form>

      {error ? (
        <p className="message error" role="alert">
          {errorMessage(t, error)}{" "}
          {isTlsError(error) ? (
            <button
              type="button"
              className="link"
              onClick={() => void api.openExternal(CERTIFICATE_HELP_URL)}
            >
              {t("errors.tlsHelp")}
            </button>
          ) : null}
        </p>
      ) : null}

      {discovery ? (
        <form className="stack" onSubmit={onAdd}>
          <p className="message success">
            {t("add.found", {
              version: discovery.serverVersion,
              url: discovery.webUrl,
            })}
          </p>
          {discovery.insecure ? (
            <p className="message warning" role="alert">
              {t("add.httpWarning")}
            </p>
          ) : null}
          <div className="row">
            <label className="field grow">
              <span>{t("add.nameLabel")}</span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <button type="submit" className="button primary" disabled={busy}>
              {discovery.insecure ? t("add.confirmHttp") : t("add.submit")}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
