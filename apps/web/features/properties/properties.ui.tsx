 "use client";
 import { mockProperties } from "./properties.mock";
 import { Table, THead, TR, TH, TBody, TD } from "../../shared/components/ui/Table";
 import Button from "../../shared/components/ui/Button";
 import { useCan } from "../rbac/rbac.hooks";
 
 export default function PropertiesUI() {
   const canWrite = useCan("properties.write");
   return (
     <div className="space-y-3">
       <div className="flex items-center justify-between">
         <h3 className="text-lg font-semibold">Properties</h3>
         {canWrite && <Button>New Property</Button>}
       </div>
       <Table>
         <THead>
           <TR>
             <TH>Name</TH>
             <TH>Address</TH>
             <TH>Units</TH>
           </TR>
         </THead>
         <TBody>
           {mockProperties.map((p) => (
             <TR key={p.id}>
               <TD>{p.name}</TD>
               <TD>{p.address}</TD>
               <TD>{p.units}</TD>
             </TR>
           ))}
         </TBody>
       </Table>
     </div>
   );
 }
