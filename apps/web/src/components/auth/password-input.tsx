import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";

/** A password field with a show/hide toggle, as on the sign-in form. */
export function PasswordInput(
  props: Omit<ComponentProps<typeof Input>, "type">,
) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        // 32px to tap, 40px on touch screens; the icon stays 16px.
        className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-10"
        aria-label={
          visible ? t("auth:forms.hidePassword") : t("auth:forms.showPassword")
        }
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
