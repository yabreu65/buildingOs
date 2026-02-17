 import { getSession } from "../../../features/auth/session.storage";
 
 export function requireSession() {
   const s = getSession();
   if (!s) {
     throw new Error("NO_SESSION");
   }
   return s;
 }
