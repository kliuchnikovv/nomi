export interface Model {
    id: string;
    name: string;
    description?: string;
    provider?: string;
}

export interface ModelDetail {
    id: string;
    name: string;
    provider: string;
    description: string;
    context_window: number;
    supports_streaming: boolean;
    supports_tools: boolean;
    supports_thinking?: boolean;
    supports_vision?: boolean;
}


export interface ModelsResponse {
    models: ModelDetail[];
}
