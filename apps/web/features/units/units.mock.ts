import { Unit } from "./units.types";

export const mockUnits: Unit[] = [
  {
    id: "u_101",
    tenantId: "t_1",
    buildingId: "b_1",
    label: "A-101",
    unitCode: "101",
    unitType: "APARTMENT",
    occupancyStatus: "OCCUPIED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "u_102",
    tenantId: "t_1",
    buildingId: "b_1",
    label: "A-102",
    unitCode: "102",
    unitType: "APARTMENT",
    occupancyStatus: "VACANT",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "u_201",
    tenantId: "t_1",
    buildingId: "b_2",
    label: "B-201",
    unitCode: "201",
    unitType: "APARTMENT",
    occupancyStatus: "OCCUPIED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
