import { ReactNode, HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export default function Card({ children, className = "", ...props }: Props) {
  return (
    <div
      className={[
        "rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        "p-4",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
