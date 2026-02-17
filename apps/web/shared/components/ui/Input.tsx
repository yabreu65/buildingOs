"use client";

import { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export default function Input(props: Props) {
  const { className = "", ...rest } = props;

  return (
    <input
      className={[
        "w-full rounded-md border border-border bg-card text-card-foreground",
        "px-3 py-2 text-sm",
        "placeholder:text-muted-foreground",
        "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      ].join(" ")}
      {...rest}
    />
  );
}
