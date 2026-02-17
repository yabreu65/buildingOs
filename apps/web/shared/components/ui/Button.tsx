"use client";

import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-muted text-foreground border border-border hover:opacity-90",
  ghost: "bg-transparent text-foreground hover:bg-muted",
  danger: "bg-danger text-primary-foreground hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-3 py-2 text-sm",
};

export default function Button({
  className = "",
  variant = "primary",
  size = "md",
  ...rest
}: Props) {
  return (
    <button
      className={[base, variants[variant], sizes[size], className].join(" ")}
      {...rest}
    />
  );
}
