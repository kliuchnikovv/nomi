# Project: Genie

## Project Overview

Genie is a React Native mobile application designed as a chat client. It leverages TypeScript for type safety and a structured approach to state management using React Context (AuthContext and ChatContext). The application communicates with a backend API via a custom API client that includes authentication (token refresh) mechanisms. While a WebSocket implementation (`src/socket.ts`) is present, it is currently commented out, suggesting it might be a feature under development or planned for future integration.

**Key Technologies:**

*   **React Native:** For building cross-platform mobile applications.
*   **TypeScript:** For enhanced code quality and maintainability.
*   **React Context API:** For managing global state (authentication, chat).
*   **AsyncStorage:** For persistent storage of application configuration (e.g., API endpoint).
*   **ESLint & Prettier:** For code linting and formatting.
*   **Jest:** For unit testing.

## Building and Running

The project uses standard React Native CLI commands for development. Detailed instructions can be found in the project's `README.md` file.

**Prerequisites:**

*   Node.js (>=20)
*   React Native development environment set up (refer to `README.md` for details)
*   Ruby bundler for iOS dependencies

**Commands:**

1.  **Start Metro Bundler:**
    ```bash
    npm start
    ```
2.  **Run on Android:**
    ```bash
    npm run android
    ```
3.  **Install iOS Dependencies (first time or after native dependency updates):**
    ```bash
    bundle install
    bundle exec pod install
    ```
4.  **Run on iOS:**
    ```bash
    npm run ios
    ```

## Development Conventions

*   **Language:** TypeScript is used throughout the codebase.
*   **Code Style:** ESLint and Prettier are configured to maintain consistent code style and formatting.
*   **Testing:** Jest is used for running tests.
*   **API Communication:** A centralized `apiClient.ts` handles HTTP requests and authentication.
*   **Configuration:** API endpoints are managed in `src/config.ts` and can be switched between development and production via AsyncStorage.
*   **State Management:** React Context is utilized for managing application-wide state, such as authentication status and chat data.
*   **WebSockets:** A `socket.ts` file exists for WebSocket communication, but its implementation is currently commented out.
