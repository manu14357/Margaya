import { type FormEvent, useEffect, useState } from "react";
import { errorMessage } from "../lib/errors";
import { useT } from "../lib/i18n";
import { api, type ServerView } from "../lib/ipc";

type Props = {
  server: ServerView;
  onClose: () => void;
};

/**
 * Browser sign-in for one server. The system browser normally returns through
 * the com.margaya.desktop:// deep link; when that can't work (a locked-down
 * machine), the user asks the server to show a code and pastes it here.
 */
export function SignInPanel({ server, onClose }: Props) {
  const t = useT();
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.startSignIn(server.id, false).catch(setError);
  }, [server.id]);

  const onShowCode = () => {
    setShowCode(true);
    setError(null);
    api.startSignIn(server.id, true).catch(setError);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.submitSignInCode(server.id, code.trim());
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const onCancel = () => {
    void api.cancelSignIn(server.id);
    onClose();
  };

  return (
    <section className="card" aria-live="polite">
      <h2>{server.label}</h2>
      <p>{t("signIn.waiting")}</p>
      {showCode ? (
        <form className="row" onSubmit={onSubmit}>
          <label className="field grow">
            <span>{t("signIn.codeLabel")}</span>
            <input
              type="text"
              autoComplete="one-time-code"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !code.trim()}
          >
            {t("signIn.submit")}
          </button>
        </form>
      ) : (
        <p className="muted">
          {t("signIn.pasteHint")}{" "}
          <button type="button" className="link" onClick={onShowCode}>
            {t("signIn.showCode")}
          </button>
        </p>
      )}
      {error ? (
        <p className="message error" role="alert">
          {errorMessage(t, error)}
        </p>
      ) : null}
      <div className="row end">
        <button type="button" className="button" onClick={onCancel}>
          {t("signIn.cancel")}
        </button>
      </div>
    </section>
  );
}
