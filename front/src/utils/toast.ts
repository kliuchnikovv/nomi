type Handler = (message: string) => void;
const handlers = new Set<Handler>();

export function showToast(message: string) {
    handlers.forEach(h => h(message));
}

export function subscribeToast(handler: Handler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
}
