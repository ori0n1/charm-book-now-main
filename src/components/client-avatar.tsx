import { useState } from "react";

type ClientAvatarProps = {
  name?: string | null;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function ClientAvatar({ name, avatarUrl, size = "md", className: sizeOverride }: ClientAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const sizeClass =
    sizeOverride ??
    (size === "sm" ? "size-7 text-[10px]" : size === "lg" ? "size-11 text-sm" : "size-9 text-xs");

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? "Cliente"}
        onError={() => setImgError(true)}
        className={`shrink-0 rounded-full object-cover ${sizeClass}`}
      />
    );
  }

  const initials = name
    ? name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? "")
        .join("")
    : "?";
  const palettes = [
    "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  ];
  const idx = name
    ? name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) % palettes.length
    : 0;

  return (
    <div
      className={`grid shrink-0 select-none place-items-center rounded-full font-semibold ${sizeClass} ${palettes[idx]}`}
    >
      {initials}
    </div>
  );
}
