"use client";

import { SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement>;

export default function Select(props: Props) {
  const { className = "", children, ...rest } = props;

  return (
    <select
      className={[
        "w-full rounded-md border border-border bg-card text-card-foreground",
        "px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </select>
  );
}
