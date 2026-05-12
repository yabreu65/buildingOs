import { IntentRegistry, DuplicateIntentError } from './intent-registry';

describe('IntentRegistry', () => {
  let registry: IntentRegistry;

  beforeEach(() => {
    registry = new IntentRegistry();
  });

  const createMockIntent = (name: string) => ({
    name,
    requiredPermission: 'payments.read' as const,
    supportedFilters: ['period', 'status'] as const,
    supportedResponseTypes: ['table'] as const,
    executor: async () => ({ data: [] }),
  });

  describe('register', () => {
    it('registers a new intent successfully', () => {
      const intent = createMockIntent('list_payments');

      expect(() => registry.register(intent)).not.toThrow();
      expect(registry.has('list_payments')).toBe(true);
    });

    it('returns the registered intent via get()', () => {
      const intent = createMockIntent('list_payments');
      registry.register(intent);

      const retrieved = registry.get('list_payments');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('list_payments');
    });

    it('throws DuplicateIntentError for duplicate registration', () => {
      const intent = createMockIntent('list_payments');
      registry.register(intent);

      expect(() => registry.register(intent)).toThrow(DuplicateIntentError);
      expect(() => registry.register(intent)).toThrow('Intent "list_payments" is already registered');
    });

    it('allows different intents with different names', () => {
      const intent1 = createMockIntent('list_payments');
      const intent2 = createMockIntent('search_tickets');

      registry.register(intent1);
      expect(() => registry.register(intent2)).not.toThrow();

      expect(registry.list()).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent intent', () => {
      expect(registry.get('non_existent')).toBeUndefined();
    });

    it('returns the correct intent definition', () => {
      const intent = createMockIntent('list_payments');
      registry.register(intent);

      const retrieved = registry.get('list_payments');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('list_payments');
      expect(retrieved?.requiredPermission).toBe('payments.read');
    });
  });

  describe('has', () => {
    it('returns false for non-existent intent', () => {
      expect(registry.has('non_existent')).toBe(false);
    });

    it('returns true for registered intent', () => {
      const intent = createMockIntent('list_payments');
      registry.register(intent);

      expect(registry.has('list_payments')).toBe(true);
    });
  });

  describe('list', () => {
    it('returns empty array when no intents registered', () => {
      expect(registry.list()).toEqual([]);
    });

    it('returns all registered intents', () => {
      const intent1 = createMockIntent('list_payments');
      const intent2 = createMockIntent('search_tickets');
      const intent3 = createMockIntent('get_balance');

      registry.register(intent1);
      registry.register(intent2);
      registry.register(intent3);

      const list = registry.list();
      expect(list).toHaveLength(3);
      expect(list.map((i) => i.name)).toContain('list_payments');
      expect(list.map((i) => i.name)).toContain('search_tickets');
      expect(list.map((i) => i.name)).toContain('get_balance');
    });

    it('returns a new array instance (does not expose internal map)', () => {
      const intent = createMockIntent('list_payments');
      registry.register(intent);

      const list1 = registry.list();
      const list2 = registry.list();

      expect(list1).not.toBe(list2);
      expect(list1).toEqual(list2);
    });
  });

  describe('DuplicateIntentError', () => {
    it('is an instance of Error', () => {
      const error = new DuplicateIntentError('test_intent');
      expect(error).toBeInstanceOf(Error);
    });

    it('has correct name', () => {
      const error = new DuplicateIntentError('test_intent');
      expect(error.name).toBe('DuplicateIntentError');
    });

    it('has descriptive message', () => {
      const error = new DuplicateIntentError('my_intent');
      expect(error.message).toBe('Intent "my_intent" is already registered');
    });
  });
});