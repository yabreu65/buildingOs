export type Lead = {
  name: string;
  email: string;
  whatsapp?: string;
  country: "VE" | "AR" | "CO" | "OTHER" | "";
  type: "ADMIN" | "SELF" | "";
  createdAt: string;
  source: "landing";
};
