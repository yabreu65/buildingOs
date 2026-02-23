"use client";

import { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
};

export default function Textarea(props: Props) {
  const { className = "", ...rest } = props;

  return (
    <textarea
      className={[
        "w-full rounded-md border border-border bg-card text-card-foreground",
        "px-3 py-2 text-sm",
        "placeholder:text-muted-foreground",
        "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "resize-none",
        className,
      ].join(" ")}
      {...rest}
    />
  );
}
