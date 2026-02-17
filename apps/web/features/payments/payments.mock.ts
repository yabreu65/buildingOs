 import { Payment } from "./payments.types";
 
 export const mockPayments: Payment[] = [
   { id: "pay_1", unitId: "u_101", amount: 120.5, status: "PENDING", createdAt: new Date().toISOString() },
   { id: "pay_2", unitId: "u_201", amount: 180, status: "APPROVED", createdAt: new Date().toISOString() },
 ];
