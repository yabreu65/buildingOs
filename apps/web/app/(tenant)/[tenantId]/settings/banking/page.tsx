import BankingUI from "@/features/banking/banking.ui";

export default function BankingPage() {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Cuentas bancarias</h1>
        <p className="text-muted-foreground mt-2">
          Estas cuentas se mostrarán a residentes para reportar pagos.
        </p>
      </div>
      <BankingUI />
    </div>
  );
}
