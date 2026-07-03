"use client";

import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
  children?: ReactNode;
}

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

export const Button = ({
  className = "",
  variant = "primary",
  size = "md",
  asChild = false,
  children,
  ...rest
}: ButtonProps) => {
  const classes = [base, variants[variant], sizes[size], className].join(" ");

  if (asChild) {
    if (!isValidElement(children)) {
      return null;
    }

    const child = children as ReactElement<{ className?: string }>;

    return cloneElement(child, {
      className: [child.props.className ?? "", classes].filter(Boolean).join(" "),
      ...rest,
    });
  }

  return (
    <button
      className={classes}
      {...rest}
    >
      {children}
    </button>
  );
};

export default Button;
