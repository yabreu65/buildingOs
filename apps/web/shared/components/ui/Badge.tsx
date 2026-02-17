 export default function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className || "bg-muted text-muted-foreground border border-border"}`}>
      {children}
    </span>
  );
}
