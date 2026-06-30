// Jest setup file - runs before all tests
// Used for global test configuration

// Suppress console errors in tests (optional)
// global.console.error = jest.fn();
// global.console.warn = jest.fn();

const throwFocusedTestError = (apiName) => () => {
  throw new Error(
    `Focused test API "${apiName}" is forbidden in API test runs. Remove .only/focused tests before committing.`,
  );
};

for (const apiName of ['describe', 'it', 'test']) {
  const api = globalThis[apiName];
  if (api && typeof api.only === 'function') {
    api.only = throwFocusedTestError(`${apiName}.only`);
  }
}

for (const apiName of ['fdescribe', 'fit']) {
  if (typeof globalThis[apiName] === 'function') {
    globalThis[apiName] = throwFocusedTestError(apiName);
  }
}

// Add custom matchers if needed
expect.extend({
  // Example: custom matchers go here
});
