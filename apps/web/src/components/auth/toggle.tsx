import { Link } from "@tanstack/react-router";
import useGetConfig from "@/hooks/queries/config/use-get-config";

type AuthToggleProps = {
  message: string;
  linkText: string;
  linkTo: string;
  /** Carried to the other auth screen so it returns to the same place. */
  redirect?: string;
};

export function AuthToggle({
  message,
  linkText,
  linkTo,
  redirect,
}: AuthToggleProps) {
  const { data: config } = useGetConfig();

  if (config?.disableRegistration || config?.disablePasswordRegistration) {
    return null;
  }

  return (
    <div className="text-center text-sm text-muted-foreground mt-3">
      {message}{" "}
      <Link
        to={linkTo}
        search={redirect ? { redirect } : {}}
        className="underline underline-offset-4 hover:text-primary"
      >
        {linkText}
      </Link>
    </div>
  );
}
