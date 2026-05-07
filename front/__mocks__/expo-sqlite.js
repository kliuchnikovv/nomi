const mockDb = {
    execAsync: jest.fn(() => Promise.resolve()),
    runAsync: jest.fn(() => Promise.resolve({ lastInsertRowId: 0, changes: 0 })),
    getFirstAsync: jest.fn(() => Promise.resolve(null)),
    getAllAsync: jest.fn(() => Promise.resolve([])),
    closeAsync: jest.fn(() => Promise.resolve()),
    prepareAsync: jest.fn(() => Promise.resolve({
        executeAsync: jest.fn(() => Promise.resolve({ lastInsertRowId: 0, changes: 0 })),
        finalizeAsync: jest.fn(() => Promise.resolve()),
    })),
};

module.exports = {
    openDatabaseAsync: jest.fn(() => Promise.resolve(mockDb)),
};
