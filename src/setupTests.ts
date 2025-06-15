// Global test setup
beforeEach(() => {
  // Reset console mocks
  jest.clearAllMocks();
});

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests