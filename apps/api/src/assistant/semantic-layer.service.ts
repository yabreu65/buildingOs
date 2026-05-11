import { Injectable } from '@nestjs/common';
import type { Permission } from '../rbac/permissions';
import type { AssistantQueryIntent, AssistantQueryModule, AssistantQueryScope } from './query-plan.types';

export interface AssistantSemanticDefinition {
  intent: AssistantQueryIntent;
  module: AssistantQueryModule;
  scope: AssistantQueryScope;
  requiredPermission: Permission;
}

const SEMANTIC_DEFINITIONS: Record<AssistantQueryIntent, AssistantSemanticDefinition> = {
  unit_residents: {
    intent: 'unit_residents',
    module: 'units',
    scope: 'unit',
    requiredPermission: 'units.read',
  },
  unit_debt: {
    intent: 'unit_debt',
    module: 'payments',
    scope: 'unit',
    requiredPermission: 'payments.review',
  },
  unit_documents: {
    intent: 'unit_documents',
    module: 'documents',
    scope: 'unit',
    requiredPermission: 'units.read',
  },
  unit_tickets: {
    intent: 'unit_tickets',
    module: 'tickets',
    scope: 'unit',
    requiredPermission: 'tickets.read',
  },
  unit_payments: {
    intent: 'unit_payments',
    module: 'payments',
    scope: 'unit',
    requiredPermission: 'payments.review',
  },
  building_debt: {
    intent: 'building_debt',
    module: 'payments',
    scope: 'building',
    requiredPermission: 'payments.review',
  },
  building_delinquents: {
    intent: 'building_delinquents',
    module: 'payments',
    scope: 'building',
    requiredPermission: 'payments.review',
  },
  building_documents: {
    intent: 'building_documents',
    module: 'documents',
    scope: 'building',
    requiredPermission: 'buildings.read',
  },
  building_tickets: {
    intent: 'building_tickets',
    module: 'tickets',
    scope: 'building',
    requiredPermission: 'tickets.read',
  },
  building_payments: {
    intent: 'building_payments',
    module: 'payments',
    scope: 'building',
    requiredPermission: 'payments.review',
  },
  building_stats: {
    intent: 'building_stats',
    module: 'buildings',
    scope: 'building',
    requiredPermission: 'buildings.read',
  },
};

@Injectable()
export class AssistantSemanticLayerService {
  /**
   * Return the allowlisted semantic definition for an assistant query intent.
   */
  getDefinition(intent: AssistantQueryIntent): AssistantSemanticDefinition {
    return SEMANTIC_DEFINITIONS[intent];
  }

  /**
   * Return every allowlisted semantic definition. Useful for tests and diagnostics.
   */
  listDefinitions(): AssistantSemanticDefinition[] {
    return Object.values(SEMANTIC_DEFINITIONS);
  }
}
