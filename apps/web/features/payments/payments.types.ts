 export type Payment = {
   id: string;
   unitId: string;
   amount: number;
   status: "PENDING" | "APPROVED" | "REJECTED";
   createdAt: string;
 };
