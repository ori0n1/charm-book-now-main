import { cn } from "@/lib/utils";

type AuthFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  labelClassName?: string;
};

export function AuthField({ label, labelClassName, className, id, ...props }: AuthFieldProps) {
  const fieldId = id ?? props.name;
  return (
    <label className="block space-y-2">
      <span className={cn("text-xs font-medium text-muted-foreground", labelClassName)}>{label}</span>
      <input
        id={fieldId}
        className={cn(
          "public-input w-full",
          className,
        )}
        {...props}
      />
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
