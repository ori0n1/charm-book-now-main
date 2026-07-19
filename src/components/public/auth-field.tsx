import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type AuthFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  labelClassName?: string;
};

export function AuthField({ label, labelClassName, className, id, type, ...props }: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  const fieldId = id ?? props.name;
  const isPassword = type === "password";
  const inputType = isPassword && visible ? "text" : type;

  return (
    <label className="block space-y-2">
      <span className={cn("text-xs font-semibold text-muted-foreground", labelClassName)}>{label}</span>
      <span className="relative block">
        <input
          id={fieldId}
          type={inputType}
          className={cn("public-input w-full", isPassword && "pr-12", className)}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            aria-label={visible ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
            onClick={() => setVisible((value) => !value)}
            className="absolute right-1.5 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          </button>
        )}
      </span>
    </label>
  );
}

export function AuthPrimaryButton({
  className,
  children,
  type = "submit",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cn("public-btn-primary w-full", className)} {...props}>
      {children}
    </button>
  );
}
