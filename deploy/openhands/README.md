# OpenHands Deployment on Railway

This directory contains the necessary files to deploy OpenHands (formerly OpenDevin) on Railway with Docker-in-Docker (DinD) support.

## Prerequisites

- A GitHub account.
- A Railway account.

## Deployment Steps

1.  **Push to GitHub**: Ensure this directory (`deploy/openhands`) is pushed to your GitHub repository.
2.  **Create Project on Railway**:
    - Go to Railway and create a new project.
    - Select "Deploy from GitHub repo".
    - Choose your repository.
3.  **Configure Service**:
    - **Immediately go to Settings** (do not wait for the build).
    - **Root Directory**: Set this to `deploy/openhands`. This ensures Railway finds the correct Dockerfile and context.
    - **Docker Build / Deploy**:
        - Enable **Privileged** mode. This is **critical** for Docker-in-Docker.
4.  **Environment Variables**:
    - Go to the **Variables** tab.
    - Add the following variables:
        - `PORT`: `3000`
        - `LLM_API_KEY`: Your LLM API key (e.g., `sk-...`).
        - `LLM_MODEL`: The model to use (e.g., `gpt-4o`).
        - `WORKSPACE_BASE`: `/opt/workspace_base`
5.  **Volumes**:
    - Go to the **Volumes** tab.
    - Add a volume mounted at `/opt/workspace_base` to persist your workspace.

## Troubleshooting

- **Docker Daemon failed to start**: Check if **Privileged** mode is enabled.
- **Permission errors**: The `start.sh` fixes socket permissions.
- **Resources**: If the app crashes, consider increasing RAM (2-4GB+ recommended).

## Files

- `Dockerfile`: Custom image with Docker installed.
- `start.sh`: Script to start Docker daemon and OpenHands.
