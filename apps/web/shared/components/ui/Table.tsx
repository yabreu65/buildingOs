import React, { ReactNode } from "react";

type TableProps = React.HTMLAttributes<HTMLDivElement>;

export function Table({
  children,
  className = "",
  ...props
}: TableProps) {
  const defaultClassName =
    "w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground";
  const combinedClassName = `${defaultClassName} ${className}`.trim();

  return (
    <div className={combinedClassName} {...props}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

type THeadProps = React.HTMLAttributes<HTMLTableSectionElement>;

export function THead({
  children,
  className = "",
  ...props
}: THeadProps) {
  const defaultClassName =
    "bg-muted text-muted-foreground border-b border-border";
  const combinedClassName = `${defaultClassName} ${className}`.trim();

  return (
    <thead className={combinedClassName} {...props}>
      {children}
    </thead>
  );
}

type TBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;

export function TBody({
  children,
  className = "",
  ...props
}: TBodyProps) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

type TRProps = React.HTMLAttributes<HTMLTableRowElement>;

export function TR({
  children,
  className = "",
  ...props
}: TRProps) {
  const defaultClassName =
    "border-b border-border last:border-0 hover:bg-muted/60 transition-colors";
  const combinedClassName = `${defaultClassName} ${className}`.trim();

  return (
    <tr className={combinedClassName} {...props}>
      {children}
    </tr>
  );
}

type THProps = React.HTMLAttributes<HTMLTableCellElement>;

export function TH({
  children,
  className = "",
  ...props
}: THProps) {
  const defaultClassName =
    "text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide";
  const combinedClassName = `${defaultClassName} ${className}`.trim();

  return (
    <th className={combinedClassName} {...props}>
      {children}
    </th>
  );
}

type TDProps = React.HTMLAttributes<HTMLTableCellElement>;

export function TD({
  children,
  className = "",
  ...props
}: TDProps) {
  const defaultClassName = "px-4 py-3 align-middle";
  const combinedClassName = `${defaultClassName} ${className}`.trim();

  return (
    <td className={combinedClassName} {...props}>
      {children}
    </td>
  );
}
